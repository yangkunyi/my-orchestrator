/**
 * The settle sequence: the merge route for one Ticket, and the FAILED transitions it decides on.
 * Every FAILED here goes through main-writes' failTicket under the transaction that wraps this
 * sequence (ADR-0042); the two checks that run before a transaction open one for their single stamp.
 */
import { hasCommitsAhead, revParse, worktreeDirty } from "./git.ts";
import {
  completeTicket,
  failTicket,
  integrateCurrentMainIntoWorktree,
  stamp,
  tryMerge,
  withMergeLock,
} from "./main-writes.ts";
import { RESOLVE, type SettleResult } from "./node-outcomes.ts";
import type { Ticket } from "./tickets.ts";

function log(msg: string): void {
  console.error(msg);
}

async function settleMerge(
  target: string,
  ticket: Ticket,
  result: "ok" | "conflict" | "failed" | "empty",
  brokenReason: string,
): Promise<"merged" | "failed" | "conflict"> {
  if (result === "ok") {
    await completeTicket(target, ticket);
    return "merged";
  }
  if (result === "empty") {
    await failTicket(target, ticket, "merge produced no new commit on Main");
    return "failed";
  }
  if (result === "conflict") return "conflict";
  await failTicket(target, ticket, brokenReason);
  return "failed";
}

/**
 * Mark MERGING and merge, inside the caller's transaction: another writer must not slip between
 * the stamp and the merge. settleAfterAgent and settleAfterConflict open that transaction.
 */
async function mergeOntoMain(
  target: string,
  ticket: Ticket,
  worktree: string,
  brokenReason: string,
  lastError?: string,
): Promise<"merged" | "failed" | "conflict"> {
  if (!(await hasCommitsAhead(worktree, await revParse(target)))) {
    const reason = lastError
      ? `no commits on ticket branch that Main does not have (${lastError})`
      : "no commits on ticket branch that Main does not have";
    await failTicket(target, ticket, reason);
    return "failed";
  }
  await stamp(target, ticket, "MERGING");
  return settleMerge(target, ticket, await tryMerge(target, ticket.branch), brokenReason);
}

export async function settleAfterConflict(
  target: string,
  ticket: Ticket,
  worktree: string,
  lastError?: string,
): Promise<"merged" | "failed"> {
  if (await worktreeDirty(worktree)) {
    // One stamp, its own transaction: nothing is held at this point.
    await withMergeLock(target, () =>
      failTicket(target, ticket, "worktree dirty after conflict agent"),
    );
    return "failed";
  }
  // The caller opens the transaction: mergeOntoMain's stamp and merge are one atomic step.
  return withMergeLock(target, async () => {
    const second = await mergeOntoMain(
      target,
      ticket,
      worktree,
      "merge still broken after conflict agent",
      lastError,
    );
    if (second === "conflict") {
      await failTicket(target, ticket, "merge still broken after conflict agent");
      return "failed";
    }
    return second;
  });
}

export async function settleAfterAgent(
  target: string,
  ticket: Ticket,
  worktree: string,
  lastError?: string,
): Promise<SettleResult> {
  if (await worktreeDirty(worktree)) {
    // One stamp, its own transaction: the settle transaction has not opened yet.
    await withMergeLock(target, () => failTicket(target, ticket, "worktree dirty after implement"));
    return "failed";
  }

  // The caller opens the transaction for the whole conflict route: stamping CONFLICT, integrating
  // current Main and re-merging must not be split by another writer.
  return withMergeLock(target, async () => {
    const first = await mergeOntoMain(
      target,
      ticket,
      worktree,
      "git merge failed without MERGE_HEAD",
      lastError,
    );
    if (first !== "conflict") return first;
    await stamp(target, ticket, "CONFLICT");
    const integrated = await integrateCurrentMainIntoWorktree(target, worktree);
    if (integrated === "failed") {
      await failTicket(target, ticket, "could not merge Main into Worktree");
      return "failed";
    }
    if (integrated === "conflict") {
      log(`${ticket.id} conflict; resolve`);
      return RESOLVE;
    }
    const rematch = await settleMerge(
      target,
      ticket,
      await tryMerge(target, ticket.branch),
      "merge still broken after integrating Main",
    );
    if (rematch === "conflict") {
      await failTicket(target, ticket, "merge still broken after integrating Main");
      return "failed";
    }
    return rematch;
  });
}
