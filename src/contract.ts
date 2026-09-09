import {
  createWorktree,
  hasCommitsAhead,
  integrateMainIntoWorktree,
  removeWorktreeAndBranch,
  revParse,
  tryMerge,
  withMergeLock,
  worktreeDirty,
} from "./git.js";
import type { Journal } from "./journal.js";
import { stamp } from "./status.js";
import type { Ticket } from "./tickets.js";

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
  if (!(await hasCommitsAhead(worktree, await revParse(target)))) {
    const reason = lastError
      ? `no commits on ticket branch that Main does not have (${lastError})`
      : "no commits on ticket branch that Main does not have";
    await fail(target, ticket, reason, journal);
    return "failed";
  }

  return withMergeLock(target, async () => {
    await stamp(target, ticket, "MERGING", journal);
    const result = await tryMerge(target, ticket.branch);
    if (result === "ok") {
      await stamp(target, ticket, "MERGED", journal);
      await removeWorktreeAndBranch(target, ticket);
      return "merged";
    }
    if (result === "empty") {
      await fail(target, ticket, "merge produced no new commit on Main", journal);
      return "failed";
    }
    if (result === "failed") {
      await fail(target, ticket, "git merge failed without MERGE_HEAD", journal);
      return "failed";
    }
    await stamp(target, ticket, "CONFLICT", journal);
    const integrated = await integrateMainIntoWorktree(worktree, await revParse(target));
    if (integrated === "failed") {
      await fail(target, ticket, "could not merge Main into Worktree", journal);
      return "failed";
    }
    if (integrated === "conflict") return "resolve";
    const rematch = await tryMerge(target, ticket.branch);
    if (rematch === "ok") {
      await stamp(target, ticket, "MERGED", journal);
      await removeWorktreeAndBranch(target, ticket);
      return "merged";
    }
    if (rematch === "empty") {
      await fail(target, ticket, "merge produced no new commit on Main", journal);
      return "failed";
    }
    await fail(target, ticket, "merge still broken after integrating Main", journal);
    return "failed";
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
    await stamp(target, ticket, "MERGING", journal);
    const second = await tryMerge(target, ticket.branch);
    if (second === "ok") {
      await stamp(target, ticket, "MERGED", journal);
      await removeWorktreeAndBranch(target, ticket);
      return;
    }
    if (second === "empty") {
      await fail(target, ticket, "merge produced no new commit on Main", journal);
      return;
    }
    await fail(target, ticket, "merge still broken after conflict agent", journal);
  });
}
