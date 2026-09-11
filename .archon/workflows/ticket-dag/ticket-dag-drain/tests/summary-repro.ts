#!/usr/bin/env bun
/** Temp-Target repro: drain-end summary node. Fake agent, no live Pi, no Archon engine, no repo src/. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type AgentRunner, type PackAgentOpts, type TicketAgentOpts } from "../scripts/agent.ts";
import { REVIEW_AXES, summaryPersona } from "../scripts/prompt.ts";
import { reviewDrain } from "../scripts/review.ts";
import {
  REVIEW_BASE_REL,
  REVIEW_MD_REL,
  reviewSkipReason,
  skipLine,
  SUMMARY_MD_REL,
  writeReviewBase,
} from "../scripts/review-artifacts.ts";
import { REVIEW_WALL_MS } from "../scripts/roles.ts";
import { runReportNode, type ReportNode } from "../scripts/report-node.ts";
import { roleSessionFile } from "../scripts/session-log.ts";
import { summarizeDrain } from "../scripts/summary.ts";
import { envWithout, expect, expectEqual, gitC, runScript, withTarget } from "./target.ts";

const summaryScript = join(import.meta.dir, "../scripts/summary.ts");
const drainYaml = join(import.meta.dir, "../ticket-dag-drain.yaml");

function readOut(artifacts: string): string {
  return readFileSync(join(artifacts, SUMMARY_MD_REL), "utf8");
}

const REVIEWS = REVIEW_AXES.map((axis, i) => `## ${i + 1}. ${axis}\n\naxis ${i + 1} findings\n`).join("\n");

/**
 * A runner that answers `answer` and leaves `log` in the session file it owns. The log is there to
 * prove the node never reads it: one answer channel means the runner's own answer is the only one.
 */
