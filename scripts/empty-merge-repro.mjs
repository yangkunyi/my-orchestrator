#!/usr/bin/env node
/** Repro: RUNNING stamp is on the ticket branch; empty agent work must not count as ahead of Main. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginTicket, settleAfterAgent } from "../dist/contract.js";
import { hasCommitsAhead, revParse } from "../dist/git.js";

const root = mkdtempSync(join(tmpdir(), "empty-merge-"));
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

const ticket = {
  id: "feat/01",
  feature: "feat",
  nn: "01",
  slug: "demo",
  relPath: rel,
  absPath: join(root, rel),
  status: "READY",
  blockedBy: [],
  branch: "ticket/feat/01-demo",
  worktreeRel: "worktrees/feat-01-demo",
};
const journal = { id: "t", dir: root, log() {}, snapshot() {}, setPid() {}, end() {} };

const shaBeforeBegin = await revParse(root);
const wt = await beginTicket(root, ticket, journal);
const vsOld = await hasCommitsAhead(wt, shaBeforeBegin);
const vsMain = await hasCommitsAhead(wt, await revParse(root));
const result = await settleAfterAgent(root, ticket, wt, journal);

const status = (readFileSync(join(root, rel), "utf8").match(/^Status:\s*(\S+)/m) ?? [])[1] ?? "";
const mergeOnMain = git("log", "--pretty=%s").split("\n").some((l) => l.includes("orchestrator: merge"));
const ok = result === "failed" && status === "FAILED" && vsOld === true && vsMain === false;
console.log(JSON.stringify({ result, status, vsOld, vsMain, ok }));
if (!ok || mergeOnMain) process.exit(1);
