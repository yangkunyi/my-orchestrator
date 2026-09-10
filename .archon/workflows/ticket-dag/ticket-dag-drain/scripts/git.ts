import { AsyncLocalStorage } from "node:async_hooks";
import { execFile as execFileCb } from "node:child_process";
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
import { promisify } from "node:util";
import type { Status, Ticket } from "./tickets.ts";

const execFile = promisify(execFileCb);
const lockHeld = new AsyncLocalStorage<true>();

export async function git(
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFile("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true, stdout: (stdout ?? "").trim(), stderr: (stderr ?? "").trim() };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: (err.stdout ?? "").trim(),
      stderr: (err.stderr ?? err.message ?? "").trim(),
    };
  }
}

export async function gitOrThrow(cwd: string, args: string[]): Promise<string> {
  const r = await git(cwd, args);
  if (!r.ok) throw new Error(`git ${args.join(" ")}\n${r.stderr || r.stdout}`);
  return r.stdout;
}

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
  const body = readFileSync(absPath, "utf8");
  const next = /^(?:\*\*)?Status\s*:(?:\*\*)?\s*.+$/im.test(body)
    ? body.replace(/^(?:\*\*)?Status\s*:(?:\*\*)?\s*.+$/im, `Status: ${status}`)
    : `${body.trimEnd()}\n\nStatus: ${status}\n`;
  writeFileSync(absPath, next);
}

export async function stamp(target: string, ticket: Ticket, status: Status): Promise<void> {
  await withMergeLock(target, async () => {
    setStatusInFile(ticket.absPath, status);
    await gitOrThrow(target, ["add", ticket.relPath]);
    await gitOrThrow(target, ["commit", "-m", `orchestrator: ${ticket.id} Status ${status}`]);
    ticket.status = status;
  });
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
    if (subject !== `orchestrator: merge ${branch}`) continue;
    const p2 = parents[1]!;
    const onBranch = await git(target, ["merge-base", "--is-ancestor", p2, branch]);
    if (onBranch.ok) return true;
  }
  return false;
}

export async function removeWorktreeAndBranch(target: string, ticket: Ticket): Promise<void> {
  await git(target, ["worktree", "remove", "--force", join(target, ticket.worktreeRel)]);
  await git(target, ["branch", "-D", ticket.branch]);
}

export async function revParse(cwd: string, ref = "HEAD"): Promise<string> {
  return gitOrThrow(cwd, ["rev-parse", ref]);
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

/** Try merge on Main. On conflict, abort so Main stays clean. Caller holds withMergeLock. */
export async function tryMerge(
  target: string,
  branch: string,
): Promise<"ok" | "conflict" | "failed" | "empty"> {
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
}

export async function branchExists(target: string, branch: string): Promise<boolean> {
  return (await git(target, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).ok;
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

export async function ensureVenvIgnored(target: string): Promise<void> {
  await ensureGitignoreLine(target, ".venv/", [".venv", "/.venv/"], "chore(orchestrator): ignore .venv/");
}
