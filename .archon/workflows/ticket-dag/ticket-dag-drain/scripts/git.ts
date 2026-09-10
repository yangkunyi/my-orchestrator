import { execFile as execFileCb } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Ticket } from "./tickets.ts";

/** Git plumbing only. Anything that writes Main lives in main-writes.ts. */
const execFile = promisify(execFileCb);

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

export async function branchExists(target: string, branch: string): Promise<boolean> {
  return (await git(target, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).ok;
}
