#!/usr/bin/env node
/** Drive shipped openTicketSession: a temp Run dir gets a non-empty session file. */
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { openTicketSession, ticketSessionFile } from "../dist/agent.js";

const runDir = process.argv[2];
if (!runDir) {
  console.error("usage: node scripts/session-persist.mjs <runDir>");
  process.exit(2);
}
mkdirSync(runDir, { recursive: true });
const cwd = runDir;
const sm = openTicketSession(cwd, runDir, "feat/01", "implement");
const file = sm.getSessionFile() ?? ticketSessionFile(runDir, "feat/01", "implement");
const size = statSync(file).size;
const ok = size > 0;
console.log(JSON.stringify({ runDir, file, size, persisted: sm.isPersisted(), ok }));
if (!ok) process.exit(1);
