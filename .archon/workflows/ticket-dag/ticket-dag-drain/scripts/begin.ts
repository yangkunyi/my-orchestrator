import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { branchExists, git, gitOrThrow } from "./git.ts";
import {
  failTicket,
  integrateCurrentMainIntoWorktree,
  stamp,
  withMergeLock,
} from "./main-writes.ts";
import { RESOLVE, type BeginOutcome } from "./node-outcomes.ts";
import type { Ticket } from "./tickets.ts";
import { ensureVenvIgnored, ensureWorktreesIgnored, syncWorktreeEnv } from "./worktree-env.ts";

export type BeginResult = {
  worktree: string;
  outcome: BeginOutcome;
  ok: boolean;
};

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
