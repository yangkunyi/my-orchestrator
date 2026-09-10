#!/usr/bin/env bun
/** Leftover with only ancestry (RUNNING stamp on Main, no merge commit) → FAILED, Worktree kept. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rematchLeftovers } from "../scripts/rematch.ts";

const root = mkdtempSync(join(tmpdir(), "pack-leftover-ancestry-"));
function git(...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

const rel = ".scratch/feat/issues/01-demo.md";
const branch = "ticket/feat/01-demo";
const wtRel = "worktrees/feat-01-demo";
const wt = join(root, wtRel);

try {
  git("init", "-b", "main");
  git("config", "user.name", "test");
  git("config", "user.email", "test@example.com");
  writeFileSync(join(root, "README.md"), "x\n");
  git("add", "README.md");
  git("commit", "-m", "init");

  mkdirSync(join(root, ".scratch/feat/issues"), { recursive: true });
  writeFileSync(join(root, rel), "# 01\n\n**Blocked by:** None\n\nStatus: READY\n");
  git("add", rel);
  git("commit", "-m", "ticket");

  writeFileSync(join(root, rel), "# 01\n\n**Blocked by:** None\n\nStatus: RUNNING\n");
  git("add", rel);
  git("commit", "-m", "orchestrator: feat/01 Status RUNNING");

  mkdirSync(join(root, "worktrees"), { recursive: true });
  git("worktree", "add", "-b", branch, wtRel, "HEAD");

  const ancestor = execFileSync(
    "git",
    ["-C", root, "merge-base", "--is-ancestor", branch, "HEAD"],
    { encoding: "utf8" },
  );
  void ancestor;

  await rematchLeftovers(root);

  const body = readFileSync(join(root, rel), "utf8");
  const status = body.match(/^(?:\*\*)?Status\s*:(?:\*\*)?\s*(\S+)/im)?.[1] ?? "";
  const worktreeKept = existsSync(wt);
  let branchKept = false;
  try {
    git("rev-parse", "--verify", branch);
    branchKept = true;
  } catch {
    branchKept = false;
  }
  const ok = status === "FAILED" && worktreeKept && branchKept;
  console.log(JSON.stringify({ ok, status, worktreeKept, branchKept }));
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
} finally {
  try {
    execFileSync("git", ["-C", root, "worktree", "remove", "--force", wtRel], { encoding: "utf8" });
  } catch {
    /* gone */
  }
  rmSync(root, { recursive: true, force: true });
}
