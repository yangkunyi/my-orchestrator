#!/usr/bin/env node
/** Repro: leftover in-flight whose branch is not an ancestor of Main recovers as FAILED; Worktree kept. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktree } from "../dist/git.js";
import { recoverLeftovers } from "../dist/contract.js";
import { stamp } from "../dist/status.js";
import { scanTickets } from "../dist/tickets.js";

const root = mkdtempSync(join(tmpdir(), "leftover-failed-"));
function git(...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}
git("init");
git("config", "user.name", "test");
git("config", "user.email", "test@example.com");
writeFileSync(join(root, "README.md"), "x\n");
git("add", "README.md");
git("commit", "-m", "init");

const rel = ".scratch/feat/issues/01-demo.md";
mkdirSync(join(root, ".scratch/feat/issues"), { recursive: true });
writeFileSync(join(root, rel), "# 01\n\n**Blocked by:** None\n\nStatus: READY\n");
git("add", rel);
git("commit", "-m", "ticket");

const journal = {
  id: "repro",
  dir: root,
  log() {},
  snapshot() {},
  setPid() {},
  end() {},
};

const ticket = scanTickets(root)[0];
if (!ticket) throw new Error("expected ticket");
await stamp(root, ticket, "RUNNING", journal);
const wt = await createWorktree(root, ticket);
writeFileSync(join(wt, "work.txt"), "agent\n");
execFileSync("git", ["-C", wt, "add", "work.txt"], { encoding: "utf8" });
execFileSync("git", ["-C", wt, "commit", "-m", "agent work"], { encoding: "utf8" });

await recoverLeftovers(root, journal);

const body = readFileSync(join(root, rel), "utf8");
const status = body.match(/^(?:\*\*)?Status\s*:(?:\*\*)?\s*(\S+)/im)?.[1] ?? "";
const worktreeKept = existsSync(wt);
let branchKept = false;
try {
  git("rev-parse", "--verify", ticket.branch);
  branchKept = true;
} catch {
  branchKept = false;
}
const ok = status === "FAILED" && worktreeKept && branchKept;
console.log(JSON.stringify({ ok, status, worktreeKept, branchKept }));
if (!ok) process.exit(1);
