#!/usr/bin/env node
/** Repro: content conflict on Main must be tryMerge "conflict" and abort; not "empty" with MERGE_HEAD left. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tryMerge } from "../dist/git.js";

const root = mkdtempSync(join(tmpdir(), "merge-conflict-"));
function git(...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}
git("init");
git("config", "user.name", "test");
git("config", "user.email", "test@example.com");
writeFileSync(join(root, "f"), "a\n");
git("add", "f");
git("commit", "-m", "init");
git("checkout", "-b", "ticket/feat/01-demo");
writeFileSync(join(root, "f"), "b\n");
git("add", "f");
git("commit", "-m", "ticket");
git("checkout", "-");
writeFileSync(join(root, "f"), "c\n");
git("add", "f");
git("commit", "-m", "mainline");

const result = await tryMerge(root, "ticket/feat/01-demo");
let mergeHead = false;
try {
  git("rev-parse", "-q", "--verify", "MERGE_HEAD");
  mergeHead = true;
} catch {
  mergeHead = false;
}
const porcelain = git("status", "--porcelain");
const ok = result === "conflict" && !mergeHead && porcelain === "";
console.log(JSON.stringify({ result, mergeHead, porcelain, ok }));
if (!ok) process.exit(1);
