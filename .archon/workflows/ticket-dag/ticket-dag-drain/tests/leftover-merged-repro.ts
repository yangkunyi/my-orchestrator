#!/usr/bin/env bun
/** Leftover with --no-ff merge commit → MERGED, Worktree gone. No Pi, no Archon engine, no repo src/. */
import { existsSync } from "node:fs";
import { rematchLeftovers } from "../scripts/rematch.ts";
import {
  addTicketWorktree,
  branchExists,
  commitFile,
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
    commitFile(wt, "work.txt", "agent\n", "agent work");

    writeTicket(root, "feat", "01", "demo", "MERGING", "None");
    commitTickets(root, "orchestrator: feat/01 Status MERGING");
    gitC(root, "merge", "--no-ff", "-m", `orchestrator: merge ${ticket.branch}`, ticket.branch);
    const branchSha = gitC(root, "rev-parse", ticket.branch);

    await rematchLeftovers(root);

    const status = statusOf(root, rel);
    const worktreeGone = !existsSync(wt);
    const branchGone = !branchExists(root, ticket.branch);
    const mergeMsg = gitC(root, "log", "-1", "--format=%s", "HEAD~1");
    const mergeParents = gitC(root, "rev-list", "--parents", "-n", "1", "HEAD~1").split(" ");
    const ok =
      status === "MERGED" &&
      worktreeGone &&
      mergeMsg === `orchestrator: merge ${ticket.branch}` &&
      mergeParents.length === 3 &&
      mergeParents[2] === branchSha;
    console.log(
      JSON.stringify({
        ok,
        status,
        worktreeGone,
        branchGone,
        mergeMsg,
        secondParent: mergeParents[2] === branchSha,
      }),
    );
    if (!ok) process.exitCode = 1;
  });
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
}
