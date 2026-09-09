import {
  createWorktree,
  hasCommitsAhead,
  integrateMainIntoWorktree,
  isAncestor,
  removeWorktreeAndBranch,
  revParse,
  tryMerge,
  withMergeLock,
  worktreeDirty,
} from "./git.js";
import type { Journal } from "./journal.js";
import { stamp } from "./status.js";
import { leftoverInFlight, scanTickets, type Ticket } from "./tickets.js";

export type SettleResult = "merged" | "failed" | "resolve";

export async function fail(target: string, ticket: Ticket, reason: string, journal: Journal): Promise<void> {
  await withMergeLock(target, async () => {
    journal.log(`${ticket.id} FAILED: ${reason}`);
    await stamp(target, ticket, "FAILED", journal);
  });
}

export async function beginTicket(target: string, ticket: Ticket, journal: Journal): Promise<string> {
  return withMergeLock(target, async () => {
    await stamp(target, ticket, "RUNNING", journal);
    await removeWorktreeAndBranch(target, ticket);
    return createWorktree(target, ticket);
  });
}

/** ok / empty / fail / remove. Conflict is returned for the caller. */
async function settleMerge(
  target: string,
  ticket: Ticket,
  journal: Journal,
  result: "ok" | "conflict" | "failed" | "empty",
  brokenReason: string,
): Promise<"merged" | "failed" | "conflict"> {
  if (result === "ok") {
    await stamp(target, ticket, "MERGED", journal);
    await removeWorktreeAndBranch(target, ticket);
    return "merged";
  }
  if (result === "empty") {
    await fail(target, ticket, "merge produced no new commit on Main", journal);
    return "failed";
  }
  if (result === "conflict") return "conflict";
  await fail(target, ticket, brokenReason, journal);
  return "failed";
}

/** ADR-0023: commits ahead of current Main, then tryMerge; unchanged HEAD is FAILED. */
async function mergeOntoMain(
  target: string,
  ticket: Ticket,
  worktree: string,
  journal: Journal,
  brokenReason: string,
  lastError?: string,
): Promise<"merged" | "failed" | "conflict"> {
  if (!(await hasCommitsAhead(worktree, await revParse(target)))) {
    const reason = lastError
      ? `no commits on ticket branch that Main does not have (${lastError})`
      : "no commits on ticket branch that Main does not have";
    await fail(target, ticket, reason, journal);
    return "failed";
  }
  await stamp(target, ticket, "MERGING", journal);
  return settleMerge(target, ticket, journal, await tryMerge(target, ticket.branch), brokenReason);
}

export async function settleAfterAgent(
  target: string,
  ticket: Ticket,
  worktree: string,
  journal: Journal,
  lastError?: string,
): Promise<SettleResult> {
  if (await worktreeDirty(worktree)) {
    await fail(target, ticket, "worktree dirty after implement", journal);
    return "failed";
  }

  return withMergeLock(target, async () => {
    const first = await mergeOntoMain(
      target,
      ticket,
      worktree,
      journal,
      "git merge failed without MERGE_HEAD",
      lastError,
    );
    if (first !== "conflict") return first;
    await stamp(target, ticket, "CONFLICT", journal);
    const integrated = await integrateMainIntoWorktree(worktree, await revParse(target));
    if (integrated === "failed") {
      await fail(target, ticket, "could not merge Main into Worktree", journal);
      return "failed";
    }
    if (integrated === "conflict") return "resolve";
    const rematch = await settleMerge(
      target,
      ticket,
      journal,
      await tryMerge(target, ticket.branch),
      "merge still broken after integrating Main",
    );
    if (rematch === "conflict") {
      await fail(target, ticket, "merge still broken after integrating Main", journal);
      return "failed";
    }
    return rematch;
  });
}

export async function settleAfterConflict(
  target: string,
  ticket: Ticket,
  worktree: string,
  journal: Journal,
): Promise<void> {
  if (await worktreeDirty(worktree)) {
    await fail(target, ticket, "worktree dirty after conflict agent", journal);
    return;
  }
  await withMergeLock(target, async () => {
    const second = await mergeOntoMain(
      target,
      ticket,
      worktree,
      journal,
      "merge still broken after conflict agent",
    );
    if (second === "conflict") {
      await fail(target, ticket, "merge still broken after conflict agent", journal);
    }
  });
}

export async function recoverLeftovers(target: string, journal: Journal): Promise<void> {
  await withMergeLock(target, async () => {
    for (const ticket of leftoverInFlight(scanTickets(target))) {
      const oldStatus = ticket.status;
      if (await isAncestor(target, ticket.branch, "HEAD")) {
        journal.log(`${ticket.id} leftover in-flight (${oldStatus}) → MERGED`);
        await stamp(target, ticket, "MERGED", journal);
        await removeWorktreeAndBranch(target, ticket);
      } else {
        journal.log(`${ticket.id} leftover in-flight (${oldStatus}) → FAILED`);
        await stamp(target, ticket, "FAILED", journal);
      }
    }
  });
}
