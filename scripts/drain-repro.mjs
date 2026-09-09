#!/usr/bin/env node
/** Repro: drain two-ticket DAG with fake work (stamp MERGED, no Pi). */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../dist/run.js";
import { stamp } from "../dist/status.js";
import { scanTickets } from "../dist/tickets.js";

const root = mkdtempSync(join(tmpdir(), "drain-repro-"));
function git(...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}
git("init");
git("config", "user.name", "test");
git("config", "user.email", "test@example.com");
writeFileSync(join(root, "README.md"), "x\n");
git("add", "README.md");
git("commit", "-m", "init");

mkdirSync(join(root, ".scratch/feat/issues"), { recursive: true });
writeFileSync(
  join(root, ".scratch/feat/issues/01-one.md"),
  "# 01\n\nBlocked by: None\n\nStatus: READY\n",
);
writeFileSync(
  join(root, ".scratch/feat/issues/02-two.md"),
  "# 02\n\nBlocked by: 01\n\nStatus: BLOCKED\n",
);
git("add", ".scratch/feat/issues/01-one.md", ".scratch/feat/issues/02-two.md");
git("commit", "-m", "tickets");

const journal = {
  id: "repro",
  dir: root,
  log() {},
  snapshot() {},
  setPid() {},
  end() {},
};

async function work(target, ticket, _config, j) {
  await stamp(target, ticket, "MERGED", j);
}

await run(
  root,
  { model: undefined, thinkingLevel: "high", concurrency: 2, httpProxy: undefined },
  journal,
  work,
);

const tickets = scanTickets(root);
const statuses = Object.fromEntries(tickets.map((t) => [t.id, t.status]));
const ok = tickets.length === 2 && tickets.every((t) => t.status === "MERGED");
console.log(JSON.stringify({ ok, statuses }));
if (!ok) process.exit(1);
