#!/usr/bin/env bun
/** Temp-Target repro: drain-end review node. Fake agent, no live Pi, no Archon engine, no repo src/. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type AgentRunner, type PackAgentOpts } from "../scripts/agent.ts";
import { axisHeading, REVIEW_AXES } from "../scripts/prompt.ts";
import { roleSessionFile } from "../scripts/session-log.ts";
import { rematchLeftovers } from "../scripts/rematch.ts";
import { reviewDrain } from "../scripts/review.ts";
import {
  readReviewBase,
  REVIEW_BASE_REL,
  REVIEW_MD_REL,
  reviewErrorLine,
  reviewErrorText,
  reviewSkipReason,
  skipLine,
  writeArtifact,
  writeReviewBase,
} from "../scripts/review-artifacts.ts";
import { REVIEW_WALL_MS } from "../scripts/roles.ts";
import {
  envWithout,
  expect,
  expectEqual,
  gitC,
  runScript,
  withTarget,
} from "./target.ts";

const reviewScript = join(import.meta.dir, "../scripts/review.ts");

function readOut(artifacts: string): string {
  return readFileSync(join(artifacts, REVIEW_MD_REL), "utf8");
}

function section(body: string, i: number): string {
  const part = body.split(/^## /m)[i + 1] ?? "";
  const nl = part.indexOf("\n");
  return nl < 0 ? "" : part.slice(nl);
}

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

try {
  await withTarget(async (root, artifacts) => {
    const sha = await writeReviewBase(root, artifacts);
    expectEqual("writeReviewBase SHA", sha, gitC(root, "rev-parse", "HEAD"));
    expectEqual(
      "review-base file",
      readFileSync(join(artifacts, REVIEW_BASE_REL), "utf8").trim(),
      sha,
    );
  });

  await withTarget(async (root, artifacts) => {
    const head = gitC(root, "rev-parse", "HEAD");
    await rematchLeftovers(root, artifacts);
    expectEqual(
      "rematch writes review-base",
      readFileSync(join(artifacts, REVIEW_BASE_REL), "utf8").trim(),
      head,
    );
    expectEqual("no leftovers, HEAD unchanged", gitC(root, "rev-parse", "HEAD"), head);
  });

  // The review-base / review.md protocol has one owner (review-artifacts.ts): the lines review.ts
  // writes are built by that module, and summary.ts reads them back through its one reader. The
  // literals below are the byte contract; the round-trip assertions are what make the two sides
  // share one spelling instead of matching by convention.
  expectEqual("skip line", skipLine("no review-base"), "skip: no review-base\n");
  expectEqual("review error line", reviewErrorLine("git diff boom"), "review error: git diff boom\n");
  expectEqual("one axis' error body", reviewErrorText("boom"), "review error: boom");
  expectEqual(
    "the reader takes the producer's skip",
    reviewSkipReason(skipLine("empty diff abc...HEAD, skipped")),
    "skip: empty diff abc...HEAD, skipped",
  );
  expectEqual(
    "the reader takes the producer's error",
    reviewSkipReason(reviewErrorLine("git diff boom")),
    "review error: git diff boom",
  );
  expectEqual("a report is not a skip", reviewSkipReason(`## 1. ${REVIEW_AXES[0]}\n\nfindings\n`), null);
  expectEqual("an empty review.md is not a skip", reviewSkipReason("\n"), null);
  // The axis owner spells the review.md section once: `## <n>. <title>`. The fan-out and summary read
  // the same owner, so the byte format lives here as a literal rather than in review.ts.
  expectEqual("the section heading is one spelling", axisHeading({ index: 2, title: "X" }), "## 3. X");
  // The P1's shape: the bare sentence review.ts used to write must still read as a report, so the
  // skip vocabulary is what separates the two cases rather than the wording around it.
  expectEqual(
    "the bare sentence is not a skip",
    reviewSkipReason("empty diff abc...HEAD, skipped\n"),
    null,
  );

  await withTarget(async (root, artifacts) => {
    const file = join(artifacts, "probe.md");
    writeArtifact(file, "no newline");
    expectEqual("one artifact ends with one newline", readFileSync(file, "utf8"), "no newline\n");
    writeArtifact(file, "no second newline\n");
    expectEqual("the newline is not doubled", readFileSync(file, "utf8"), "no second newline\n");
  });

  // An import direction has no runtime symptom, and rematch is the drain's first node: it must not
  // reach into the drain-end review module for the base the whole drain reads.
  const rematchSrc = readFileSync(join(import.meta.dir, "../scripts/rematch.ts"), "utf8");
  expect("rematch does not import the review node", !rematchSrc.includes('from "./review.ts"'));
  expect(
    "rematch takes its writer from the artifact module",
    /import \{ writeReviewBase \} from "\.\/review-artifacts\.ts"/.test(rematchSrc),
  );

  await withTarget(async (root, artifacts) => {
    const fake = fakeAgent("should not run");
    await reviewDrain(root, { artifactsDir: artifacts, runAgent: fake.run });
    expectEqual("missing review-base does not call agent", fake.calls(), 0);
    expectEqual("missing review-base skip", readOut(artifacts), "skip: no review-base\n");
    // The producer's real bytes are the owner's line, and the consumer's reader agrees with them.
    expectEqual("the producer's skip is the owner's line", readOut(artifacts), skipLine("no review-base"));
    expectEqual("the reader agrees with the producer", reviewSkipReason(readOut(artifacts)), "skip: no review-base");
  });

  await withTarget(async (root, artifacts) => {
    expectEqual("missing review-base reads as a skip", readReviewBase(artifacts), {
      skip: "skip: no review-base\n",
    });
    writeFileSync(join(artifacts, REVIEW_BASE_REL), "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n");
    expectEqual("a base reads back trimmed", readReviewBase(artifacts), {
      base: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
    writeFileSync(join(artifacts, REVIEW_BASE_REL), "\n");
    expectEqual("an empty review-base reads as a skip", readReviewBase(artifacts), {
      skip: "skip: empty review-base\n",
    });
  });

  await withTarget(async (root, artifacts) => {
    writeFileSync(join(artifacts, REVIEW_BASE_REL), "\n");
    const fake = fakeAgent("should not run");
    await reviewDrain(root, { artifactsDir: artifacts, runAgent: fake.run });
    expectEqual("empty review-base does not call agent", fake.calls(), 0);
    expectEqual("empty review-base skip", readOut(artifacts), "skip: empty review-base\n");
  });

  await withTarget(async (root, artifacts) => {
    await writeReviewBase(root, artifacts);
    const fake = fakeAgent("should not run");
    await reviewDrain(root, { artifactsDir: artifacts, runAgent: fake.run });
    expectEqual("empty diff does not call agent", fake.calls(), 0);
    const body = readOut(artifacts);
    expect("empty diff skip names range", body.includes("empty diff") && body.includes("skipped"));
  });

  await withTarget(async (root, artifacts) => {
    writeFileSync(join(artifacts, REVIEW_BASE_REL), "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n");
    const fake = fakeAgent("should not run");
    await reviewDrain(root, { artifactsDir: artifacts, runAgent: fake.run });
    expectEqual("bad base does not call agent", fake.calls(), 0);
    expect("git diff fail writes error", readOut(artifacts).startsWith("review error: git diff"));
  });

  await withTarget(async (root, artifacts) => {
    const base = await writeReviewBase(root, artifacts);
    writeFileSync(join(root, "work.txt"), "x\n");
    gitC(root, "add", "work.txt");
    gitC(root, "commit", "-m", "work");
    const head = gitC(root, "rev-parse", "HEAD");
    const fake = fakeAgent("bug: missing test");
    await reviewDrain(root, {
      artifactsDir: artifacts,
      runAgent: fake.run,
      config: { model: "highland/deepseek-v4-flash", thinkingLevel: "high", concurrency: 4, runner: "pi" },
    });

    expectEqual("one reviewer per axis", fake.calls(), REVIEW_AXES.length);
    const seen = fake.all();
    for (const [i, opts] of seen.entries()) {
      const tag = `axis ${i + 1}`;
      expectEqual(`${tag} cwd is Main`, opts.cwd, root);
      expectEqual(`${tag} has its own session`, opts.sessionKey, `drain-review-${i + 1}`);
      expectEqual(`${tag} role`, opts.role, "review");
      expectEqual(`${tag} model from config`, opts.model, "highland/deepseek-v4-flash");
      expectEqual(`${tag} thinkingLevel from config`, opts.thinkingLevel, "high");
      expectEqual(`${tag} runner from config`, opts.runner, "pi");
      expectEqual(
        `${tag} opts are the seam's whole vocabulary`,
        Object.keys(opts).sort(),
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
      expectEqual(`${tag} wall`, opts.wallMs, REVIEW_WALL_MS);
      expect(`${tag} persona pins range`, opts.persona?.includes(`${base}...HEAD`) === true);
      expect(`${tag} persona is this axis only`, opts.persona?.includes(`Your axis: ${REVIEW_AXES[i]}`) === true);
      for (const [j, other] of REVIEW_AXES.entries()) {
        if (j !== i) expect(`${tag} persona leaves axis ${j + 1} to others`, !opts.persona?.includes(other));
      }
      expect(
        `${tag} message hands over the range, not the diff`,
        opts.prompt.includes(`${base}...HEAD`) &&
          opts.prompt.includes(`HEAD = ${head}`) &&
          opts.prompt.includes("work") &&
          !opts.prompt.includes("diff --git"),
      );
    }

    const body = readOut(artifacts);
    for (const [i, axis] of REVIEW_AXES.entries()) {
      expect(`report heads axis ${i + 1}`, body.includes(`## ${i + 1}. ${axis}`));
      expect(`axis ${i + 1} carries its findings`, section(body, i).includes("bug: missing test"));
    }
    expectEqual("three sections, one report", body.split(/^## /m).length - 1, REVIEW_AXES.length);
    expectEqual(
      "review session path",
      roleSessionFile(artifacts, "drain-review-2", "review"),
      join(artifacts, "sessions", "drain-review-2", "review.jsonl"),
    );

    // The other runner gets the same contract, the same handover and the same message: only the
    // mechanics behind opts.runner differ.
    await reviewDrain(root, {
      artifactsDir: artifacts,
      runAgent: fake.run,
      config: { model: undefined, thinkingLevel: "high", concurrency: 4, runner: "dsh" },
    });
    const dsh = fake.all().slice(REVIEW_AXES.length);
    expectEqual("dsh review runner", dsh[0]?.runner, "dsh");
    expect("one contract, two runners", dsh.every((o, i) => o.persona === seen[i]?.persona));
    expect("same message either way", dsh.every((o, i) => o.prompt === seen[i]?.prompt));
    // A runner that cannot honour an option is never handed one: the read-only contract of a reviewer
    // reaches dsh in the persona, which is the only enforcement it has (see dsh-agent-repro.ts).
    expect("dsh is handed nothing it would ignore", dsh.every((o) => !("tools" in o) && !("useBash" in o)));
  });

  // One answer channel: the runner hands its answer over, and its session log is never read back - a
  // runner whose log disagrees with its answer is the only thing the node ever sees.
  await withTarget(async (root, artifacts) => {
    await writeReviewBase(root, artifacts);
    writeFileSync(join(root, "work.txt"), "y\n");
    gitC(root, "add", "work.txt");
    gitC(root, "commit", "-m", "work");
    const fake = fakeAgent("answer from the runner", "text from the session log");
    await reviewDrain(root, { artifactsDir: artifacts, runAgent: fake.run });
    const body = readOut(artifacts);
    expectEqual(
      "the runner's own answer is the review",
      REVIEW_AXES.map((_, i) => section(body, i).trim()),
      REVIEW_AXES.map(() => "answer from the runner"),
    );
    expect("no session log text survives", !body.includes("text from the session log"));
  });

  // The skeleton reads no log for the answer, so nothing in the node knows a session format at all.
  expect(
    "the report node never reads a session log",
    !readFileSync(join(import.meta.dir, "../scripts/report-node.ts"), "utf8").includes("session-log"),
  );

  // One axis blowing up does not take the other two down: its own section carries the error.
  await withTarget(async (root, artifacts) => {
    await writeReviewBase(root, artifacts);
    writeFileSync(join(root, "work.txt"), "x\n");
    gitC(root, "add", "work.txt");
    gitC(root, "commit", "-m", "work");
    const fake = fakeAgent("ok");
    let calls = 0;
    const flaky: AgentRunner = async (opts) => {
      calls += 1;
      if (calls === 2) throw new Error("boom");
      return fake.run(opts);
    };
    await reviewDrain(root, { artifactsDir: artifacts, runAgent: flaky });
    const body = readOut(artifacts);
    expect("the failed axis reports its own error", section(body, 1).includes("review error: boom"));
    expect("the other axes still report", section(body, 0).includes("ok") && section(body, 2).includes("ok"));
    expect("a review error is still advisory", body.startsWith(`## 1. ${REVIEW_AXES[0]}`));
  });

  await withTarget(async (root, artifacts) => {
    await writeReviewBase(root, artifacts);
    writeFileSync(join(root, "work.txt"), "x\n");
    gitC(root, "add", "work.txt");
    gitC(root, "commit", "-m", "work");
    const fake: AgentRunner = async (opts) => ({
      sessionFile: roleSessionFile(opts.artifactsDir, opts.sessionKey, opts.role),
      answer: { kind: "none" },
      lastError: "Request timed out.",
    });
    await reviewDrain(root, { artifactsDir: artifacts, runAgent: fake });
    const body = readOut(artifacts);
    expectEqual(
      "a turn with no answer falls back to the runner's failure report",
      REVIEW_AXES.map((_, i) => section(body, i).trim()),
      REVIEW_AXES.map(() => "Request timed out."),
    );
  });

  // The review node is the one report node that may write the first artifact into a fresh
  // ARTIFACTS_DIR; summary assumes review-base means one exists. Pinned so a later wave cannot drop
  // the directory and turn a skip into a throw.
  await withTarget(async (root, artifacts) => {
    const fresh = join(artifacts, "fresh");
    const fake = fakeAgent("should not run");
    await reviewDrain(root, { artifactsDir: fresh, runAgent: fake.run });
    expectEqual(
      "a fresh ARTIFACTS_DIR gets the base skip",
      readFileSync(join(fresh, REVIEW_MD_REL), "utf8"),
      skipLine("no review-base"),
    );
    expectEqual("a fresh ARTIFACTS_DIR spends no agent", fake.calls(), 0);
  });

  await withTarget(async (root) => {
    const proc = runScript(reviewScript, root, envWithout("ARTIFACTS_DIR"));
    expect("bare review without artifacts fails", (proc.status ?? 1) !== 0, proc.status);
    expect("error names missing artifacts", proc.stderr.includes("ARTIFACTS_DIR is required"));
  });

  await withTarget(async (root, artifacts) => {
    await writeReviewBase(root, artifacts);
    const proc = runScript(reviewScript, root, { ARTIFACTS_DIR: artifacts });
    expectEqual("empty-diff CLI exit 0", proc.status ?? 1, 0);
    const body = readOut(artifacts);
    expect("empty-diff CLI skips session", body.includes("empty diff") && body.includes("skipped"));
  });

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
}
