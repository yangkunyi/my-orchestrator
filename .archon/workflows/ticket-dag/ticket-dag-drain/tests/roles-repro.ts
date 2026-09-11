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
import { personaFor, readTddSkill, REVIEW_AXES, reviewPersona, summaryPersona } from "../scripts/prompt.ts";
import { REVIEW_WALL_MS, ROLES, roleAgent } from "../scripts/roles.ts";
import { roleSessionFile } from "../scripts/session-log.ts";
import { expect, expectEqual } from "./target.ts";

// The table builds strings and opts; its only filesystem touch is the tdd tree an implement node runs under.
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
  expectEqual("implement session key is the Ticket", impl.sessionKey, "feat/01");
  // The table no longer answers where a session lives: only the runner that opened it knows, and it
  // reports the path on PackAgentResult.sessionFile - dsh's log is under DSH_HOME, not this formula.
  expect("the table does not answer where a session lives", !("sessionFile" in impl));
  expectEqual("implement role", impl.role, "implement");
  expectEqual("implement cwd", impl.cwd, CWD);
  expectEqual("implement model from config", impl.model, CONFIG.model);
  expectEqual("implement thinkingLevel from config", impl.thinkingLevel, CONFIG.thinkingLevel);
  expectEqual("implement runner from config", impl.runner, CONFIG.runner);
  expectEqual("implement prompt is the node's", impl.prompt, TASK);
  // The seam carries only what both runners honour: no option here is one an adapter would drop.
  expectEqual("the role table's opts are the seam's whole vocabulary", Object.keys(impl).sort(), [
    "artifactsDir",
    "cwd",
    "model",
    "persona",
    "prompt",
    "role",
    "runner",
    "sessionKey",
    "thinkingLevel",
    "wallMs",
  ]);
  expectEqual("implement wall clock is the ticket clock", impl.wallMs, AGENT_WALL_MS);
  expectEqual("implement persona is the skill", impl.persona, personaFor("implement", "pi", { skill: undefined }));

  const dshImplement = roleAgent({
    role: "implement",
    args: { ticketId: "feat/01" },
    cwd: CWD,
    artifactsDir: ARTIFACTS,
    config: { ...CONFIG, runner: "dsh" },
    prompt: TASK,
  });
  // The table reads the tree the machine carries, so on a machine that has one the persona must be
  // the tree's and not the inlined fallback. A table that quietly passed nothing would fall back here.
  const tree = readTddSkill();
  expect(
    "the table's dsh persona is the tree's, not the inlined fallback",
    tree === undefined || (dshImplement.persona ?? "").includes("The tdd skill, in full, from "),
  );
  expectEqual(
    "the runner reaches the persona",
    dshImplement.persona,
    personaFor("implement", "dsh", { skill: readTddSkill() }),
  );
  expect("dsh implement persona carries the tdd body", (dshImplement.persona ?? "").includes("Red before green."));

  const conflict = roleAgent({
    role: "conflict",
    args: { ticketId: "feat/02" },
    cwd: CWD,
    artifactsDir: ARTIFACTS,
    config: CONFIG,
    prompt: TASK,
  });
  expectEqual("conflict session key is the Ticket", conflict.sessionKey, "feat/02");
  expectEqual("conflict persona is the skill", conflict.persona, personaFor("conflict", "pi"));
  expectEqual("conflict wall clock is the ticket clock", conflict.wallMs, AGENT_WALL_MS);

  // A review axis is not a Ticket: its session is keyed by the axis, and its persona by the range.
  const review = roleAgent({
    role: "review",
    args: { axisIndex: 1, base: "abc", axis: REVIEW_AXES[1] },
    cwd: CWD,
    artifactsDir: ARTIFACTS,
    config: CONFIG,
    prompt: TASK,
  });
  expectEqual("a review axis keys its own session", review.sessionKey, "drain-review-2");
  // The read-only intent is not an option the table hands down: it is part of the persona every
  // runner gets, and Pi backs it with its own allowlist (agent-repro.ts asserts that mapping).
  expect("review states its read-only contract", review.persona.includes("read-only"));
  expect("review wall clock", review.wallMs, REVIEW_WALL_MS);
  expectEqual("review persona is built from the range", review.persona, reviewPersona("abc", REVIEW_AXES[1]));

  const summary = roleAgent({
    role: "summary",
    args: { base: "abc" },
    cwd: CWD,
    artifactsDir: ARTIFACTS,
    config: CONFIG,
    prompt: TASK,
  });
  expectEqual("summary session key is the node's own name", summary.sessionKey, "drain-summary");
  expectEqual("summary wall clock", summary.wallMs, REVIEW_WALL_MS);
  expectEqual("summary persona merges the reviews", summary.persona, summaryPersona("abc"));

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
