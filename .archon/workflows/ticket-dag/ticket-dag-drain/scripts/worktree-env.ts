import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { ensureGitignoreLine } from "./main-writes.ts";

const execFile = promisify(execFileCb);

/** The Ticket Worktree's environment: its own .venv on PATH, its uv sync, its ignore lines on Main. */

/**
 * The environment one session under this cwd runs under: this Worktree's `.venv/bin` first, then the
 * base the adapter brought (Pi's spawn context, dsh's child environment). The seam carries this as a
 * transform rather than a resolved environment, so an adapter keeps whatever else its own base needs.
 *
 * A cwd with no `.venv/bin` - the Target, where the drain-end readers run - returns the base untouched.
 * That is what makes it safe for every role to apply, and impossible for one runner to honour the
 * Worktree rule while another quietly drops it.
 */
export function sessionEnv(cwd: string, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const bin = join(cwd, ".venv", "bin");
  if (!existsSync(bin)) return base;
  return { ...base, PATH: `${bin}${delimiter}${base.PATH ?? ""}` };
}

/**
 * One bash call's spawn context with the seam's environment applied: the shape Pi's spawnHook takes and
 * returns, minus any Pi type, so what Pi hands bash is assertable without a session - the SDK captures
 * the hook inside the tool definition, where nothing can reach it. A cwd with no `.venv` leaves the
 * context's own environment as it was.
 */
export function sessionSpawnEnv(
  seamEnv: (base: NodeJS.ProcessEnv) => NodeJS.ProcessEnv,
  ctx: { command: string; cwd: string; env: NodeJS.ProcessEnv },
): { command: string; cwd: string; env: NodeJS.ProcessEnv } {
  return { ...ctx, env: seamEnv(ctx.env) };
}

export async function syncWorktreeEnv(worktree: string): Promise<void> {
  if (!existsSync(join(worktree, "pyproject.toml"))) return;
  try {
    await execFile("uv", ["sync", "--frozen"], { cwd: worktree, encoding: "utf8" });
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    throw new Error(`uv sync --frozen failed: ${(err.stderr || err.stdout || err.message || String(e)).trim()}`);
  }
}

/** Writes Main, so it stays inside the caller's transaction: beginTicket holds it. */
export async function ensureWorktreesIgnored(target: string): Promise<void> {
  await ensureGitignoreLine(target, "worktrees/", ["worktrees", "/worktrees/"], "chore(orchestrator): ignore worktrees/");
}

export async function ensureVenvIgnored(target: string): Promise<void> {
  await ensureGitignoreLine(target, ".venv/", [".venv", "/.venv/"], "chore(orchestrator): ignore .venv/");
}
