import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { simpleGit } from "simple-git";
import type { Ticket } from "./tickets.js";

const lockHeld = new AsyncLocalStorage<true>();

function gitClient(cwd: string) {
  return simpleGit({ baseDir: cwd });
}

async function git(
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const stdout = await gitClient(cwd).raw(args);
    return { ok: true, stdout: (stdout ?? "").trim(), stderr: "" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, stdout: "", stderr: msg };
  }
}

async function gitOrThrow(cwd: string, args: string[]): Promise<string> {
  const r = await git(cwd, args);
  if (!r.ok) throw new Error(`git ${args.join(" ")}\n${r.stderr || r.stdout}`);
  return r.stdout;
}

export async function assertCleanMain(target: string): Promise<void> {
  const r = await gitOrThrow(target, ["status", "--porcelain"]);
  if (r.length > 0) {
    throw new Error(`Target Main is dirty; refusing to start:\n${r}`);
  }
}

function gitignoreHas(body: string, patterns: string[]): boolean {
  return body.split(/\r?\n/).some((l) => patterns.includes(l.trim()));
}

async function ensureGitignoreLine(
  target: string,
  line: string,
  aliases: string[],
  message: string,
): Promise<void> {
  await withMergeLock(target, async () => {
    const gi = join(target, ".gitignore");
    const body = existsSync(gi) ? readFileSync(gi, "utf8") : "";
    if (gitignoreHas(body, [line, ...aliases])) return;
    appendFileSync(gi, body.endsWith("\n") || body.length === 0 ? `${line}\n` : `\n${line}\n`);
    await gitOrThrow(target, ["add", ".gitignore"]);
    await gitOrThrow(target, ["commit", "-m", message]);
  });
}

export async function ensureWorktreesIgnored(target: string): Promise<void> {
  await ensureGitignoreLine(target, "worktrees/", ["worktrees", "/worktrees/"], "chore(orchestrator): ignore worktrees/");
}

export async function ensureRunsIgnored(target: string): Promise<void> {
  await ensureGitignoreLine(
    target,
    ".scratch/orchestrator/runs/",
    [".scratch/orchestrator/runs"],
    "chore(orchestrator): ignore orchestrator runs",
  );
}

export async function commitFiles(target: string, paths: string[], message: string): Promise<void> {
  await withMergeLock(target, async () => {
    await gitOrThrow(target, ["add", ...paths]);
    await gitOrThrow(target, ["commit", "-m", message]);
  });
}

/** True iff `maybeAncestor` is an ancestor of `ref` (`git merge-base --is-ancestor`). */
export async function isAncestor(cwd: string, maybeAncestor: string, ref: string): Promise<boolean> {
  return (await git(cwd, ["merge-base", "--is-ancestor", maybeAncestor, ref])).ok;
}

export async function createWorktree(target: string, ticket: Ticket): Promise<string> {
  return withMergeLock(target, async () => {
    const path = join(target, ticket.worktreeRel);
    mkdirSync(join(target, "worktrees"), { recursive: true });
    await gitOrThrow(target, ["worktree", "add", "-b", ticket.branch, path, "HEAD"]);
    return path;
  });
}

export async function worktreeDirty(worktree: string): Promise<boolean> {
  return (await gitOrThrow(worktree, ["status", "--porcelain"])).length > 0;
}

/** True iff worktree HEAD has commits that `base` (Main HEAD) does not. */
export async function hasCommitsAhead(worktree: string, base: string): Promise<boolean> {
  const n = await gitOrThrow(worktree, ["rev-list", "--count", `${base}..HEAD`]);
  return Number(n) > 0;
}

async function inMerge(cwd: string): Promise<boolean> {
  return (await git(cwd, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])).ok;
}

export async function withMergeLock<T>(target: string, fn: () => Promise<T>): Promise<T> {
  if (lockHeld.getStore()) return fn();
  const gitDir = await gitOrThrow(target, ["rev-parse", "--git-dir"]);
  const lockTarget = join(target, gitDir);
  const release = await lockfile.lock(lockTarget, { retries: { retries: 30, minTimeout: 200, maxTimeout: 2000 } });
  try {
    return await lockHeld.run(true, fn);
  } finally {
    await release();
  }
}

/** Try merge on Main. On conflict, abort so Main stays clean. */
export async function tryMerge(
  target: string,
  branch: string,
): Promise<"ok" | "conflict" | "failed" | "empty"> {
  return withMergeLock(target, async () => {
    const before = await gitOrThrow(target, ["rev-parse", "HEAD"]);
    const r = await git(target, ["merge", "--no-ff", "-m", `orchestrator: merge ${branch}`, branch]);
    if (r.ok) {
      const after = await gitOrThrow(target, ["rev-parse", "HEAD"]);
      return before === after ? "empty" : "ok";
    }
    if (await inMerge(target)) {
      await git(target, ["merge", "--abort"]);
      return "conflict";
    }
    return "failed";
  });
}

export async function integrateMainIntoWorktree(
  worktree: string,
  mainRef: string,
): Promise<"ok" | "conflict" | "failed"> {
  const r = await git(worktree, ["merge", "--no-ff", mainRef]);
  if (r.ok) return "ok";
  if (await inMerge(worktree)) return "conflict";
  return "failed";
}

export async function removeWorktreeAndBranch(target: string, ticket: Ticket): Promise<void> {
  await withMergeLock(target, async () => {
    await git(target, ["worktree", "remove", "--force", join(target, ticket.worktreeRel)]);
    await git(target, ["branch", "-D", ticket.branch]);
  });
}

export async function revParse(cwd: string, ref = "HEAD"): Promise<string> {
  return gitOrThrow(cwd, ["rev-parse", ref]);
}
