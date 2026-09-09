#!/usr/bin/env node
/** Drive shipped lastAssistantError + listRoleSessions (role files only). */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lastAssistantError, listRoleSessions } from "../dist/agent.js";

const runDir = mkdtempSync(join(tmpdir(), "session-error-"));
const sessions = join(runDir, "sessions", "feat", "01");
mkdirSync(join(sessions, "implement", "uuid", "run-0"), { recursive: true });
const roleFile = join(sessions, "implement.jsonl");
writeFileSync(
  roleFile,
  `${JSON.stringify({ type: "message", message: { role: "assistant", errorMessage: "Request timed out." } })}\n`,
);
writeFileSync(join(sessions, "implement", "uuid", "run-0", "session.jsonl"), "{}\n");
writeFileSync(join(sessions, "scout_transcript.jsonl"), "{}\n");

const lastError = lastAssistantError(roleFile);
const listed = listRoleSessions(runDir);
const ok = lastError === "Request timed out." && JSON.stringify(listed) === JSON.stringify(["feat/01/implement.jsonl"]);
console.log(JSON.stringify({ lastError, listed, ok }));
if (!ok) process.exit(1);
