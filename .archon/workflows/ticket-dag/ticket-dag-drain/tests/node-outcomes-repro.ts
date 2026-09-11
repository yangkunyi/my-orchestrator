#!/usr/bin/env bun
/** Repro: scripts/node-outcomes.ts owns the tokens the two YAMLs compare, and pick throttles at config.concurrency. No Pi, no Archon engine, no repo src/. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beginTicket } from "../scripts/begin.ts";
import { runNode } from "../scripts/node-entry.ts";
import { EMPTY_PICK, nodeLine, RESOLVE } from "../scripts/node-outcomes.ts";
import { settleAfterAgent } from "../scripts/settle.ts";
import { scanTickets } from "../scripts/tickets.ts";
import {
  commitFile,
  commitTickets,
  expect,
  expectEqual,
  gitC,
  runScript,
  ticketOf,
  withTarget,
  writeTicket,
} from "./target.ts";

const pickScript = join(import.meta.dir, "../scripts/pick.ts");
const drainYaml = join(import.meta.dir, "../ticket-dag-drain.yaml");
const executeYaml = join(import.meta.dir, "../../ticket-dag-execute/ticket-dag-execute.yaml");

/** The literal a `when:` comparison names, e.g. `$implement.output == 'resolve'`. */
function whenLiteral(yaml: string): string | undefined {
  return /when:\s*"\$[a-z-]+\.output == '([^']*)'"/.exec(yaml)?.[1];
}

/** The literal an `until_bash` comparison names, e.g. `test $pick.output = "[]"`. */
function untilLiteral(yaml: string): string | undefined {
  return /until_bash:\s*test \$[a-z-]+\.output = "([^"]*)"/.exec(yaml)?.[1];
}

/** What the YAML sees: the runner strips exactly one trailing newline from a script's stdout. */
function nodeOutput(stdout: string): string {
  return stdout.replace(/\n$/, "");
}

function startableCount(root: string): number {
  return scanTickets(root).filter((t) => t.status === "READY" || t.status === "FAILED").length;
}

try {
  expectEqual("nodeLine adds one newline", nodeLine("x"), "x\n");
  expect("a token carries no whitespace of its own", !/\s/.test(RESOLVE) && !/\s/.test(EMPTY_PICK));

  const drain = readFileSync(drainYaml, "utf8");
  const execute = readFileSync(executeYaml, "utf8");
  expectEqual("execute.yaml gates conflict on RESOLVE", whenLiteral(execute), RESOLVE);
  expectEqual("drain.yaml ends the drain loop on EMPTY_PICK", untilLiteral(drain), EMPTY_PICK);
  const fanOut = /fan_out:[\s\S]*?items:[^\n]*\n/.exec(drain)?.[0] ?? "";
  expect("fan_out names config.concurrency as the throttle", fanOut.includes("config.concurrency"), fanOut);

  // node-entry writes the handler's string verbatim: the newline is the handler's job, not the seam's.
  const writes: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await runNode({ run: () => nodeLine(RESOLVE) });
    await runNode({ run: () => RESOLVE });
  } finally {
    process.stdout.write = write;
  }
  expectEqual("handler token written verbatim", writes[0], nodeLine(RESOLVE));
  expectEqual("seam adds no newline of its own", writes[1], RESOLVE);

  // The token implement re-prints is the settle token; the YAML gates on the bytes settle writes.
  await withTarget(async (root) => {
    writeFileSync(join(root, "f"), "a\n");
    gitC(root, "add", "f");
    gitC(root, "commit", "-m", "init f");
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const begun = await beginTicket(root, ticketOf(root, "feat/01"));
    commitFile(begun.worktree, "f", "b\n", "ticket");
    writeFileSync(join(root, "f"), "c\n");
    gitC(root, "add", "f");
    gitC(root, "commit", "-m", "mainline");
    // settle is a library the implement/conflict nodes call, not a node of its own - so its outcome
    // is asserted here in process, and pick's spawn below is what keeps the node protocol pinned.
    const settled = await settleAfterAgent(root, ticketOf(root, "feat/01"), begun.worktree);
    expectEqual("the conflict route returns the resolve token", settled, RESOLVE);
    expectEqual("and the execute YAML gates on it", settled, whenLiteral(execute));
  });

  await withTarget(async (root, artifacts) => {
    const ids = ["feat/01", "feat/02", "feat/03", "feat/04"];
    for (const nn of ["01", "02", "03", "04"]) writeTicket(root, "feat", nn, `t${nn}`, "READY", "None");
    commitTickets(root);
    writeFileSync(join(root, ".scratch/ticket-dag.yaml"), "concurrency: 2\n");
    const env = { ARTIFACTS_DIR: artifacts };

    expectEqual("four Tickets are startable", startableCount(root), 4);
    const first = runScript(pickScript, root, env);
    expectEqual("pick exits 0", first.status, 0);
    const firstBatch = JSON.parse(nodeOutput(first.stdout)) as string[];
    expectEqual("pick throttles at config.concurrency", firstBatch.length, 2);
    expect("fewer ids than startable", firstBatch.length < startableCount(root));
    expectEqual("pick prints one token line", first.stdout, nodeLine(JSON.stringify(firstBatch)));

    const second = runScript(pickScript, root, env);
    const secondBatch = JSON.parse(nodeOutput(second.stdout)) as string[];
    expectEqual("second batch takes the rest", secondBatch.length, 2);
    expectEqual("throttle starves no Ticket", [...firstBatch, ...secondBatch].sort(), ids);

    const drained = runScript(pickScript, root, env);
    expectEqual("drained pick prints EMPTY_PICK", nodeOutput(drained.stdout), EMPTY_PICK);
    expectEqual("and the YAML compares that literal", nodeOutput(drained.stdout), untilLiteral(drain));
    expectEqual("as one newline-terminated token", drained.stdout, nodeLine(EMPTY_PICK));
  });

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
}
