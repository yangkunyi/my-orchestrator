import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function prependVenvBin(path: string | undefined, worktree: string): string {
  const bin = join(worktree, ".venv", "bin");
  if (!existsSync(bin)) return path ?? "";
  return `${bin}${delimiter}${path ?? ""}`;
}

export async function syncWorktreeEnv(worktree: string): Promise<void> {
  if (!existsSync(join(worktree, "pyproject.toml"))) return;
  try {
    await execFileAsync("uv", ["sync", "--frozen"], { cwd: worktree, encoding: "utf8" });
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    throw new Error(`uv sync --frozen failed: ${(err.stderr || err.stdout || err.message || String(e)).trim()}`);
  }
}
