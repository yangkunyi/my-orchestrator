#!/usr/bin/env bun
/** Temp-Target repro: pack Pi SDK wiring without a live session. No Archon engine, no repo src/. */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_WALL_MS,
  armSessionAbort,
  conflictPrompt,
  implementPrompt,
  lastAssistantError,
  noopAgent,
  proxyEnv,
  ticketSessionFile,
} from "../scripts/agent.ts";

const executeYaml = join(import.meta.dir, "../../ticket-dag-execute/ticket-dag-execute.yaml");

function expect(name: string, cond: unknown, detail?: unknown): void {
  if (!cond) {
    throw new Error(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ""}`);
  }
}

function expectEqual(name: string, got: unknown, want: unknown): void {
  const gs = JSON.stringify(got);
  const ws = JSON.stringify(want);
  if (gs !== ws) throw new Error(`${name}: got ${gs}, want ${ws}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

try {
  const impl = implementPrompt(".scratch/feat/issues/01-demo.md");
  expect("implement inlines skill body", impl.includes("Use /tdd where possible, at pre-agreed seams."));
  expect("implement has ticket path", impl.includes(".scratch/feat/issues/01-demo.md"));
  expect("implement leaves Status unchanged", impl.includes("Leave the ticket file's `Status:` line unchanged"));
  expect("implement has no /skill: name", !impl.includes("/skill:"));
  expect("implement does not spawn pi CLI", !impl.includes("pi -p"));

  const conf = conflictPrompt(".scratch/feat/issues/01-demo.md");
  expect("conflict inlines skill body", conf.includes("Always resolve; never `--abort`."));
  expect("conflict has ticket path", conf.includes(".scratch/feat/issues/01-demo.md"));
  expect("conflict leaves Status unchanged", conf.includes("Leave the ticket file's `Status:` line unchanged"));
  expect("conflict has no /skill: name", !conf.includes("/skill:"));
  expect("conflict has no two-axis review", !conf.includes("## Standards") && !conf.includes("diff-reviewer"));

  const artifacts = mkdtempSync(join(tmpdir(), "pack-agent-art-"));
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

  const yaml = readFileSync(executeYaml, "utf8");
  expect("implement node timeout 7500000", /id: implement[\s\S]*?timeout: 7500000/.test(yaml));
  expect("conflict node timeout 7500000", /id: conflict[\s\S]*?timeout: 7500000/.test(yaml));

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
