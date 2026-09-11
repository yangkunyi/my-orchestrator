#!/usr/bin/env bun
/**
 * Repro: the facts that cross the YAML1-script boundary, other than the two outcome tokens, still agree.
 * The token join lives in node-outcomes-repro.ts (RESOLVE/EMPTY_PICK vs the `when:`/`until_bash`
 * literals); this file covers the rest of the boundary, where nothing reads the YAML today:
 *
 *   node `script:`      -> that folder's scripts/<name>.ts exists, and the body, its role and its CLI
 *                          entry are read from that folder alone, never from the other one
 *   node `timeout:`     -> it runs a role (read out of the script source), and the timeout exceeds
 *                          that role's wall clock, so Archon never kills a turn the agent is still on
 *   `with:` keys        -> the INPUTS_<KEY> name the node protocol reads (node-entry.ts)
 *   `inputs.config.default` -> config.ts's DEFAULT_CONFIG_REL
 *   `include:`          -> a workflow folder, whose required inputs the include's wiring supplies
 *   `depends_on` / `$<node>.output` -> names a node declared in the same file
 *
 * Read as text on purpose: the pack ships no dependencies, and both files are hand-written in one shape.
 * A missing fact fails the file (the message says what moved), never a run.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG_REL } from "../scripts/config.ts";
import { ROLES } from "../scripts/roles.ts";
import { expect, expectEqual } from "./target.ts";

const drainDir = join(import.meta.dir, "..");
const executeDir = join(import.meta.dir, "../../ticket-dag-execute");
const nodeEntry = readFileSync(join(drainDir, "scripts/node-entry.ts"), "utf8");

type YamlNode = {
  id: string;
  script?: string;
  include?: string;
  timeout?: number;
  withKeys: { key: string; value: string }[];
  dependsOn: string[];
  fanOutAs?: string;
  fanOutJoin?: string;
  /** True when the node declares a `when:` - a node that can be skipped is not a terminal state. */
  hasWhen: boolean;
  /** Every `$<name>.output` this node's own keys read. */
  reads: string[];
};

/** The INPUTS_* names the node protocol reads. Archon owns the mapping; this is the other end of it. */
const inputsRead = new Set(nodeEntry.match(/INPUTS_[A-Z_]+/g) ?? []);
/**
 * What one workflow folder's own scripts/ offers, keyed by script name: the role that script runs (the
 * one call that says so is roleAgent({ role: "review" ... })) and whether it is a CLI entry. Read per
 * folder, never across the pack: a node's script resolves in the folder that declares the node, so a
 * body left behind in the other folder cannot satisfy it.
 */
type ScriptFact = { role?: string; entry: boolean };
const scriptsByDir = new Map<string, Map<string, ScriptFact>>();
for (const dir of [drainDir, executeDir]) {
  const byName = new Map<string, ScriptFact>();
  for (const file of readdirSync(join(dir, "scripts"))) {
    if (!file.endsWith(".ts")) continue;
    const source = readFileSync(join(dir, "scripts", file), "utf8");
    byName.set(file.replace(/\.ts$/, ""), {
      role: /role:\s*"([a-z]+)"/.exec(source)?.[1],
      entry: /if \(import\.meta\.main\)/.test(source),
    });
  }
  scriptsByDir.set(dir, byName);
}
const refs = (text: string): string[] => [...text.matchAll(/\$([a-z][\w-]*)\.output/g)].map((m) => m[1]!);
const listNames = (text: string): string[] =>
  text
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * A line scanner, not a YAML parser. Node keys sit deeper than their `- id:`; `with:` and `fan_out:`
 * open blocks whose entries sit deeper still. Every `- id:` starts a node, the loop body included.
 */
