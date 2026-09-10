import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  branchExists,
  git,
  gitOrThrow,
  integrateMainIntoWorktree,
  revParse,
  stamp,
  withMergeLock,
} from "./git.ts";
import type { Ticket } from "./tickets.ts";
import { ensureVenvIgnored, ensureWorktreesIgnored, syncWorktreeEnv } from "./worktree-env.ts";

export type BeginOutcome = "ready" | "failed" | "resolve";

export type BeginResult = {
  worktree: string;
  outcome: BeginOutcome;
  ok: boolean;
  reason?: string;
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

function result(worktree: string, outcome: BeginOutcome, reason?: string): BeginResult {
  return { worktree, outcome, ok: outcome === "ready", reason };
}

export async function beginTicket(target: string, ticket: Ticket): Promise<BeginResult> {
  const begun = await withMergeLock(target, async () => {
    await ensureWorktreesIgnored(target);
    await ensureVenvIgnored(target);
    await stamp(target, ticket, "RUNNING");
    const path = await ensureWorktree(target, ticket);
    const integrated = await integrateMainIntoWorktree(path, await revParse(target));
    return { path, integrated };
  });
  if (begun.integrated === "conflict") {
    return result(begun.path, "resolve");
  }
  if (begun.integrated === "failed") {
    await stamp(target, ticket, "FAILED");
    return result(begun.path, "failed", "could not merge Main into Worktree");
  }
  try {
    await syncWorktreeEnv(begun.path);
    return result(begun.path, "ready");
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await stamp(target, ticket, "FAILED");
    return result(begun.path, "failed", reason);
  }
}
