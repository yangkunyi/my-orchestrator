import { AsyncLocalStorage } from "node:async_hooks";
import {
  appendFileSync,
  closeSync,
  constants,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { git, gitOrThrow, removeWorktreeAndBranch, revParse } from "./git.ts";
import { mergeMessage, statusLine, statusMessage, type Status } from "./ticket-line.ts";
import type { Ticket } from "./tickets.ts";

/**
 * The Main-write seam. Every function here writes Main and asserts the caller already holds the
 * lock; only withMergeLock takes it, so the caller opens the transaction where a sequence of
 * writes has to be atomic.
 */
const lockHeld = new AsyncLocalStorage<true>();

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function lockFilePath(target: string): Promise<string> {
  const gitDir = await gitOrThrow(target, ["rev-parse", "--git-dir"]);
  const abs = isAbsolute(gitDir) ? gitDir : resolve(target, gitDir);
  return join(abs, "ticket-dag.lock");
}

async function acquireLock(path: string): Promise<number> {
  const start = Date.now();
  while (true) {
    try {
      const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR);
      writeFileSync(fd, `${process.pid}\n`);
      return fd;
    } catch (e) {
      const err = e as { code?: string };
      if (err.code !== "EEXIST") throw e;
      if (existsSync(path)) {
        const raw = readFileSync(path, "utf8").trim();
        const pid = Number(raw);
        if (!Number.isInteger(pid) || pid <= 0 || !pidAlive(pid)) {
          try {
            unlinkSync(path);
          } catch {
            /* raced */
          }
          continue;
        }
      }
      if (Date.now() - start > 60_000) throw new Error(`timeout waiting for merge lock ${path}`);
      await sleep(50);
    }
  }
}

/** True when this async context already holds the Main lock. */
export function isLockHeld(): boolean {
  return lockHeld.getStore() === true;
}

function assertLockHeld(what: string): void {
  if (!isLockHeld()) {
    throw new Error(`${what} writes Main and must run inside withMergeLock(target, …)`);
  }
}

/** Serial Main writes. Pack lock file, not the CLI proper-lockfile. Re-enters when held. */
export async function withMergeLock<T>(target: string, fn: () => Promise<T>): Promise<T> {
  if (lockHeld.getStore()) return fn();
  const path = await lockFilePath(target);
  const fd = await acquireLock(path);
  try {
    return await lockHeld.run(true, fn);
  } finally {
    closeSync(fd);
    try {
      unlinkSync(path);
    } catch {
      /* gone */
    }
  }
}

function setStatusInFile(absPath: string, status: Status): void {
  writeFileSync(absPath, statusLine(readFileSync(absPath, "utf8"), status));
}

/** Status transition on Main: rewrite the line and commit it, inside the caller's transaction. */
export async function stamp(target: string, ticket: Ticket, status: Status): Promise<void> {
  assertLockHeld("stamp");
  setStatusInFile(ticket.absPath, status);
  await gitOrThrow(target, ["add", ticket.relPath]);
  await gitOrThrow(target, ["commit", "-m", statusMessage(ticket.id, status)]);
  ticket.status = status;
}

/**
 * Complete a Ticket whose merge commit is already on Main (ADR-0029): stamp MERGED, then drop the
 * Worktree and branch, never re-merge. The stamp-then-remove order lives here, not in the callers.
 */
export async function completeTicket(target: string, ticket: Ticket): Promise<void> {
  assertLockHeld("completeTicket");
  await stamp(target, ticket, "MERGED");
  await removeWorktreeAndBranch(target, ticket);
}

/**
 * The one writer of a FAILED Status, and the one place a Ticket's failure reason is recorded - every
 * failure route ends here (begin's two post-lock sites, a node's catch block, settle's own sequence),
 * so no FAILED can be silent. It keeps the stderr wording the drain already promised
 * (`<id> FAILED: <reason>`), and ADR-0042's lock policy: this asserts the caller's transaction, and
 * each caller opens one - its own when it holds none.
 */
export async function failTicket(target: string, ticket: Ticket, reason: string): Promise<void> {
  assertLockHeld("failTicket");
  console.error(`${ticket.id} FAILED: ${reason}`);
  await stamp(target, ticket, "FAILED");
}

/** True iff Main has that Ticket's --no-ff merge commit (message + second parent on the branch). */
export async function hasTicketMergeCommit(target: string, branch: string): Promise<boolean> {
  const log = await git(target, ["log", "--format=%P%x00%s", "HEAD"]);
  if (!log.ok || !log.stdout) return false;
  for (const line of log.stdout.split("\n")) {
    const nul = line.indexOf("\0");
    if (nul < 0) continue;
    const parents = line.slice(0, nul).split(" ").filter(Boolean);
    const subject = line.slice(nul + 1);
    if (parents.length < 2) continue;
    if (subject !== mergeMessage(branch)) continue;
    const p2 = parents[1]!;
    const onBranch = await git(target, ["merge-base", "--is-ancestor", p2, branch]);
    if (onBranch.ok) return true;
  }
  return false;
}

async function inMerge(cwd: string): Promise<boolean> {
  return (await git(cwd, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])).ok;
}

/** Try merge on Main. On conflict, abort so Main stays clean. */
export async function tryMerge(
  target: string,
  branch: string,
): Promise<"ok" | "conflict" | "failed" | "empty"> {
  assertLockHeld("tryMerge");
  const before = await gitOrThrow(target, ["rev-parse", "HEAD"]);
  const r = await git(target, ["merge", "--no-ff", "-m", mergeMessage(branch), branch]);
  if (r.ok) {
    const after = await gitOrThrow(target, ["rev-parse", "HEAD"]);
    return before === after ? "empty" : "ok";
  }
  if (await inMerge(target)) {
    await git(target, ["merge", "--abort"]);
    return "conflict";
  }
  return "failed";
}

/** Merge Main into the Ticket Worktree, leaving the conflict in the tree for the Conflict Agent. */
async function integrateMainIntoWorktree(
  worktree: string,
  mainRef: string,
): Promise<"ok" | "conflict" | "failed"> {
  assertLockHeld("integrateMainIntoWorktree");
  const r = await git(worktree, ["merge", "--no-ff", mainRef]);
  if (r.ok) return "ok";
  if (await inMerge(worktree)) return "conflict";
  return "failed";
}

/**
 * Put current Main onto the Ticket Worktree and report how it went. The caller keeps its own
 * Status stamp (RUNNING, CONFLICT) and its own failure message for the outcome it gets.
 */
export async function integrateCurrentMainIntoWorktree(
  target: string,
  worktree: string,
): Promise<"ok" | "conflict" | "failed"> {
  assertLockHeld("integrateCurrentMainIntoWorktree");
  return integrateMainIntoWorktree(worktree, await revParse(target));
}

function gitignoreHas(body: string, patterns: string[]): boolean {
  return body.split(/\r?\n/).some((l) => patterns.includes(l.trim()));
}

/**
 * Append one ignore line to the Target .gitignore and commit it on Main, inside the caller's
 * transaction: the read, the append and the commit must not be split by another writer.
 */
export async function ensureGitignoreLine(
  target: string,
  line: string,
  aliases: string[],
  message: string,
): Promise<void> {
  assertLockHeld("ensureGitignoreLine");
  const gi = join(target, ".gitignore");
  const body = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (gitignoreHas(body, [line, ...aliases])) return;
  appendFileSync(gi, body.endsWith("\n") || body.length === 0 ? `${line}\n` : `\n${line}\n`);
  await gitOrThrow(target, ["add", ".gitignore"]);
  await gitOrThrow(target, ["commit", "-m", message]);
}