function fakeAgent(
  answer: string,
  log = answer,
): { run: AgentRunner; calls: () => number; all: () => PackAgentOpts[] } {
  const seen: PackAgentOpts[] = [];
  const run: AgentRunner = async (opts) => {
    seen.push(opts);
    const sessionFile = roleSessionFile(opts.artifactsDir, opts.sessionKey, opts.role);
    mkdirSync(dirname(sessionFile), { recursive: true });
    writeFileSync(
      sessionFile,
      `${JSON.stringify({ type: "message", message: { role: "assistant", content: log } })}\n`,
    );
    return { sessionFile, answer: { kind: "text", text: answer }, lastError: undefined };
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
    const fake = fakeAgent("summary from the runner", "summary from the session log");
    await summarizeDrain(root, {
      artifactsDir: artifacts,
      runAgent: fake.run,
      config: { model: "highland/deepseek-v4-flash", thinkingLevel: "high", concurrency: 4, runner: "pi" },
    });
    expectEqual("one summary agent", fake.calls(), 1);
    const seen = fake.all()[0];
    expect("agent ran", seen);
    expectEqual("summary cwd is Main", seen?.cwd, root);
    expectEqual("summary session key", seen?.sessionKey, "drain-summary");
    expectEqual("summary role", seen?.role, "summary");
    expectEqual("summary model from config", seen?.model, "highland/deepseek-v4-flash");
    expectEqual("summary thinkingLevel from config", seen?.thinkingLevel, "high");
    expectEqual("summary runner from config", seen?.runner, "pi");
    expectEqual(
      "summary opts are the seam's whole vocabulary",
      Object.keys(seen!).sort(),
      [
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
      ],
    );
    expectEqual("summary wall", seen?.wallMs, REVIEW_WALL_MS);
    expect("summary persona pins range", seen?.persona?.includes(`${base}...HEAD`) === true);
    expect("summary persona merges, not reviews", seen?.persona?.includes("you rank and merge, you do not review") === true);
    expect("summary persona names what it dropped", seen?.persona?.includes("Nothing disappears silently") === true);
    // The summary's "merge these N" rule reads the axis owner, not a literal: the count and the
    // section it names come from REVIEW_AXES, so a fourth axis cannot leave the summary told to merge
    // three.
    expect(
      "summary merges the owner's axes, not a literal count",
      seen?.persona?.includes(`summarizing ${REVIEW_AXES.length} independent read-only reviews`) === true &&
        seen?.persona?.includes(`Merge the ${REVIEW_AXES.length} reviews into one report:`) === true,
    );
    // The word "three" is gone: the count is the owner's length, so a fourth axis cannot leave the
    // summary told to merge three.
    expect("summary spells the count, not the word three", !summaryPersona("abc").includes("three"));
    expect(
      "summary task carries range, menu and reviews",
      seen?.prompt.includes(`${base}...HEAD`) === true &&
        seen?.prompt.includes(`HEAD = ${head}`) === true &&
        seen?.prompt.includes(`The ${REVIEW_AXES.length} reviews (review.md):`) === true &&
        seen?.prompt.includes(`## 3. ${REVIEW_AXES[2]}`) === true,
    );
    expectEqual("the runner's own text wins", readOut(artifacts), "summary from the runner\n");
    expect("the log text is not used", !readOut(artifacts).includes("summary from the session log"));
    expectEqual(
      "summary session path",
      roleSessionFile(artifacts, "drain-summary", "summary"),
      join(artifacts, "sessions", "drain-summary", "summary.jsonl"),
    );
  });

  await withReview(async (root, artifacts) => {
    const fake: AgentRunner = async (opts) => ({
      sessionFile: roleSessionFile(opts.artifactsDir, opts.sessionKey, opts.role),
      answer: { kind: "none" },
      lastError: "Request timed out.",
    });
    await summarizeDrain(root, { artifactsDir: artifacts, runAgent: fake });
    expectEqual("a turn with no answer falls back to the runner's failure report", readOut(artifacts), "Request timed out.\n");
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

  // The producer/consumer pair, asserted together. Every case above feeds a hand-written review.md;
  // this one lets review.ts write the real file for a drain that merged nothing and checks that
  // summary.ts spends no agent on it. Hand-written fixtures are how the pair drifted once already.
  await withTarget(async (root, artifacts) => {
    await writeReviewBase(root, artifacts);
    const reviewer = fakeAgent("should not run");
    await reviewDrain(root, { artifactsDir: artifacts, runAgent: reviewer.run });
    expectEqual("empty-range review spends no agent", reviewer.calls(), 0);
    const reviewMd = readFileSync(join(artifacts, REVIEW_MD_REL), "utf8");
    expect("empty-range review.md is a skip", reviewMd.startsWith("skip:"));
    const summariser = fakeAgent("should not run");
    await summarizeDrain(root, { artifactsDir: artifacts, runAgent: summariser.run });
    expectEqual("empty-range summary spends no agent", summariser.calls(), 0);
    expectEqual(
      "empty-range summary skip names the review line",
      readOut(artifacts),
      `skip: review.md: ${reviewMd.trim()}\n`,
    );
    // ... and the consumer writes it from the owner's own vocabulary: the reader's reason line, the
    // owner's line ending. That is the pair the empty-drain P1 was missing.
    expectEqual(
      "the consumer's line is the owner's line",
      readOut(artifacts),
      skipLine(`review.md: ${reviewSkipReason(reviewMd)}`),
    );
  });

  // One conformance suite over the skeleton both report nodes ride. The caller's interface is the
  // same for both - (target, opts) in, one artifact out - so the steps the skeleton owns are asserted
  // once, for both: the base skip writes the owner's line and spends no agent, and the answer channel
  // is the runner's own answer, then its failure report, then the node's fallback.
  const conformance: [string, (t: string, o: TicketAgentOpts) => Promise<void>, string, string][] = [
    ["review", reviewDrain, REVIEW_MD_REL, "(no review text)"],
    ["summary", summarizeDrain, SUMMARY_MD_REL, "(no summary text)"],
  ];
  // A runner that answers no text, reports no error, and left one in the session file it owns.
  const logged: AgentRunner = async (opts) => {
    const sessionFile = roleSessionFile(opts.artifactsDir, opts.sessionKey, opts.role);
    mkdirSync(dirname(sessionFile), { recursive: true });
    writeFileSync(
      sessionFile,
      `${JSON.stringify({ type: "message", message: { role: "assistant", content: "answer from the session log" } })}\n`,
    );
    return { sessionFile, answer: { kind: "none" }, lastError: undefined };
  };
  const silent: AgentRunner = async (opts) => ({
    sessionFile: roleSessionFile(opts.artifactsDir, opts.sessionKey, opts.role),
    answer: { kind: "none" },
    lastError: undefined,
  });
  for (const [name, node, rel, fallback] of conformance) {
    await withTarget(async (root, artifacts) => {
      const fake = fakeAgent("should not run");
      await node(root, { artifactsDir: artifacts, runAgent: fake.run });
      expectEqual(
        `${name} base skip is the owner's line`,
        readFileSync(join(artifacts, rel), "utf8"),
        skipLine("no review-base"),
      );
      expectEqual(`${name} spends no agent on a missing base`, fake.calls(), 0);
    });

    for (const [what, runAgent, want] of [
      ["never reads a session log for its answer", logged, fallback],
      ["ends the answer chain at its own fallback", silent, fallback],
    ] as [string, AgentRunner, string][]) {
      await withReview(async (root, artifacts) => {
        await node(root, { artifactsDir: artifacts, runAgent });
        const body = readFileSync(join(artifacts, rel), "utf8");
        expect(`${name} ${what}`, body.includes(want));
        expect(`${name} leaves the log text out`, !body.includes("answer from the session log"));
      });
    }
  }

  // A fourth report node is a shape, not another copy of the six steps: this throwaway one rides the
  // same skeleton, is handed the same range and writes through the same artifact writer.
  await withTarget(async (root, artifacts) => {
    const base = await writeReviewBase(root, artifacts);
    writeFileSync(join(root, "work.txt"), "x\n");
    gitC(root, "add", "work.txt");
    gitC(root, "commit", "-m", "work");
    const head = gitC(root, "rev-parse", "HEAD");
    const fourth: ReportNode = {
      rel: "fourth.md",
      errorLine: (detail) => `fourth error: ${detail}`,
      read: (input) => {
        expectEqual("the skeleton hands the node its base", input.base, base);
        return {
          report: (range) =>
            Promise.resolve(`base=${range.base}\nhead=${range.head}\nlog=${range.log}\n`),
        };
      },
    };
    await runReportNode(fourth, root, { artifactsDir: artifacts });
    const wrote = readFileSync(join(artifacts, "fourth.md"), "utf8");
    expectEqual("the skeleton writes the node's report: base", wrote.split("\n")[0], `base=${base}`);
    expectEqual("the skeleton writes the node's report: head", wrote.split("\n")[1], `head=${head}`);
    expect(
      "the skeleton hands over the range's commit menu",
      wrote.split("\n")[2]?.endsWith(" work") === true,
      wrote,
    );
    expect("the skeleton ends the artifact once", wrote.endsWith("\n") && !wrote.endsWith("\n\n"));

    // A node that stops writes its own line and never reads the range: the ordering is the skeleton's.
    const stopper: ReportNode = {
      rel: "stop.md",
      errorLine: (detail) => `stop error: ${detail}`,
      read: () => ({ stop: skipLine("nothing to report") }),
    };
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/nope\n");
    await runReportNode(stopper, root, { artifactsDir: artifacts });
    expectEqual(
      "a stop short-circuits the range read",
      readFileSync(join(artifacts, "stop.md"), "utf8"),
      skipLine("nothing to report"),
    );
  });

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
}
