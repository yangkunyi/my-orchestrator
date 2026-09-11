/**
 * The Ticket's transitions: what may happen to one Ticket, in what order, and which transaction wraps
 * each step. main-writes.ts owns the lock and the raw writes (ADR-0042); a verb here opens the
 * transaction around a route of its own, and the two that run inside a drain sweep (openUnblocked under
 * pick, recoverLeftover under the leftover pass) say so and assert the caller's. This file is the one
 * place the sequence below is written down:
 *
 *   BLOCKED   -> READY     openUnblocked: every blocker MERGED; pick opens the transaction.
 *   READY     -> RUNNING   beginTicket: worktree from Main HEAD, the stamp and the create are one step.
 *   FAILED    -> RUNNING   beginTicket on resume: Main integrated into the kept worktree first.
 *   RUNNING   -> MERGING   settleAfterAgent -> mergeOntoMain: the stamp and the merge are one step.
 *   RUNNING   -> FAILED    beginTicket's env sync / settleAfterAgent's dirty tree: one-stamp transaction.
 *   MERGING   -> MERGED    completeTicket (main-writes) inside that same transaction.
 *   MERGING   -> CONFLICT  settleAfterAgent, stamped before Main is integrated into the Worktree.
 *   MERGING   -> FAILED    settleAfterAgent's merge outcomes, each its own one-stamp transaction.
 *   CONFLICT  -> RESOLVING markResolving: one Main write; the turn it hands off to stays outside the lock.
 *   RESOLVING -> MERGED    settleAfterConflict -> completeTicket, one transaction.
 *   RESOLVING -> FAILED    settleAfterConflict's outcomes, each its own one-stamp transaction.
 *   in flight -> MERGED or FAILED  recoverLeftover: MERGED iff Main already has the merge commit.
 *
 * The settle sequence: every FAILED goes through main-writes' failTicket under the transaction that
 * wraps it (ADR-0042); the two checks that run before a transaction open one of their own for their
 * single stamp.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  branchExists,
  git,
  gitOrThrow,
  hasCommitsAhead,
  revParse,
  worktreeDirty,
} from "./git.ts";
import {
  completeTicket,
  failTicket,
  hasTicketMergeCommit,
  integrateCurrentMainIntoWorktree,
  stamp,
  tryMerge,
  withMergeLock,
} from "./main-writes.ts";
import { RESOLVE, type BeginOutcome, type SettleResult } from "./node-outcomes.ts";
import {
  blockersMerged,
  byId,
  isBlocked,
  scanTickets,
  type Ticket,
} from "./tickets.ts";
import { ensureVenvIgnored, ensureWorktreesIgnored, syncWorktreeEnv } from "./worktree-env.ts";

type BeginResult = {
  worktree: string;
  outcome: BeginOutcome;
  ok: boolean;
};

/** BLOCKED -> READY for every Ticket whose blockers have all MERGED. Runs in the caller's transaction
 * (pick opens it), so the stamps and the pick that follows see one Main. */
export async function openUnblocked(target: string): Promise<void> {
  const tickets = scanTickets(target);
  const map = byId(tickets);
  for (const ticket of tickets) {
    if (isBlocked(ticket.status) && blockersMerged(ticket, map)) {
      await stamp(target, ticket, "READY");
    }
  }
}

async function ensureWorktree(target: string, ticket: Ticket): Promise<string> {
  const path = join(target, ticket.worktreeRel);
  mkdirSync(join(target, "worktrees"), { recursive: true });
  if (existsSync(path)) return path;
  await git(target, ["worktree", "prune"]);
  if (await branchExists(target, ticket.branch)) {
    await gitOrThrow(target, ["worktree", "add", path, ticket.branch]);
  } else {
    await gitOrThrow(target, ["worktree", "add", "-b", ticket.branch, path, "HEAD"]);
  }
  return path;
}

function result(worktree: string, outcome: BeginOutcome): BeginResult {
  return { worktree, outcome, ok: outcome === "ready" };
}

export async function beginTicket(target: string, ticket: Ticket): Promise<BeginResult> {
  // One transaction: the RUNNING stamp, the new Worktree and its base (current Main) must describe
  // the same Main commit, and the .gitignore commits go with them.
  const begun = await withMergeLock(target, async () => {
    await ensureWorktreesIgnored(target);
    await ensureVenvIgnored(target);
    await stamp(target, ticket, "RUNNING");
    const path = await ensureWorktree(target, ticket);
    const integrated = await integrateCurrentMainIntoWorktree(target, path);
    return { path, integrated };
  });
  if (begun.integrated === "conflict") {
    return result(begun.path, RESOLVE);
  }
  if (begun.integrated === "failed") {
    // Its own transaction: the begin lock is released before the env sync, which must not hold it.
    await withMergeLock(target, () => failTicket(target, ticket, "could not merge Main into Worktree"));
    return result(begun.path, "failed");
  }
  try {
    await syncWorktreeEnv(begun.path);
    return result(begun.path, "ready");
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    // Same as the failure above: its own transaction, after the lock was released.
    await withMergeLock(target, () => failTicket(target, ticket, reason));
    return result(begun.path, "failed");
  }
}

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

/**
 * CONFLICT -> RESOLVING: one Main write, and the agent turn this verb hands off to stays outside the
 * lock, so this is the whole transaction (ADR-0042). The conflict node calls it before it re-syncs the
 * Worktree environment and runs the turn.
 */
export async function markResolving(target: string, ticket: Ticket): Promise<void> {
  await withMergeLock(target, () => stamp(target, ticket, "RESOLVING"));
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

/**
 * A leftover in-flight Ticket: MERGED iff Main already has that Ticket branch's merge commit, otherwise
 * FAILED with the reason recorded. It is the one FAILED writer of the leftover pass, so the reason is
 * recorded too - this used to be a bare stamp. Runs in the caller's transaction: the leftover pass opens
 * one around the whole sweep.
 */
export async function recoverLeftover(
  target: string,
  ticket: Ticket,
): Promise<"merged" | "failed"> {
  if (await hasTicketMergeCommit(target, ticket.branch)) {
    await completeTicket(target, ticket);
    return "merged";
  }
  await failTicket(target, ticket, "leftover in flight and Main has no merge commit of its branch");
  return "failed";
}
