import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { ensureGitignoreLine } from "./git.ts";

const execFile = promisify(execFileCb);

/** The Ticket Worktree's environment: its own .venv on PATH, its uv sync, its ignore lines on Main. */

export function prependVenvBin(path: string | undefined, worktree: string): string {
  const bin = join(worktree, ".venv", "bin");
  if (!existsSync(bin)) return path ?? "";
  return `${bin}${delimiter}${path ?? ""}`;
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

export async function ensureWorktreesIgnored(target: string): Promise<void> {
  await ensureGitignoreLine(target, "worktrees/", ["worktrees", "/worktrees/"], "chore(orchestrator): ignore worktrees/");
}

export async function ensureVenvIgnored(target: string): Promise<void> {
  await ensureGitignoreLine(target, ".venv/", [".venv", "/.venv/"], "chore(orchestrator): ignore .venv/");
}
