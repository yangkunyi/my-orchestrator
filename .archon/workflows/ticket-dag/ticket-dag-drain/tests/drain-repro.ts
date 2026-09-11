#!/usr/bin/env bun
/** Temp-Target repro: drain loop without Pi. Empty ticket branch FAILED-exits 0 so pick can empty. No Archon engine, no repo src/. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { noopAgent } from "../scripts/agent.ts";
import { rematchLeftovers } from "../scripts/rematch.ts";
import { REVIEW_BASE_REL } from "../scripts/review-artifacts.ts";
import { pickStartable } from "../scripts/pick.ts";
import { conflictTicket } from "../scripts/conflict.ts";
import { implementTicket } from "../scripts/implement.ts";
import {
  addTicketWorktree,
  commitFile,
  commitTickets,
  envWithout,
  expect,
  expectEqual,
  gitC,
  runScript,
  statusOf,
  ticketOf,
  withTarget,
  writeTicket,
} from "./target.ts";

const implementScript = join(import.meta.dir, "../../ticket-dag-execute/scripts/implement.ts");
const conflictScript = join(import.meta.dir, "../../ticket-dag-execute/scripts/conflict.ts");

function agentOpts(artifacts: string) {
  return { artifactsDir: artifacts, runAgent: noopAgent };
}

async function drainUntilEmpty(
  root: string,
  artifacts: string,
  concurrency: number,
): Promise<{ iterations: number; tokens: string[] }> {
  await rematchLeftovers(root, artifacts);
  const tokens: string[] = [];
  let iterations = 0;
  for (; iterations < 500; iterations++) {
    const picked = await pickStartable(root, { concurrency, artifactsDir: artifacts });
    if (picked.length === 0) break;
    const batch = await Promise.all(
      picked.map(async (t) => {
        const token = await implementTicket(root, t.id, agentOpts(artifacts));
        if (token === "resolve") return conflictTicket(root, t.id, agentOpts(artifacts));
        return token;
      }),
    );
    tokens.push(...batch);
  }
  return { iterations, tokens };
}

try {
  await withTarget(async (root, artifacts) => {
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const token = await implementTicket(root, "feat/01", agentOpts(artifacts));
    expectEqual("empty branch stdout token", token, "failed");
    expectEqual("empty branch Status", statusOf(root, rel), "FAILED");
    const ticket = ticketOf(root, "feat/01");
    expect("Worktree kept", existsSync(join(root, ticket.worktreeRel)), ticket.worktreeRel);
  });

  await withTarget(async (root) => {
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const proc = runScript(implementScript, root, envWithout("INPUTS_TICKET"));
    expect("bare implement without ticket is unsupported", (proc.status ?? 1) !== 0, proc.status);
    expect("error names missing ticket", proc.stderr.includes("INPUTS_TICKET is required"));
  });

  await withTarget(async (root) => {
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const proc = runScript(conflictScript, root, envWithout("INPUTS_TICKET"));
    expect("bare conflict without ticket is unsupported", (proc.status ?? 1) !== 0, proc.status);
    expect("conflict error names missing ticket", proc.stderr.includes("INPUTS_TICKET is required"));
  });

  await withTarget(async (root) => {
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const proc = runScript(implementScript, root, { ...envWithout("ARTIFACTS_DIR"), INPUTS_TICKET: "feat/01" });
    expect("implement requires artifacts dir", (proc.status ?? 1) !== 0, proc.status);
    expect("error names missing artifacts", proc.stderr.includes("ARTIFACTS_DIR is required"));
  });

  await withTarget(async (root, artifacts) => {
    const r01 = writeTicket(root, "feat", "01", "one", "READY", "None");
    const r02 = writeTicket(root, "feat", "02", "two", "READY", "None");
    commitTickets(root);
    const { iterations, tokens } = await drainUntilEmpty(root, artifacts, 1);
    expectEqual("loop finished before cap", iterations < 500, true);
    expect("pick became empty", iterations >= 1, iterations);
    expectEqual("both empty branches failed", [...tokens].sort(), ["failed", "failed"]);
    expectEqual("01 FAILED", statusOf(root, r01), "FAILED");
    expectEqual("02 FAILED", statusOf(root, r02), "FAILED");
    const t1 = ticketOf(root, "feat/01");
    const t2 = ticketOf(root, "feat/02");
    expect("01 Worktree kept", existsSync(join(root, t1.worktreeRel)));
    expect("02 Worktree kept", existsSync(join(root, t2.worktreeRel)));
    const after = await pickStartable(root, { concurrency: 4, artifactsDir: artifacts });
    expectEqual("same drain does not re-pick just-FAILED", after.map((t) => t.id), []);
  });

  await withTarget(async (root, artifacts) => {
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const head = gitC(root, "rev-parse", "HEAD");
    await rematchLeftovers(root, artifacts);
    expectEqual(
      "rematch wrote review-base",
      readFileSync(join(artifacts, REVIEW_BASE_REL), "utf8").trim(),
      head,
    );
  });

  await withTarget(async (root, artifacts) => {
    writeFileSync(join(root, "conflict.txt"), "base\n");
    gitC(root, "add", "conflict.txt");
    gitC(root, "commit", "-m", "base conflict file");
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const ticket = ticketOf(root, "feat/01");
    const wt = addTicketWorktree(root, ticket);
    commitFile(wt, "conflict.txt", "from-agent\n", "agent conflict");
    writeFileSync(join(root, rel), "# 01\n\n**Blocked by:** None\n\nStatus: FAILED\n");
    gitC(root, "add", rel);
    gitC(root, "commit", "-m", "orchestrator: feat/01 Status FAILED");
    writeFileSync(join(root, "conflict.txt"), "from-main\n");
    gitC(root, "add", "conflict.txt");
    gitC(root, "commit", "-m", "main conflict");
    const token = await implementTicket(root, "feat/01", agentOpts(artifacts));
    expectEqual("resume-conflict implement token", token, "resolve");
    expectEqual("status still RUNNING until conflict node", statusOf(root, rel), "RUNNING");
    const conflictToken = await conflictTicket(root, "feat/01", agentOpts(artifacts));
    expectEqual("conflict stdout token", conflictToken, "failed");
    expectEqual("conflict stamps FAILED", statusOf(root, rel), "FAILED");
    expect("Worktree kept after unresolved conflict", existsSync(wt));
  });

  // Where a turn's session lives is the runner's to know, not the role table's: the node reports the
  // path the runner handed back, and it can only report it once the turn has run.
  await withTarget(async (root, artifacts) => {
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const saw: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => {
      saw.push(args.map(String).join(" "));
    };
    try {
      await implementTicket(root, "feat/01", {
        artifactsDir: artifacts,
        runAgent: async () => ({
          sessionFile: join(artifacts, "elsewhere", "session.v9.jsonl"),
          answer: { kind: "none" },
          lastError: undefined,
        }),
      });
    } finally {
      console.error = realError;
    }
    const line = saw.find((l) => l.includes(" session "));
    expectEqual(
      "the node reports the runner's session path",
      line,
      `feat/01 session ${join(artifacts, "elsewhere", "session.v9.jsonl")}`,
    );
  });

  // A turn that never got a session must not be reported as having one: a guessed path that does not
  // exist is worse than no pointer at all, so the node only says where a session is once it is told.
  await withTarget(async (root, artifacts) => {
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const saw: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => {
      saw.push(args.map(String).join(" "));
    };
    try {
      await implementTicket(root, "feat/01", {
        artifactsDir: artifacts,
        runAgent: async () => {
          throw new Error("no credentials");
        },
      });
    } finally {
      console.error = realError;
    }
    expectEqual("a turn with no session reports none", saw.find((l) => l.includes(" session ")), undefined);
    expect("the failure is still recorded", saw.some((l) => l.includes("FAILED: no credentials")), saw.join(" | "));
  });

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
}