function scanNodes(yaml: string): YamlNode[] {
  const nodes: YamlNode[] = [];
  let node: YamlNode | undefined;
  let nodeIndent = 0;
  let block: "with" | "fan_out" | undefined;
  let blockIndent = 0;
  for (const raw of yaml.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "");
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const head = /^- id:\s*(\S+)\s*$/.exec(line.trim());
    if (head) {
      node = { id: head[1]!, withKeys: [], dependsOn: [], reads: [], hasWhen: false };
      nodes.push(node);
      nodeIndent = indent;
      block = undefined;
      continue;
    }
    if (!node || indent <= nodeIndent) continue;
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    // The regex has two groups, so a match gives both: the same `!` the node-id match above uses.
    const key = kv[1]!;
    const value = kv[2]!;
    if (key === "when" && value) node.hasWhen = true;
    // Any key's value may read another node's output, the fan-out and loop keys included.
    for (const name of refs(value)) node.reads.push(name);
    if (block) {
      if (indent > blockIndent) {
        if (block === "with" && value) node.withKeys.push({ key, value });
        if (block === "fan_out" && key === "as" && value) node.fanOutAs = value;
        if (block === "fan_out" && key === "join" && value) node.fanOutJoin = value;
        continue;
      }
      block = undefined;
    }
    if (key === "with" && !value) {
      block = "with";
      blockIndent = indent;
    } else if (key === "fan_out") {
      block = "fan_out";
      blockIndent = indent;
    } else if (key === "script" && value) node.script = value;
    else if (key === "include" && value) node.include = value;
    else if (key === "timeout" && value) node.timeout = Number(value);
    else if (key === "depends_on") node.dependsOn = listNames(value);
  }
  return nodes;
}

/** The inputs a workflow declares `required: true` - the ones an `include` must be wired to supply. */
function requiredInputs(yaml: string): string[] {
  const out: string[] = [];
  let inInputs = false;
  let indent = 0;
  let current: string | undefined;
  for (const raw of yaml.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "");
    if (!line.trim()) continue;
    const lead = line.length - line.trimStart().length;
    if (/^inputs:\s*$/.test(line.trim())) {
      inInputs = true;
      indent = lead;
      continue;
    }
    if (!inInputs) continue;
    if (lead <= indent) {
      inInputs = false;
      continue;
    }
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    if (lead === indent + 2 && kv[2] === "") current = kv[1]!;
    if (lead > indent + 2 && kv[1] === "required" && kv[2] === "true" && current) out.push(current);
  }
  return out;
}

const yamls = [
  { file: "ticket-dag-drain.yaml", dir: drainDir },
  { file: "ticket-dag-execute.yaml", dir: executeDir },
].map((w) => ({ ...w, text: readFileSync(join(w.dir, w.file), "utf8") }));

