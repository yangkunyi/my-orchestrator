#!/usr/bin/env bun
/** Temp-Target repro: pack Pi SDK wiring without a live session. No Archon engine, no repo src/. */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_WALL_MS, armSessionAbort, defaultAgent, noopAgent, packAnswer, RunnerUnavailable } from "../scripts/agent.ts";
import { composeMessage, conflictPersona, conflictTask, implementPersona, implementTask, REVIEW_AXES, reviewPersona, reviewTask } from "../scripts/prompt.ts";
import { PI_READ_ONLY_TOOLS, piSpawnHook, piTools, piTurn } from "../scripts/pi-session.ts";
import { proxyEnv } from "../scripts/proxy.ts";
import { readPiSession, roleSessionFile } from "../scripts/session-log.ts";
import { REVIEW_WALL_MS } from "../scripts/roles.ts";
import { sessionEnv, sessionSpawnEnv } from "../scripts/worktree-env.ts";
import { expect, expectEqual, mkTemp, sleep } from "./target.ts";

const executeYaml = join(import.meta.dir, "../../ticket-dag-execute/ticket-dag-execute.yaml");
const drainYaml = join(import.meta.dir, "../ticket-dag-drain.yaml");

try {
  const impl = composeMessage(implementPersona("pi", undefined), implementTask(".scratch/feat/issues/01-demo.md"));
  expect("implement inlines skill body", impl.includes("Use /tdd where possible, at pre-agreed seams."));
  expect("implement has ticket path", impl.includes(".scratch/feat/issues/01-demo.md"));
  expect("implement leaves Status unchanged", impl.includes("Leave the ticket file's `Status:` line unchanged"));
  expect("implement has no /skill: name", !impl.includes("/skill:"));
  expect("implement does not spawn pi CLI", !impl.includes("pi -p"));
  expect("implement drops /code-review", !impl.includes("/code-review"));
  expect("implement has no two-axis fanout", !impl.includes("diff-reviewer") && !impl.includes("## Standards"));

  const conf = composeMessage(conflictPersona(), conflictTask(".scratch/feat/issues/01-demo.md"));
  expect("conflict inlines skill body", conf.includes("Always resolve; never `--abort`."));
  expect("conflict has ticket path", conf.includes(".scratch/feat/issues/01-demo.md"));
  expect("conflict leaves Status unchanged", conf.includes("Leave the ticket file's `Status:` line unchanged"));
  expect("conflict has no /skill: name", !conf.includes("/skill:"));
  expect("conflict has no two-axis review", !conf.includes("## Standards") && !conf.includes("diff-reviewer"));

  const artifacts = mkTemp("pack-agent-art-");
  try {
    expectEqual(
      "implement session path",
      roleSessionFile(artifacts, "feat/01", "implement"),
      join(artifacts, "sessions", "feat/01", "implement.jsonl"),
    );
    expectEqual(
      "conflict session path",
      roleSessionFile(artifacts, "feat/01", "conflict"),
      join(artifacts, "sessions", "feat/01", "conflict.jsonl"),
    );
    expectEqual(
      "review session path",
      roleSessionFile(artifacts, "drain-review-1", "review"),
      join(artifacts, "sessions", "drain-review-1", "review.jsonl"),
    );
    expect(
      "sessions are under artifacts not Run records",
      !roleSessionFile(artifacts, "feat/01", "implement").includes("orchestrator/runs"),
    );

    const sessionFile = roleSessionFile(artifacts, "feat/01", "implement");
    mkdirSync(join(artifacts, "sessions", "feat", "01"), { recursive: true });
    const errorFile = join(artifacts, "sessions", "feat", "01", "error.jsonl");
    writeFileSync(
      errorFile,
      `${JSON.stringify({ type: "message", message: { role: "assistant", errorMessage: "Request timed out." } })}\n`,
    );
    expectEqual("the reader takes the last errorMessage", readPiSession(errorFile).error, "Request timed out.");
    expectEqual("a session with no text answers none", packAnswer(readPiSession(errorFile).text), {
      kind: "none",
    });
    // The answer channel's rule: a part is text only when its own type says so, and blank is no answer.
    const thinkingFile = join(artifacts, "sessions", "feat", "01", "thinking.jsonl");
    writeFileSync(
      thinkingFile,
      `${JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", text: "THINKING-LEAK" },
            { type: "text", text: "the answer" },
          ],
        },
      })}\n`,
    );
    expectEqual("a thinking part is not the answer", readPiSession(thinkingFile).text, "the answer");
    const thinkingOnly = join(artifacts, "sessions", "feat", "01", "thinking-only.jsonl");
    writeFileSync(
      thinkingOnly,
      `${JSON.stringify({
        type: "message",
        message: { role: "assistant", content: [{ type: "thinking", text: "THINKING-LEAK" }] },
      })}\n`,
    );
    expectEqual("a turn that only thought answers no text", readPiSession(thinkingOnly).text, undefined);
    expectEqual("blank text is no answer", packAnswer(""), { kind: "none" });
    expectEqual("whitespace is no answer", packAnswer("  \n"), { kind: "none" });
    expectEqual("a real answer keeps its bytes", packAnswer(" x \n"), { kind: "text", text: " x \n" });
    expectEqual("a missing session reads as absence, not a throw", readPiSession(join(artifacts, "missing.jsonl")), {
      text: undefined,
      error: undefined,
    });

    const textFile = join(artifacts, "sessions", "feat", "01", "text.jsonl");
    writeFileSync(
      textFile,
      `${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "looks ok" }] } })}\n`,
    );
    expectEqual("the reader takes the last assistant text", readPiSession(textFile).text, "looks ok");
    // Pi's adapter reads its own session for the answer: this is that report, whole.
    expectEqual("Pi's turn report answers with its session's text", piTurn(textFile, undefined), {
      sessionFile: textFile,
      answer: { kind: "text", text: "looks ok" },
      lastError: undefined,
    });
    expectEqual("a turn with no text and an error reports both", piTurn(errorFile, undefined), {
      sessionFile: errorFile,
      answer: { kind: "none" },
      lastError: "Request timed out.",
    });
    expectEqual(
      "a silent session still reports why the turn ended",
      piTurn(join(artifacts, "missing.jsonl"), "agent aborted after wall clock"),
      {
        sessionFile: join(artifacts, "missing.jsonl"),
        answer: { kind: "none" },
        lastError: "agent aborted after wall clock",
      },
    );
    const strFile = join(artifacts, "sessions", "feat", "01", "str.jsonl");
    writeFileSync(
      strFile,
      `${JSON.stringify({ type: "message", message: { role: "assistant", content: "plain" } })}\n`,
    );
    expectEqual("the reader takes string content", readPiSession(strFile).text, "plain");

    const noop = await noopAgent({
      cwd: artifacts,
      env: (base) => base,
      artifactsDir: artifacts,
      sessionKey: "feat/01",
      role: "implement",
      model: undefined,
      thinkingLevel: "high",
      persona: "PERSONA",
      prompt: impl,
    });
    expectEqual("noop does not start Pi", noop.sessionFile, sessionFile);
    expectEqual("noop answers no text", noop.answer, { kind: "none" });
    expectEqual("noop has no lastError", noop.lastError, undefined);
  } finally {
    rmSync(artifacts, { recursive: true, force: true });
  }

  // The seam's environment transform: the Worktree rule travels on the opts, so it is one value both
  // adapters apply - Pi to its spawn context, dsh to its child environment (behaviourally asserted in
  // dsh-agent-repro.ts). Here: the transform is the composition Pi used to do inline, byte for byte.
  const worktree = mkTemp("pack-seam-wt-");
  try {
    mkdirSync(join(worktree, ".venv", "bin"), { recursive: true });
    const base: NodeJS.ProcessEnv = { PATH: "/usr/bin", HOME: "/home/op" };
    const composed = sessionEnv(worktree, base);
    expectEqual(
      "the Worktree's .venv leads the composed PATH",
      composed.PATH,
      `${join(worktree, ".venv", "bin")}:/usr/bin`,
    );
    expectEqual("the rest of the spawn environment survives", composed.HOME, "/home/op");
    const noVenv = sessionEnv(join(worktree, "no-venv-here"), base);
    expect("a cwd with no .venv hands the base back as it was", noVenv === base && noVenv.PATH === base.PATH);

    // What Pi hands bash, without a session: piSpawnHook is the value the adapter passes to the SDK, so
    // the test drives that value. The SDK captures a spawnHook inside the tool definition, where nothing
    // can reach it, and Pi's execute needs a whole ExtensionContext. dsh's half is behavioural in
    // dsh-agent-repro.ts, through its stub's recorded child environment.
    const ctx = { command: "uv run pytest", cwd: worktree, env: base };
    const spawned = piSpawnHook((b) => sessionEnv(worktree, b))(ctx);
    expectEqual(
      "the spawn context keeps its command and cwd",
      [spawned.command, spawned.cwd],
      ["uv run pytest", worktree],
    );
    expectEqual(
      "and hands bash the Worktree's .venv first",
      spawned.env.PATH,
      `${join(worktree, ".venv", "bin")}:/usr/bin`,
    );
    const reader = sessionSpawnEnv((b) => sessionEnv("/target", b), {
      command: "git log",
      cwd: "/target",
      env: base,
    });
    expectEqual("a Main reader's spawn env is its own base", reader.env, base);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }

  expectEqual("2 hour wall clock", AGENT_WALL_MS, 2 * 60 * 60 * 1000);
  expect("wall clock shorter than Archon timeout", AGENT_WALL_MS < 7_500_000);
  expectEqual("review wall 30 min", REVIEW_WALL_MS, 30 * 60 * 1000);
  expect("review wall shorter than review node timeout", REVIEW_WALL_MS < 2_000_000);
  expectEqual("the read-only allowlist can read git", PI_READ_ONLY_TOOLS, ["read", "grep", "find", "ls", "bash"]);
  // Pi's own enforcement of the drain-end readers' read-only contract, and the ticket nodes' default:
  // the seam carries no tool option, because dsh could not honour one (see dsh-agent-repro.ts).
  expectEqual("Pi mounts the read-only allowlist for a reviewer", piTools("review"), PI_READ_ONLY_TOOLS);
  expectEqual("Pi mounts it for the summariser too", piTools("summary"), PI_READ_ONLY_TOOLS);
  expectEqual("an implement node takes Pi's default tools", piTools("implement"), undefined);
  expectEqual("a conflict node takes Pi's default tools", piTools("conflict"), undefined);

  // The seam's shape, which no runtime repro can reach: a caller must state the persona and cannot
  // pass an option one adapter would drop, and the answer channel is required rather than optional.
  const seamSrc = readFileSync(join(import.meta.dir, "../scripts/agent.ts"), "utf8");
  expect("the seam requires a persona", /^\s*persona: string;$/m.test(seamSrc));
  expect("the seam's answer channel is required", /^\s*answer: PackAnswer;$/m.test(seamSrc));
  expect("the seam declares no tool allowlist", !/^\s*(tools|useBash)\??:/m.test(seamSrc));

  const rp = composeMessage(
    reviewPersona("abc", REVIEW_AXES[0]),
    reviewTask("abc", "head1", "c1 do a thing\n"),
  );
  expect("review prompt pins range", rp.includes("abc...HEAD"));
  expect("review is handed HEAD", rp.includes("HEAD = head1"));
  expect("review forbids /code-review", rp.includes("Do not spawn agents or invoke /code-review"));
  expect("review forbids Spec axis", rp.includes("Do not produce a Standards-vs-Spec pair"));
  expect("review has no two-axis recipe", !rp.includes("## Standards") && !rp.includes("diff-reviewer"));
  expect("review is not ticket Spec", rp.includes("Do not check ticket acceptance criteria"));
  expect("review carries the commit menu", rp.includes("Commits in that range:\nc1 do a thing"));
  expect("review pastes no diff", !rp.includes("```diff") && !rp.includes("truncated"));
  expect(
    "review is one axis only",
    rp.includes(`Your axis: ${REVIEW_AXES[0]}`) && !rp.includes(REVIEW_AXES[1]),
  );

  // One contract either way: what the role may do is stated in the persona for both runners, and
  // only Pi can back it with a mounted allowlist.
  expect("review rules out writes", rp.includes("Never write:") && rp.includes("no commits"));
  expect("review names no Pi tool line", !rp.includes("Use read, grep, find, and ls only"));
  expect("review knows it may read git", rp.includes("git log") && rp.includes("git show"));
  expectEqual(
    "every axis gets its own contract",
    new Set(REVIEW_AXES.map((axis) => reviewPersona("abc", axis))).size,
    REVIEW_AXES.length,
  );
  // The dsh implement persona's tdd section is built from a skill the caller hands in, so the test
  // pins the composition without reading whatever skill tree this machine happens to have.
  const tddSkill = {
    dir: "/skills/tdd",
    body: "---\nname: tdd\ndescription: stub\n---\n\nRed before green.\n\nConsult the codebase-design skill for the vocabulary.\n",
  };
  expect("Pi implement persona is the skill alone", !implementPersona("pi", tddSkill).includes("Red before green."));
  expect(
    "dsh implement persona carries the tdd body",
    implementPersona("dsh", tddSkill).includes("Red before green."),
  );
  expect(
    "dsh implement persona drops the codebase-design pointer",
    !implementPersona("dsh", tddSkill).includes("codebase-design"),
  );
  expect(
    "dsh implement persona names the tree it came from",
    implementPersona("dsh", tddSkill).includes("/skills/tdd"),
  );
  expect(
    "an absent skill falls back to the inlined body",
    implementPersona("dsh", undefined).includes("Red before green."),
  );
  expect("both implement personas stay the same skill", implementPersona("pi", undefined).startsWith("Implement the work described by the user"));

  const yaml = readFileSync(executeYaml, "utf8");
  expect("implement node timeout 7500000", /id: implement[\s\S]*?timeout: 7500000/.test(yaml));
  expect("conflict node timeout 7500000", /id: conflict[\s\S]*?timeout: 7500000/.test(yaml));

  const drain = readFileSync(drainYaml, "utf8");
  expect("review node after drain", /id: review[\s\S]*?depends_on: \[drain\]/.test(drain));
  expect("review node timeout 2000000", /id: review[\s\S]*?timeout: 2000000/.test(drain));
  expect("review script is pack bun", /id: review[\s\S]*?script: review/.test(drain));

  const env = proxyEnv({ PATH: "/bin", HTTP_PROXY: "http://already.set" });
  expectEqual("NODE_USE_ENV_PROXY at process start", env.NODE_USE_ENV_PROXY, "1");
  expectEqual("does not copy httpProxy over existing HTTP_PROXY", env.HTTP_PROXY, "http://already.set");
  expect("proxyEnv does not invent httpProxy", !("httpProxy" in env));

  let aborted = 0;
  const cancel = armSessionAbort(
    {
      abort: async () => {
        aborted += 1;
      },
    },
    20,
  );
  await sleep(60);
  expectEqual("abort fires after wall clock", aborted, 1);
  cancel();

  let skipped = 0;
  const cancelEarly = armSessionAbort(
    {
      abort: async () => {
        skipped += 1;
      },
    },
    20,
  );
  cancelEarly();
  await sleep(60);
  expectEqual("cleared abort does not fire", skipped, 0);

  // The seam's other contract, at the adapter: a runner that never started THROWS instead of reporting
  // a turn, so a node can tell "no agent saw this" from "the agent's work failed". An unknown model is
  // knowable before any turn, and Pi resolves models locally - this costs no network and no session.
  try {
    await defaultAgent({
      cwd: ".",
      artifactsDir: mkTemp("pack-seam-art-"),
      env: (base) => base,
      sessionKey: "feat/01",
      role: "implement",
      model: "nope/nope",
      thinkingLevel: "high",
      persona: "PERSONA",
      prompt: "go",
    });
    expect("a model the SDK cannot resolve is not a turn result", false);
  } catch (e) {
    expect("it is the seam's fatal kind", e instanceof RunnerUnavailable, String(e));
    expect(
      "and the message names the runner before the reason",
      (e as Error).message.startsWith("the pi runner could not start: "),
      (e as Error).message,
    );
  }

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
}
