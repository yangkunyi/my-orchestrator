#!/usr/bin/env bun
/** Temp-Target repro: pack Pi SDK wiring without a live session. No Archon engine, no repo src/. */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_WALL_MS,
  armSessionAbort,
  conflictPrompt,
  implementPrompt,
  lastAssistantError,
  lastAssistantText,
  noopAgent,
  proxyEnv,
  ticketSessionFile,
} from "../scripts/agent.ts";
import { REVIEW_TOOLS, REVIEW_WALL_MS, reviewPrompt } from "../scripts/review.ts";
import { expect, expectEqual, mkTemp, sleep } from "./target.ts";

const executeYaml = join(import.meta.dir, "../../ticket-dag-execute/ticket-dag-execute.yaml");
const drainYaml = join(import.meta.dir, "../ticket-dag-drain.yaml");

try {
  const impl = implementPrompt(".scratch/feat/issues/01-demo.md");
  expect("implement inlines skill body", impl.includes("Use /tdd where possible, at pre-agreed seams."));
  expect("implement has ticket path", impl.includes(".scratch/feat/issues/01-demo.md"));
  expect("implement leaves Status unchanged", impl.includes("Leave the ticket file's `Status:` line unchanged"));
  expect("implement has no /skill: name", !impl.includes("/skill:"));
  expect("implement does not spawn pi CLI", !impl.includes("pi -p"));
  expect("implement drops /code-review", !impl.includes("/code-review"));
  expect("implement has no two-axis fanout", !impl.includes("diff-reviewer") && !impl.includes("## Standards"));

  const conf = conflictPrompt(".scratch/feat/issues/01-demo.md");
  expect("conflict inlines skill body", conf.includes("Always resolve; never `--abort`."));
  expect("conflict has ticket path", conf.includes(".scratch/feat/issues/01-demo.md"));
  expect("conflict leaves Status unchanged", conf.includes("Leave the ticket file's `Status:` line unchanged"));
  expect("conflict has no /skill: name", !conf.includes("/skill:"));
  expect("conflict has no two-axis review", !conf.includes("## Standards") && !conf.includes("diff-reviewer"));

  const artifacts = mkTemp("pack-agent-art-");
  try {
    expectEqual(
      "implement session path",
      ticketSessionFile(artifacts, "feat/01", "implement"),
      join(artifacts, "sessions", "feat/01", "implement.jsonl"),
    );
    expectEqual(
      "conflict session path",
      ticketSessionFile(artifacts, "feat/01", "conflict"),
      join(artifacts, "sessions", "feat/01", "conflict.jsonl"),
    );
    expectEqual(
      "review session path",
      ticketSessionFile(artifacts, "drain-review", "review"),
      join(artifacts, "sessions", "drain-review", "review.jsonl"),
    );
    expect(
      "sessions are under artifacts not Run records",
      !ticketSessionFile(artifacts, "feat/01", "implement").includes("orchestrator/runs"),
    );

    const sessionFile = ticketSessionFile(artifacts, "feat/01", "implement");
    mkdirSync(join(artifacts, "sessions", "feat", "01"), { recursive: true });
    writeFileSync(
      sessionFile,
      `${JSON.stringify({ type: "message", message: { role: "assistant", errorMessage: "Request timed out." } })}\n`,
    );
    expectEqual("lastAssistantError", lastAssistantError(sessionFile), "Request timed out.");
    expectEqual("missing session has no error", lastAssistantError(join(artifacts, "missing.jsonl")), undefined);

    const textFile = join(artifacts, "sessions", "feat", "01", "text.jsonl");
    writeFileSync(
      textFile,
      `${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "looks ok" }] } })}\n`,
    );
    expectEqual("lastAssistantText", lastAssistantText(textFile), "looks ok");
    const strFile = join(artifacts, "sessions", "feat", "01", "str.jsonl");
    writeFileSync(
      strFile,
      `${JSON.stringify({ type: "message", message: { role: "assistant", content: "plain" } })}\n`,
    );
    expectEqual("lastAssistantText string content", lastAssistantText(strFile), "plain");
    expectEqual("missing session has no text", lastAssistantText(join(artifacts, "missing.jsonl")), undefined);

    const noop = await noopAgent({
      cwd: artifacts,
      artifactsDir: artifacts,
      ticketId: "feat/01",
      role: "implement",
      model: undefined,
      thinkingLevel: "high",
      prompt: impl,
    });
    expectEqual("noop does not start Pi", noop.sessionFile, sessionFile);
    expectEqual("noop has no lastError", noop.lastError, undefined);
  } finally {
    rmSync(artifacts, { recursive: true, force: true });
  }

  expectEqual("2 hour wall clock", AGENT_WALL_MS, 2 * 60 * 60 * 1000);
  expect("wall clock shorter than Archon timeout", AGENT_WALL_MS < 7_500_000);
  expectEqual("review wall 30 min", REVIEW_WALL_MS, 30 * 60 * 1000);
  expect("review wall shorter than review node timeout", REVIEW_WALL_MS < 2_000_000);
  expectEqual("review tools are read-only", REVIEW_TOOLS, ["read", "grep", "find", "ls"]);

  const rp = reviewPrompt("abc", "c1", "+foo");
  expect("review prompt pins range", rp.includes("abc...HEAD"));
  expect("review forbids /code-review", rp.includes("Do not edit, commit, spawn agents, or invoke /code-review"));
  expect("review forbids Spec axis", rp.includes("Do not produce a Standards-vs-Spec pair"));
  expect("review has no two-axis recipe", !rp.includes("## Standards") && !rp.includes("diff-reviewer"));
  expect("review is not ticket Spec", rp.includes("Do not check ticket acceptance criteria"));

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

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
}
