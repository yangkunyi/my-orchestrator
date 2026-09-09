#!/usr/bin/env node
/** Drive shipped worktree uv env: no Main .venv on Run PATH; sync --frozen; session PATH. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { prependVenvBin, syncWorktreeEnv } from "../dist/worktree.js";
import { childEnv } from "../dist/proxy.js";

const pyproject = `[project]
name = "wt"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = []
`;

const dir = mkdtempSync(join(tmpdir(), "venv-path-check-"));
try {
  mkdirSync(join(dir, ".venv", "bin"), { recursive: true });
  const env = childEnv({ httpProxy: undefined });
  const mainVenv = join(dir, ".venv", "bin");
  const pathParts = (env.PATH ?? "").split(delimiter);
  if (pathParts.includes(mainVenv)) {
    throw new Error(`Run PATH still has Main venv: ${env.PATH}`);
  }

  const skipDir = join(dir, "nopy");
  mkdirSync(skipDir);
  await syncWorktreeEnv(skipDir);
  if (existsSync(join(skipDir, ".venv"))) {
    throw new Error("sync without pyproject.toml created .venv");
  }

  const noLock = join(dir, "nolock");
  mkdirSync(noLock);
  writeFileSync(join(noLock, "pyproject.toml"), pyproject);
  let frozenFailed = false;
  try {
    await syncWorktreeEnv(noLock);
  } catch {
    frozenFailed = true;
  }
  if (!frozenFailed) throw new Error("uv sync --frozen without lockfile should throw");

  const wt = join(dir, "worktree");
  mkdirSync(wt);
  writeFileSync(join(wt, "pyproject.toml"), pyproject);
  execFileSync("uv", ["lock"], { cwd: wt, encoding: "utf8" });
  await syncWorktreeEnv(wt);
  const wtBin = join(wt, ".venv", "bin");
  if (!existsSync(wtBin)) {
    throw new Error("uv sync --frozen did not create .venv");
  }
  const sessionPath = prependVenvBin("/usr/bin", wt);
  if (sessionPath !== `${wtBin}${delimiter}/usr/bin`) {
    throw new Error(`session PATH missing worktree venv: ${sessionPath}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
