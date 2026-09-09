#!/usr/bin/env node
/** Drive shipped inspectText: role files only, DAG + pino event format. */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectText } from "../dist/inspect.js";

const target = mkdtempSync(join(tmpdir(), "inspect-repro-"));
const id = "20260101T000000Z-abcd";
const dir = join(target, ".scratch", "orchestrator", "runs", id);
const sessions = join(dir, "sessions", "feat", "01");
mkdirSync(join(sessions, "implement", "uuid", "run-0"), { recursive: true });
writeFileSync(
  join(dir, "meta.json"),
  `${JSON.stringify({
    id,
    target,
    startedAt: "2026-01-01T00:00:00.000Z",
    pid: 1,
    status: "exited",
    endedAt: "2026-01-01T00:01:00.000Z",
    exitCode: 0,
  }, null, 2)}\n`,
);
writeFileSync(
  join(dir, "dag.json"),
  `${JSON.stringify({
    updatedAt: "2026-01-01T00:00:30.000Z",
    nodes: [{ id: "feat/01", status: "ready-for-agent", blockedBy: [] }],
  }, null, 2)}\n`,
);
writeFileSync(
  join(dir, "events.log"),
  `${JSON.stringify({ level: 30, time: "2026-01-01T00:00:00.000Z", msg: "run start" })}\n`,
);
writeFileSync(join(sessions, "implement.jsonl"), "{}\n");
writeFileSync(join(sessions, "implement", "uuid", "run-0", "session.jsonl"), "{}\n");

const text = inspectText(target, id);
const ok =
  text.includes("DAG (snapshot 2026-01-01T00:00:30.000Z)") &&
  text.includes("  feat/01  ready-for-agent") &&
  text.includes("  feat/01/implement.jsonl") &&
  !text.includes("session.jsonl") &&
  text.includes("2026-01-01T00:00:00.000Z run start");
console.log(JSON.stringify({ ok, text }));
if (!ok) process.exit(1);
