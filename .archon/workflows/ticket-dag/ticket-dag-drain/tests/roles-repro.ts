#!/usr/bin/env bun
/**
 * Temp-Target repro: the role table. One entry per role owns the session key, the persona and the wall
 * clock - and the node id, script filename and session filename spell the same four role names.
 *
 * The table is data: it touches no filesystem and reads no environment. The one machine fact a persona
 * rests on (the tdd tree) is an argument of the call, so this file hands in its own and asserts on it.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { AGENT_WALL_MS, type AgentRole } from "../scripts/agent.ts";
import type { PackConfig } from "../scripts/config.ts";
import {
  conflictPersona,
  implementPersona,
  REVIEW_AXES,
  reviewPersona,
  summaryPersona,
  type TddSkill,
} from "../scripts/prompt.ts";
import { REVIEW_WALL_MS, ROLES, roleAgent } from "../scripts/roles.ts";
import { roleSessionFile } from "../scripts/pi-session.ts";
import { expect, expectEqual, mkTemp } from "./target.ts";

const ARTIFACTS = "/artifacts";
const CWD = "/worktree";
const CONFIG: PackConfig = { model: "highland/deepseek-v4-flash", thinkingLevel: "high", concurrency: 4, runner: "pi" };
const TASK = "TASK";
// A tree no machine has, so a table that read the machine's own would name a different path here.
const FAKE_RULE = "Fake rule one.";
const FAKE_SKILL: TddSkill = {
  dir: "/fake/tdd-tree",
  body: `# Fake TDD\n\n${FAKE_RULE}\n\nSee the codebase-design skill for interface work.\n`,
};

try {
  expectEqual(
    "one entry per role, the whole vocabulary",
    Object.keys(ROLES).sort(),
    ["conflict", "implement", "review", "summary"],
  );

  const impl = roleAgent({
    role: "implement",
    args: { ticketId: "feat/01", skill: FAKE_SKILL },
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
    "env",
    "model",
    "persona",
    "prompt",
    "role",
    "runner",
    "sessionKey",
    "thinkingLevel",
    "wallMs",
  ]);
  // The environment that goes with the cwd travels on the seam, built from the cwd of the call.
  const worktree = mkTemp("pack-roles-wt-");
  try {
    mkdirSync(join(worktree, ".venv", "bin"), { recursive: true });
    const inWorktree = roleAgent({
      role: "implement",
      args: { ticketId: "feat/01", skill: FAKE_SKILL },
      cwd: worktree,
      artifactsDir: ARTIFACTS,
      config: CONFIG,
      prompt: TASK,
    });
    const base: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    expectEqual(
      "the table's env leads with that cwd's .venv",
      inWorktree.env(base).PATH,
      `${join(worktree, ".venv", "bin")}:/usr/bin`,
    );
    expectEqual("a cwd without a .venv is passed through", impl.env(base), base);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
  expectEqual("implement wall clock is the ticket clock", impl.wallMs, AGENT_WALL_MS);
  // The call's own arguments are what the persona is built from - nothing ambient.
  expectEqual("implement persona is the skill", impl.persona, implementPersona("pi", FAKE_SKILL));
  expect("pi's session advertises the tdd skill, so the call's skill is unused there", !impl.persona.includes(FAKE_RULE));

  const dshImplement = roleAgent({
    role: "implement",
    args: { ticketId: "feat/01", skill: FAKE_SKILL },
    cwd: CWD,
    artifactsDir: ARTIFACTS,
    config: { ...CONFIG, runner: "dsh" },
    prompt: TASK,
  });
  // A table that read the machine's tree instead of using the argument would name that tree here; this
  // path exists on no machine, so only the value the call carried can produce it.
  expect(
    "the table's dsh persona comes from the skill the call carries",
    (dshImplement.persona ?? "").includes(`from ${FAKE_SKILL.dir}`),
  );
  expect("and carries that skill's body", (dshImplement.persona ?? "").includes(FAKE_RULE));
  expect(
    "the out-of-scope paragraph is dropped on this path too",
    !(dshImplement.persona ?? "").includes("codebase-design"),
  );
  expectEqual(
    "the runner reaches the persona",
    dshImplement.persona,
    implementPersona("dsh", FAKE_SKILL),
  );

  // No skill at all is the inlined fallback, and it is a different persona from a supplied tree.
  const fallbackImplement = roleAgent({
    role: "implement",
    args: { ticketId: "feat/03", skill: undefined },
    cwd: CWD,
    artifactsDir: ARTIFACTS,
    config: { ...CONFIG, runner: "dsh" },
    prompt: TASK,
  });
  expect("a call with no skill falls back to the inlined body", (fallbackImplement.persona ?? "").includes("Red before green."));
  expect("and is not the tree's persona", fallbackImplement.persona !== dshImplement.persona);

  const conflict = roleAgent({
    role: "conflict",
    args: { ticketId: "feat/02" },
    cwd: CWD,
    artifactsDir: ARTIFACTS,
    config: CONFIG,
    prompt: TASK,
  });
  expectEqual("conflict session key is the Ticket", conflict.sessionKey, "feat/02");
  expectEqual("conflict persona is the skill", conflict.persona, conflictPersona());
  expectEqual("conflict wall clock is the ticket clock", conflict.wallMs, AGENT_WALL_MS);
  // The resolve procedure is one text, so no runner and no argument changes it.
  const dshConflict = roleAgent({
    role: "conflict",
    args: { ticketId: "feat/02" },
    cwd: CWD,
    artifactsDir: ARTIFACTS,
    config: { ...CONFIG, runner: "dsh" },
    prompt: TASK,
  });
  expectEqual("the runner does not change the conflict persona", dshConflict.persona, conflict.persona);

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

  // The role vocabulary against its other two spellings: the YAML node id and the script file, both in
  // the folder whose YAML declares the node.
  const drainDir = join(import.meta.dir, "..");
  const executeDir = join(import.meta.dir, "../../ticket-dag-execute");
  const drainYaml = readFileSync(join(drainDir, "ticket-dag-drain.yaml"), "utf8");
  const executeYaml = readFileSync(join(executeDir, "ticket-dag-execute.yaml"), "utf8");
  const nodeOf: Record<AgentRole, { yaml: string; dir: string }> = {
    implement: { yaml: executeYaml, dir: executeDir },
    conflict: { yaml: executeYaml, dir: executeDir },
    review: { yaml: drainYaml, dir: drainDir },
    summary: { yaml: drainYaml, dir: drainDir },
  };
  for (const role of Object.keys(ROLES) as AgentRole[]) {
    const home = nodeOf[role];
    expect(`${role} is a node id and a script`, new RegExp(`id: ${role}[\\s\\S]*?script: ${role}`).test(home.yaml));
    expect(
      `${role} has a script file in the folder that declares it`,
      existsSync(join(home.dir, "scripts", `${role}.ts`)),
    );
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