try {
  expect("the node protocol reads INPUTS_* names", inputsRead.size >= 2, [...inputsRead].join(" "));
  expect("the scanner sees the drain's nodes", scanNodes(yamls[0]!.text).length >= 5);

  const roleNodes: { id: string; role: string; timeout?: number; file: string }[] = [];
  for (const { file, dir, text } of yamls) {
    const nodes = scanNodes(text);
    const ids = new Set(nodes.map((n) => n.id));
    const folder = dir.split("/").pop()!;
    const scripts = scriptsByDir.get(dir)!;
    const declaredScripts = new Set<string>();

    for (const node of nodes) {
      // `script:` names a file in this workflow's own scripts/, never in the other folder's.
      if (node.script) {
        declaredScripts.add(node.script);
        const fact = scripts.get(node.script);
        expect(`${file}: script ${node.script} exists in ${folder}/scripts`, fact !== undefined);
        if (fact?.role) roleNodes.push({ id: node.id, role: fact.role, timeout: node.timeout, file });
        // A script that runs an agent must say which role, and belong to that role's own node.
        if (fact?.role) expectEqual(`${file}: node ${node.id} runs its own role`, fact.role, node.id);
      }

      // Every name this node depends on, and every node whose output it reads, is declared here.
      for (const name of [...node.dependsOn, ...node.reads]) {
        expect(`${file}: ${node.id} names a declared node`, ids.has(name), name);
      }

      // A `with:` entry is the node protocol's INPUTS_<KEY>, wired as $INPUTS.<key>.
      for (const { key, value } of node.withKeys) {
        expect(`node-entry reads INPUTS_${key.toUpperCase()}`, inputsRead.has(`INPUTS_${key.toUpperCase()}`));
        expectEqual(`${file}: ${node.id} wires ${key} from its own input`, value, `$INPUTS.${key}`);
      }

      // An include names a workflow folder, and its fan-out feeds an input that workflow requires.
      if (node.include) {
        const included = join(dir, "..", node.include, `${node.include}.yaml`);
        expect(`${file}: include ${node.include} is a workflow folder`, existsSync(included));
        // all_success is load-bearing, not a default: a Ticket's own outcome is exit 0, so an instance
        // only fails when a node THREW - a runner that cannot start, or a pack bug. Under all_done that
        // is an archon_failed marker and the run still reports success, which is how a misconfigured
        // runner used to drain the backlog. Measured with a two-instance probe (ADR-0051).
        expectEqual(`${file}: ${node.id} fails the node when an instance fails`, node.fanOutJoin, "all_success");
        // And the instance must BE terminal: archon reads "stopped without a terminal state" for an
        // instance whose last node was skipped, which fails this node regardless of the join (measured).
        // So the included workflow declares `returns:` naming a node that always runs; conflict is behind
        // a `when:` and would leave a merged Ticket's instance non-terminal (ADR-0053).
        if (existsSync(included)) {
          const child = readFileSync(included, "utf8");
          const returns = /^returns:\s*(\S+)/m.exec(child)?.[1];
          expect(`${node.include} declares the node whose output is its terminal state`, returns !== undefined, child.slice(0, 200));
          const named = scanNodes(child).find((n) => n.id === returns);
          expect(`${node.include} returns a declared node`, named !== undefined, `${returns}`);
          expect(
            `${node.include} returns a node that always runs (no when:)`,
            named !== undefined && !named.hasWhen,
            `${returns}${named?.hasWhen ? " is behind a when:" : ""}`,
          );
        }
        if (existsSync(included) && node.fanOutAs) {
          const required = requiredInputs(readFileSync(included, "utf8"));
          expect(
            `${file}: fan_out as ${node.fanOutAs} feeds a required input of ${node.include}`,
            required.includes(node.fanOutAs),
            required.join(" "),
          );
        }
      }
    }

    // A node is a script this workflow can run, and a script it can run is a node: the two directions
    // must agree inside one folder, so a dead entry (settle's was, until it stopped being a node) and a
    // library masquerading as a node both fail here, and a body left in the other folder cannot stand
    // in for either.
    for (const [name, fact] of scripts) {
      if (!fact.entry) continue;
      expect(
        `entry script ${name} in ${folder}/scripts is declared as a node`,
        declaredScripts.has(name),
        [...declaredScripts].sort().join(" "),
      );
    }
    for (const name of declaredScripts) {
      expect(
        `declared script ${name} in ${folder}/scripts has an entry`,
        scripts.get(name)?.entry === true,
        [...scripts.keys()].sort().join(" "),
      );
    }
  }

  // A role is a node, and no agent node runs without a time budget longer than its wall clock.
  for (const role of Object.keys(ROLES) as (keyof typeof ROLES)[]) {
    const nodes = roleNodes.filter((n) => n.role === role);
    expectEqual(`exactly one node runs ${role}`, nodes.length, 1);
    const node = nodes[0]!;
    expect(`${role}'s node declares a timeout`, node.timeout !== undefined, `${node.file}`);
    expect(
      `${role}'s timeout exceeds its wall clock (${ROLES[role].wallMs}ms)`,
      (node.timeout ?? 0) > ROLES[role].wallMs,
      `${node.timeout}ms`,
    );
  }
  for (const { id, role, file } of roleNodes) {
    expect(`${file}: ${id} runs a known role`, role in ROLES, role);
  }

  // The config path the workflow hands the nodes is the one the pack defaults to.
  for (const { file, text } of yamls) {
    const declared = /config:\s*\n\s*default:\s*(\S+)/.exec(text)?.[1];
    expectEqual(`${file} defaults config to DEFAULT_CONFIG_REL`, declared, DEFAULT_CONFIG_REL);
  }

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
}
