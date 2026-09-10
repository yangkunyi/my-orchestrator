#!/usr/bin/env bun
/**
 * Temp-Target repro: the role table. One entry per role owns the session key, the persona, the tool
 * allowlist, the bash need and the wall clock - and the node id, script filename and session filename
 * spell the same four role names.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_WALL_MS, type AgentRole } from "../scripts/agent.ts";
import type { PackConfig } from "../scripts/config.ts";
import { personaFor, REVIEW_AXES, reviewPersona, summaryPersona } from "../scripts/prompt.ts";
import { REVIEW_TOOLS, REVIEW_WALL_MS, ROLES, roleAgent } from "../scripts/roles.ts";
import { roleSessionFile } from "../scripts/session-log.ts";
import { expect, expectEqual } from "./target.ts";

// The table builds strings and opts; no cwd or artifacts dir is ever touched.
const ARTIFACTS = "/artifacts";
const CWD = "/worktree";
const CONFIG: PackConfig = { model: "highland/deepseek-v4-flash", thinkingLevel: "high", concurrency: 4, runner: "pi" };
const TASK = "TASK";

try {
  expectEqual(
    "one entry per role, the whole vocabulary",
    Object.keys(ROLES).sort(),
    ["conflict", "implement", "review", "summary"],
  );

  const impl = roleAgent({
    role: "implement",
    args: { ticketId: "feat/01" },
    cwd: CWD,
    artifactsDir: ARTIFACTS,
    config: CONFIG,
    prompt: TASK,
  });
  expectEqual("implement session key is the Ticket", impl.opts.sessionKey, "feat/01");
  expectEqual("implement session file", impl.sessionFile, join(ARTIFACTS, "sessions", "feat/01", "implement.jsonl"));
  expectEqual("implement role", impl.opts.role, "implement");
  expectEqual("implement cwd", impl.opts.cwd, CWD);
  expectEqual("implement model from config", impl.opts.model, CONFIG.model);
  expectEqual("implement thinkingLevel from config", impl.opts.thinkingLevel, CONFIG.thinkingLevel);
  expectEqual("implement runner from config", impl.opts.runner, CONFIG.runner);
  expectEqual("implement prompt is the node's", impl.opts.prompt, TASK);
  expectEqual("implement takes the runner's default tools", impl.opts.tools, undefined);
  expectEqual("implement takes the runner's default bash", impl.opts.useBash, undefined);
  expectEqual("implement wall clock is the ticket clock", impl.opts.wallMs, AGENT_WALL_MS);
  expectEqual("implement persona is the skill", impl.opts.persona, personaFor("implement", "pi"));

  const dshImplement = roleAgent({
    role: "implement",
    args: { ticketId: "feat/01" },
    cwd: CWD,
    artifactsDir: ARTIFACTS,
    config: { ...CONFIG, runner: "dsh" },
    prompt: TASK,
  });
  expectEqual("the runner reaches the persona", dshImplement.opts.persona, personaFor("implement", "dsh"));
  expect("dsh implement persona carries the tdd body", (dshImplement.opts.persona ?? "").includes("Red before green."));

  const conflict = roleAgent({
    role: "conflict",
    args: { ticketId: "feat/02" },
    cwd: CWD,
    artifactsDir: ARTIFACTS,
    config: CONFIG,
    prompt: TASK,
  });
  expectEqual("conflict session key is the Ticket", conflict.opts.sessionKey, "feat/02");
  expectEqual("conflict session file", conflict.sessionFile, join(ARTIFACTS, "sessions", "feat/02", "conflict.jsonl"));
  expectEqual("conflict persona is the skill", conflict.opts.persona, personaFor("conflict", "pi"));
  expectEqual("conflict takes the runner's default tools", conflict.opts.tools, undefined);
  expectEqual("conflict takes the runner's default bash", conflict.opts.useBash, undefined);
  expectEqual("conflict wall clock is the ticket clock", conflict.opts.wallMs, AGENT_WALL_MS);

  // A review axis is not a Ticket: its session is keyed by the axis, and its persona by the range.
  const review = roleAgent({
    role: "review",
    args: { axisIndex: 1, base: "abc", axis: REVIEW_AXES[1] },
    cwd: CWD,
    artifactsDir: ARTIFACTS,
    config: CONFIG,
    prompt: TASK,
  });
  expectEqual("a review axis keys its own session", review.opts.sessionKey, "drain-review-2");
  expectEqual("review session file", review.sessionFile, join(ARTIFACTS, "sessions", "drain-review-2", "review.jsonl"));
  expectEqual("review tools", review.opts.tools, REVIEW_TOOLS);
  expectEqual("review needs bash to read git", review.opts.useBash, true);
  expectEqual("review wall clock", review.opts.wallMs, REVIEW_WALL_MS);
  expectEqual("review persona is built from the range", review.opts.persona, reviewPersona("abc", REVIEW_AXES[1]));

  const summary = roleAgent({
    role: "summary",
    args: { base: "abc" },
    cwd: CWD,
    artifactsDir: ARTIFACTS,
    config: CONFIG,
    prompt: TASK,
  });
  expectEqual("summary session key is the node's own name", summary.opts.sessionKey, "drain-summary");
  expectEqual("summary session file", summary.sessionFile, join(ARTIFACTS, "sessions", "drain-summary", "summary.jsonl"));
  expectEqual("summary shares the reviewers' tools", summary.opts.tools, REVIEW_TOOLS);
  expectEqual("summary may read git through bash", summary.opts.useBash, true);
  expectEqual("summary wall clock", summary.opts.wallMs, REVIEW_WALL_MS);
  expectEqual("summary persona merges the reviews", summary.opts.persona, summaryPersona("abc"));

  // Every role goes through the same persona dispatch, so no caller re-spells a role's contract.
  expectEqual(
    "the review persona has one spelling",
    personaFor("review", "pi", { base: "abc", axis: REVIEW_AXES[2] }),
    reviewPersona("abc", REVIEW_AXES[2]),
  );
  expectEqual("the summary persona has one spelling", personaFor("summary", "pi", { base: "abc" }), summaryPersona("abc"));

  // The role vocabulary against its other two spellings: the YAML node id and the script file.
  const drainYaml = readFileSync(join(import.meta.dir, "../ticket-dag-drain.yaml"), "utf8");
  const executeYaml = readFileSync(join(import.meta.dir, "../../ticket-dag-execute/ticket-dag-execute.yaml"), "utf8");
  const nodeOf: Record<AgentRole, string> = { implement: executeYaml, conflict: executeYaml, review: drainYaml, summary: drainYaml };
  for (const role of Object.keys(ROLES) as AgentRole[]) {
    expect(`${role} is a node id and a script`, new RegExp(`id: ${role}[\\s\\S]*?script: ${role}`).test(nodeOf[role]));
    expect(`${role} has a script file`, existsSync(join(import.meta.dir, `../scripts/${role}.ts`)));
    expectEqual(
      `${role}'s session file is its key plus its role`,
      roleSessionFile(ARTIFACTS, "key", role),
      join(ARTIFACTS, "sessions", "key", `${role}.jsonl`),
    );
  }

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
}
