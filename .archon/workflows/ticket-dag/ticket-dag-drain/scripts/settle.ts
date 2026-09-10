import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  hasCommitsAhead,
  integrateMainIntoWorktree,
  removeWorktreeAndBranch,
  revParse,
  stamp,
  tryMerge,
  withMergeLock,
  worktreeDirty,
} from "./git.ts";
import { runNode } from "./node-entry.ts";
import { scanTickets, type Ticket } from "./tickets.ts";

export type SettleResult = "merged" | "failed" | "resolve";

function log(msg: string): void {
  console.error(msg);
}

export async function fail(target: string, ticket: Ticket, reason: string): Promise<void> {
  await withMergeLock(target, async () => {
    log(`${ticket.id} FAILED: ${reason}`);
    await stamp(target, ticket, "FAILED");
  });
}

async function settleMerge(
  target: string,
  ticket: Ticket,
  result: "ok" | "conflict" | "failed" | "empty",
  brokenReason: string,
): Promise<"merged" | "failed" | "conflict"> {
  if (result === "ok") {
    await stamp(target, ticket, "MERGED");
    await removeWorktreeAndBranch(target, ticket);
    return "merged";
  }
  if (result === "empty") {
    await fail(target, ticket, "merge produced no new commit on Main");
    return "failed";
  }
  if (result === "conflict") return "conflict";
  await fail(target, ticket, brokenReason);
  return "failed";
}

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
    await fail(target, ticket, reason);
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
    await fail(target, ticket, "worktree dirty after conflict agent");
    return "failed";
  }
  return withMergeLock(target, async () => {
    const second = await mergeOntoMain(
      target,
      ticket,
      worktree,
      "merge still broken after conflict agent",
      lastError,
    );
    if (second === "conflict") {
      await fail(target, ticket, "merge still broken after conflict agent");
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
    await fail(target, ticket, "worktree dirty after implement");
    return "failed";
  }

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
    const integrated = await integrateMainIntoWorktree(worktree, await revParse(target));
    if (integrated === "failed") {
      await fail(target, ticket, "could not merge Main into Worktree");
      return "failed";
    }
    if (integrated === "conflict") {
      log(`${ticket.id} conflict; resolve`);
      return "resolve";
    }
    const rematch = await settleMerge(
      target,
      ticket,
      await tryMerge(target, ticket.branch),
      "merge still broken after integrating Main",
    );
    if (rematch === "conflict") {
      await fail(target, ticket, "merge still broken after integrating Main");
      return "failed";
    }
    return rematch;
  });
}

if (import.meta.main) {
  await runNode({
    ticket: true,
    run: async ({ target, ticketId }) => {
      const ticket = scanTickets(target).find((t) => t.id === ticketId);
      if (!ticket) throw new Error(`ticket not found: ${ticketId}`);
      const worktree = join(target, ticket.worktreeRel);
      if (!existsSync(worktree)) throw new Error(`worktree missing: ${worktree}`);
      return `${await settleAfterAgent(target, ticket, worktree)}\n`;
    },
  });
}
