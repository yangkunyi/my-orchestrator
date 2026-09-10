#!/usr/bin/env bun
/** Temp-Target repro: startable pick. No Pi, no Archon engine, no repo src/. */
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rematchLeftovers } from "../scripts/rematch.ts";
import { pickStartable } from "../scripts/pick.ts";
import {
  addTicketWorktree,
  commitFile,
  commitTickets,
  expect,
  expectEqual,
  gitC,
  mkTemp,
  statusOf,
  ticketOf,
  withTarget,
  writeTicket,
} from "./target.ts";

function ids(picked: { id: string }[]): string[] {
  return picked.map((t) => t.id).sort();
}

function listNonDot(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      const parent = (e as { parentPath?: string }).parentPath ?? dir;
      return join(parent, e.name).slice(dir.length).replace(/^\//, "");
    })
    .sort();
}

try {
  await withTarget(async (root, artifacts, state) => {
    const r01 = writeTicket(root, "feat", "01", "one", "MERGED", "None");
    const r02 = writeTicket(root, "feat", "02", "two", "BLOCKED", "01");
    commitTickets(root);
    const picked = await pickStartable(root, { concurrency: 4, artifactsDir: artifacts });
    expectEqual("blocked→ready pick ids", ids(picked), ["feat/02"]);
    expectEqual("02 stamped READY", statusOf(root, r02), "READY");
    expectEqual("01 stays MERGED", statusOf(root, r01), "MERGED");
    const stampMsg = gitC(root, "log", "-1", "--format=%s");
    expectEqual("READY stamp commit", stampMsg, "orchestrator: feat/02 Status READY");
    expect("artifacts got attempted ids", listNonDot(artifacts).length > 0, listNonDot(artifacts));
    expectEqual("state dir unused", listNonDot(state), []);
  });

  await withTarget(async (root, artifacts) => {
    writeTicket(root, "feat", "01", "one", "MERGED", "None");
    writeTicket(root, "feat", "02", "two", "BLOCKED", "01");
    writeTicket(root, "feat", "03", "three", "BLOCKED", "01");
    commitTickets(root);
    const picked = await pickStartable(root, { concurrency: 1, artifactsDir: artifacts });
    expectEqual("concurrency 1 pick size", picked.length, 1);
    expectEqual("02 READY before pick", statusOf(root, ".scratch/feat/issues/02-two.md"), "READY");
    expectEqual("03 READY before pick", statusOf(root, ".scratch/feat/issues/03-three.md"), "READY");
    const remaining = ["feat/02", "feat/03"].filter((id) => id !== picked[0]?.id);
    expectEqual("unpicked sibling still READY", remaining.length, 1);
  });

  await withTarget(async (root, artifacts) => {
    writeTicket(root, "feat", "01", "one", "FAILED", "None");
    writeTicket(root, "feat", "02", "two", "BLOCKED", "01");
    commitTickets(root);
    const picked = await pickStartable(root, { concurrency: 4, artifactsDir: artifacts });
    expectEqual("FAILED blocker: 01 is startable", ids(picked), ["feat/01"]);
    expectEqual("dependent of FAILED stays BLOCKED", statusOf(root, ".scratch/feat/issues/02-two.md"), "BLOCKED");
  });

  await withTarget(async (root, artifacts) => {
    writeTicket(root, "feat", "01", "a", "READY", "None");
    writeTicket(root, "feat", "02", "b", "READY", "None");
    writeTicket(root, "feat", "03", "c", "READY", "None");
    commitTickets(root);
    const first = await pickStartable(root, { concurrency: 2, artifactsDir: artifacts });
    expectEqual("concurrency first pick size", first.length, 2);
    const second = await pickStartable(root, { concurrency: 2, artifactsDir: artifacts });
    expectEqual("concurrency second pick size", second.length, 1);
    const third = await pickStartable(root, { concurrency: 2, artifactsDir: artifacts });
    expectEqual("concurrency third pick empty", third.length, 0);
    const all = [...ids(first), ...ids(second)].sort();
    expectEqual("all three startable eventually", all, ["feat/01", "feat/02", "feat/03"]);
  });

  await withTarget(async (root, artifacts) => {
    writeTicket(root, "feat", "01", "one", "FAILED", "None");
    commitTickets(root);
    const first = await pickStartable(root, { concurrency: 4, artifactsDir: artifacts });
    expectEqual("FAILED is startable", ids(first), ["feat/01"]);
    expectEqual("FAILED status unchanged by pick", statusOf(root, ".scratch/feat/issues/01-one.md"), "FAILED");
    const second = await pickStartable(root, { concurrency: 4, artifactsDir: artifacts });
    expectEqual("just-attempted FAILED not re-picked", ids(second), []);
  });

  await withTarget(async (root) => {
    writeTicket(root, "feat", "01", "one", "FAILED", "None");
    commitTickets(root);
    const drain1 = mkTemp("pack-pick-d1-");
    const drain2 = mkTemp("pack-pick-d2-");
    try {
      const a = await pickStartable(root, { concurrency: 4, artifactsDir: drain1 });
      expectEqual("drain1 picks FAILED", ids(a), ["feat/01"]);
      const b = await pickStartable(root, { concurrency: 4, artifactsDir: drain2 });
      expectEqual("next drain may pick eligible FAILED", ids(b), ["feat/01"]);
    } finally {
      rmSync(drain1, { recursive: true, force: true });
      rmSync(drain2, { recursive: true, force: true });
    }
  });

  await withTarget(async (root, artifacts) => {
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const ticket = ticketOf(root, "feat/01");
    const wt = addTicketWorktree(root, ticket);
    commitFile(wt, "work.txt", "agent\n", "agent work");
    gitC(root, "merge", "--no-ff", "-m", `orchestrator: merge ${ticket.branch}`, ticket.branch);
    const picked = await pickStartable(root, { concurrency: 4, artifactsDir: artifacts });
    expectEqual("merge commit: not startable", ids(picked), []);
    expectEqual("READY with merge commit stays READY", statusOf(root, rel), "READY");
  });

  await withTarget(async (root, artifacts) => {
    writeTicket(root, "feat", "01", "one", "RUNNING", "None");
    writeTicket(root, "feat", "02", "two", "MERGED", "None");
    writeTicket(root, "other", "01", "research", "READY", "None");
    writeFileSync(
      join(root, ".scratch/other/issues/01-research.md"),
      "# 01\n\nType: research\n\n**Blocked by:** None\n\nStatus: READY\n",
    );
    commitTickets(root);
    const picked = await pickStartable(root, { concurrency: 4, artifactsDir: artifacts });
    expectEqual("in-flight, MERGED, wayfinder skipped", ids(picked), []);
  });

  await withTarget(async (root, artifacts) => {
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root, "ticket");
    writeTicket(root, "feat", "01", "demo", "RUNNING", "None");
    commitTickets(root, "orchestrator: feat/01 Status RUNNING");
    const ticket = ticketOf(root, "feat/01");
    addTicketWorktree(root, ticket);
    await rematchLeftovers(root, artifacts);
    expectEqual("rematch leftover → FAILED", statusOf(root, rel), "FAILED");
    const picked = await pickStartable(root, { concurrency: 4, artifactsDir: artifacts });
    expectEqual("just-FAILED leftover not picked this drain", ids(picked), []);
  });

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
}
