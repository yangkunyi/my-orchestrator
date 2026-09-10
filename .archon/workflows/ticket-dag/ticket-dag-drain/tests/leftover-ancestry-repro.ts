#!/usr/bin/env bun
/** Leftover with only ancestry (RUNNING stamp on Main, no merge commit) → FAILED, Worktree kept. No Pi, no Archon engine, no repo src/. */
import { existsSync } from "node:fs";
import { rematchLeftovers } from "../scripts/rematch.ts";
import {
  addTicketWorktree,
  branchExists,
  commitTickets,
  gitC,
  statusOf,
  ticketOf,
  withTarget,
  writeTicket,
} from "./target.ts";

try {
  await withTarget(async (root) => {
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    writeTicket(root, "feat", "01", "demo", "RUNNING", "None");
    commitTickets(root, "orchestrator: feat/01 Status RUNNING");

    const ticket = ticketOf(root, "feat/01");
    const wt = addTicketWorktree(root, ticket);

    // Premise: the branch is an ancestor of Main, and that alone must not count as MERGED.
    void gitC(root, "merge-base", "--is-ancestor", ticket.branch, "HEAD");

    await rematchLeftovers(root);

    const status = statusOf(root, rel);
    const worktreeKept = existsSync(wt);
    const branchKept = branchExists(root, ticket.branch);
    const ok = status === "FAILED" && worktreeKept && branchKept;
    console.log(JSON.stringify({ ok, status, worktreeKept, branchKept }));
    if (!ok) process.exitCode = 1;
  });
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
}
