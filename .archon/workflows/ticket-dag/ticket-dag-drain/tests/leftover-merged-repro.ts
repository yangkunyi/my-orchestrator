#!/usr/bin/env bun
/** Leftover with --no-ff merge commit → MERGED, Worktree gone. Temp Target. No Pi, no Archon engine, no repo src/. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rematchLeftovers } from "../scripts/rematch.ts";

const root = mkdtempSync(join(tmpdir(), "pack-leftover-merged-"));
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
  writeFileSync(join(wt, "work.txt"), "agent\n");
  execFileSync("git", ["-C", wt, "add", "work.txt"], { encoding: "utf8" });
  execFileSync("git", ["-C", wt, "commit", "-m", "agent work"], { encoding: "utf8" });

  writeFileSync(join(root, rel), "# 01\n\n**Blocked by:** None\n\nStatus: MERGING\n");
  git("add", rel);
  git("commit", "-m", "orchestrator: feat/01 Status MERGING");
  git("merge", "--no-ff", "-m", `orchestrator: merge ${branch}`, branch);
  const branchSha = git("rev-parse", branch);

  await rematchLeftovers(root);

  const body = readFileSync(join(root, rel), "utf8");
  const status = body.match(/^(?:\*\*)?Status\s*:(?:\*\*)?\s*(\S+)/im)?.[1] ?? "";
  const worktreeGone = !existsSync(wt);
  let branchGone = true;
  try {
    execFileSync("git", ["-C", root, "rev-parse", "--verify", branch], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    branchGone = false;
  } catch {
    branchGone = true;
  }
  const mergeMsg = git("log", "-1", "--format=%s", "HEAD~1");
  const mergeParents = git("rev-list", "--parents", "-n", "1", "HEAD~1").split(" ");
  const ok =
    status === "MERGED" &&
    worktreeGone &&
    mergeMsg === `orchestrator: merge ${branch}` &&
    mergeParents.length === 3 &&
    mergeParents[2] === branchSha;
  console.log(
    JSON.stringify({
      ok,
      status,
      worktreeGone,
      branchGone,
      mergeMsg,
      secondParent: mergeParents[2] === branchSha,
    }),
  );
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
} finally {
  try {
    execFileSync("git", ["-C", root, "worktree", "remove", "--force", wtRel], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    /* gone */
  }
  rmSync(root, { recursive: true, force: true });
}
