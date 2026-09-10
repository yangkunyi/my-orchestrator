#!/usr/bin/env bun
/** Temp-Target repro: drain-end summary node. Fake agent, no live Pi, no Archon engine, no repo src/. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type AgentRunner, type PackAgentOpts } from "../scripts/agent.ts";
import { REVIEW_AXES } from "../scripts/prompt.ts";
import { REVIEW_BASE_REL, REVIEW_MD_REL, REVIEW_TOOLS, REVIEW_WALL_MS, writeReviewBase } from "../scripts/review.ts";
import { ticketSessionFile } from "../scripts/session-log.ts";
import { SUMMARY_MD_REL, summarizeDrain } from "../scripts/summary.ts";
import { envWithout, expect, expectEqual, gitC, runScript, withTarget } from "./target.ts";

const summaryScript = join(import.meta.dir, "../scripts/summary.ts");
const drainYaml = join(import.meta.dir, "../ticket-dag-drain.yaml");

function readOut(artifacts: string): string {
  return readFileSync(join(artifacts, SUMMARY_MD_REL), "utf8");
}

const REVIEWS = REVIEW_AXES.map((axis, i) => `## ${i + 1}. ${axis}\n\naxis ${i + 1} findings\n`).join("\n");

function fakeAgent(
  text: string,
  answer?: string,
): { run: AgentRunner; calls: () => number; all: () => PackAgentOpts[] } {
  const seen: PackAgentOpts[] = [];
  const run: AgentRunner = async (opts) => {
    seen.push(opts);
    const sessionFile = ticketSessionFile(opts.artifactsDir, opts.ticketId, opts.role);
    mkdirSync(dirname(sessionFile), { recursive: true });
    writeFileSync(
      sessionFile,
      `${JSON.stringify({ type: "message", message: { role: "assistant", content: text } })}\n`,
    );
    return { sessionFile, lastError: undefined, ...(answer === undefined ? {} : { text: answer }) };
  };
  return { run, calls: () => seen.length, all: () => seen };
}

async function withReview(
  fn: (root: string, artifacts: string, base: string, head: string) => Promise<void>,
  reviewMd: string | undefined = REVIEWS,
): Promise<void> {
  await withTarget(async (root, artifacts) => {
    const base = await writeReviewBase(root, artifacts);
    writeFileSync(join(root, "work.txt"), "x\n");
    gitC(root, "add", "work.txt");
    gitC(root, "commit", "-m", "work");
    if (reviewMd !== undefined) writeFileSync(join(artifacts, REVIEW_MD_REL), reviewMd);
    await fn(root, artifacts, base, gitC(root, "rev-parse", "HEAD"));
  });
}

try {
  // Nothing to merge: every one of these must skip without spending an agent.
  await withTarget(async (root, artifacts) => {
    const fake = fakeAgent("should not run");
    await summarizeDrain(root, { artifactsDir: artifacts, runAgent: fake.run });
    expectEqual("no review-base does not call agent", fake.calls(), 0);
    expectEqual("no review-base skip", readOut(artifacts), "skip: no review-base\n");
  });

  await withTarget(async (root, artifacts) => {
    writeFileSync(join(artifacts, REVIEW_BASE_REL), "\n");
    const fake = fakeAgent("should not run");
    await summarizeDrain(root, { artifactsDir: artifacts, runAgent: fake.run });
    expectEqual("empty review-base does not call agent", fake.calls(), 0);
    expectEqual("empty review-base skip", readOut(artifacts), "skip: empty review-base\n");
  });

  const skipCases: [string, string, string | undefined][] = [
    ["no review.md", "skip: no review.md\n", undefined],
    ["empty review.md", "skip: empty review.md\n", "\n"],
    ["skipped review", "skip: review.md: skip: empty diff abc, skipped\n", "skip: empty diff abc, skipped\n"],
    ["errored review", "skip: review.md: review error: git diff boom\n", "review error: git diff boom\n"],
  ];
  for (const [name, want, reviewMd] of skipCases) {
    await withTarget(async (root, artifacts) => {
      writeFileSync(join(artifacts, REVIEW_BASE_REL), "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n");
      if (reviewMd !== undefined) writeFileSync(join(artifacts, REVIEW_MD_REL), reviewMd);
      const fake = fakeAgent("should not run");
      await summarizeDrain(root, { artifactsDir: artifacts, runAgent: fake.run });
      expectEqual(`${name} does not call agent`, fake.calls(), 0);
      expectEqual(`${name} skip`, readOut(artifacts), want);
    });
  }

  await withReview(async (root, artifacts, base, head) => {
    const fake = fakeAgent("summary from the log", "summary from the runner");
    await summarizeDrain(root, {
      artifactsDir: artifacts,
      runAgent: fake.run,
      config: { model: "highland/deepseek-v4-flash", thinkingLevel: "high", concurrency: 4, runner: "pi" },
    });
    expectEqual("one summary agent", fake.calls(), 1);
    const seen = fake.all()[0];
    expect("agent ran", seen);
    expectEqual("summary cwd is Main", seen?.cwd, root);
    expectEqual("summary ticket id", seen?.ticketId, "drain-summary");
    expectEqual("summary role", seen?.role, "summary");
    expectEqual("summary model from config", seen?.model, "highland/deepseek-v4-flash");
    expectEqual("summary thinkingLevel from config", seen?.thinkingLevel, "high");
    expectEqual("summary runner from config", seen?.runner, "pi");
    expectEqual("summary tools", seen?.tools, REVIEW_TOOLS);
    expectEqual("summary may read git through bash", seen?.useBash, true);
    expectEqual("summary wall", seen?.wallMs, REVIEW_WALL_MS);
    expect("summary persona pins range", seen?.persona?.includes(`${base}...HEAD`) === true);
    expect("summary persona merges, not reviews", seen?.persona?.includes("you rank and merge, you do not review") === true);
    expect("summary persona names what it dropped", seen?.persona?.includes("Nothing disappears silently") === true);
    expect(
      "summary task carries range, menu and reviews",
      seen?.prompt.includes(`${base}...HEAD`) === true &&
        seen?.prompt.includes(`HEAD = ${head}`) === true &&
        seen?.prompt.includes("The three reviews (review.md):") === true &&
        seen?.prompt.includes(`## 3. ${REVIEW_AXES[2]}`) === true,
    );
    expectEqual("the runner's own text wins", readOut(artifacts), "summary from the runner\n");
    expect("the log text is not used", !readOut(artifacts).includes("summary from the log"));
    expectEqual(
      "summary session path",
      ticketSessionFile(artifacts, "drain-summary", "summary"),
      join(artifacts, "sessions", "drain-summary", "summary.jsonl"),
    );
  });

  await withReview(async (root, artifacts) => {
    const fake: AgentRunner = async (opts) => ({
      sessionFile: ticketSessionFile(opts.artifactsDir, opts.ticketId, opts.role),
      lastError: "Request timed out.",
    });
    await summarizeDrain(root, { artifactsDir: artifacts, runAgent: fake });
    expectEqual("lastError fallback", readOut(artifacts), "Request timed out.\n");
  });

  await withReview(async (root, artifacts) => {
    const fake: AgentRunner = async () => {
      throw new Error("boom");
    };
    await summarizeDrain(root, { artifactsDir: artifacts, runAgent: fake });
    expectEqual("a summary throw is advisory", readOut(artifacts), "summary error: boom\n");
  });

  await withReview(async (root, artifacts) => {
    const fake = fakeAgent("another runner");
    await summarizeDrain(root, {
      artifactsDir: artifacts,
      runAgent: fake.run,
      config: { model: undefined, thinkingLevel: "high", concurrency: 4, runner: "dsh" },
    });
    expectEqual("dsh summary runner", fake.all()[0]?.runner, "dsh");
  });

  await withTarget(async (root) => {
    const proc = runScript(summaryScript, root, envWithout("ARTIFACTS_DIR"));
    expect("bare summary without artifacts fails", (proc.status ?? 1) !== 0, proc.status);
    expect("error names missing artifacts", proc.stderr.includes("ARTIFACTS_DIR is required"));
  });

  await withReview(
    async (root, artifacts) => {
      const proc = runScript(summaryScript, root, { ARTIFACTS_DIR: artifacts });
      expectEqual("skipped-review CLI exit 0", proc.status ?? 1, 0);
      expect("CLI propagates the skip", readOut(artifacts).startsWith("skip:"));
    },
    "skip: no review-base\n",
  );

  const drain = readFileSync(drainYaml, "utf8");
  expect("summary node after review", /id: summary[\s\S]*?depends_on: \[review\]/.test(drain));
  expect("summary node timeout 2000000", /id: summary[\s\S]*?timeout: 2000000/.test(drain));
  expect("summary script is pack bun", /id: summary[\s\S]*?script: summary/.test(drain));

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
}
