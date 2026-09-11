#!/usr/bin/env bun
/**
 * Repro: the facts that cross the YAML1-script boundary, other than the two outcome tokens, still agree.
 * The token join lives in node-outcomes-repro.ts (RESOLVE/EMPTY_PICK vs the `when:`/`until_bash`
 * literals); this file covers the rest of the boundary, where nothing reads the YAML today:
 *
 *   node `script:`      -> that workflow folder's scripts/<name>.ts exists
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
  /** Every `$<name>.output` this node's own keys read. */
  reads: string[];
};

/** The INPUTS_* names the node protocol reads. Archon owns the mapping; this is the other end of it. */
const inputsRead = new Set(nodeEntry.match(/INPUTS_[A-Z_]+/g) ?? []);
/**
 * The role a `script:` name runs, from the one call that says so: roleAgent({ role: "review" ... }).
 * Keyed by file name across both folders on purpose: ticket-dag-execute/scripts/<name>.ts is a
 * re-export shim and the body that calls roleAgent lives in ticket-dag-drain (ADR-0037).
 */
const roleByScript = new Map<string, string>();
for (const dir of [drainDir, executeDir]) {
  for (const file of readdirSync(join(dir, "scripts"))) {
    if (!file.endsWith(".ts")) continue;
    const role = /role:\s*"([a-z]+)"/.exec(readFileSync(join(dir, "scripts", file), "utf8"))?.[1];
    if (role) roleByScript.set(file.replace(/\.ts$/, ""), role);
  }
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
      node = { id: head[1]!, withKeys: [], dependsOn: [], reads: [] };
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
    // Any key's value may read another node's output, the fan-out and loop keys included.
    for (const name of refs(value)) node.reads.push(name);
    if (block) {
      if (indent > blockIndent) {
        if (block === "with" && value) node.withKeys.push({ key, value });
        if (block === "fan_out" && key === "as" && value) node.fanOutAs = value;
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

/** The script file a node names, in the folder of the workflow that declares it. */
const scriptExists = (dir: string, name: string): boolean =>
  existsSync(join(dir, "scripts", `${name}.ts`));

try {
  expect("the node protocol reads INPUTS_* names", inputsRead.size >= 2, [...inputsRead].join(" "));
  expect("the scanner sees the drain's nodes", scanNodes(yamls[0]!.text).length >= 5);

  const roleNodes: { id: string; role: string; timeout?: number; file: string }[] = [];
  for (const { file, dir, text } of yamls) {
    const nodes = scanNodes(text);
    const ids = new Set(nodes.map((n) => n.id));

    for (const node of nodes) {
      // `script:` names a file in this workflow's own scripts/ - an execute shim included.
      if (node.script) {
        expect(
          `${file}: script ${node.script} exists in ${dir.split("/").pop()}/scripts`,
          scriptExists(dir, node.script),
        );
        const role = roleByScript.get(node.script);
        if (role) roleNodes.push({ id: node.id, role, timeout: node.timeout, file });
        // A script that runs an agent must say which role, and belong to that role's own node.
        if (role) expectEqual(`${file}: node ${node.id} runs its own role`, role, node.id);
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
