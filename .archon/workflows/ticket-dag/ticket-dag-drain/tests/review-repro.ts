#!/usr/bin/env bun
/** Temp-Target repro: drain-end review node. Fake agent, no live Pi, no Archon engine, no repo src/. */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  ticketSessionFile,
  type AgentRunner,
  type PackAgentOpts,
} from "../scripts/agent.ts";
import { rematchLeftovers } from "../scripts/rematch.ts";
import {
  REVIEW_BASE_REL,
  REVIEW_MD_REL,
  REVIEW_TOOLS,
  REVIEW_WALL_MS,
  reviewDrain,
  writeReviewBase,
} from "../scripts/review.ts";

const reviewScript = join(import.meta.dir, "../scripts/review.ts");

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

function gitC(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function initTarget(): string {
  const root = mkdtempSync(join(tmpdir(), "pack-review-"));
  gitC(root, "init", "-b", "main");
  gitC(root, "config", "user.name", "test");
  gitC(root, "config", "user.email", "test@example.com");
  writeFileSync(join(root, "README.md"), "x\n");
  gitC(root, "add", "README.md");
  gitC(root, "commit", "-m", "init");
  return root;
}

async function withTarget(
  fn: (root: string, artifacts: string) => Promise<void>,
): Promise<void> {
  const root = initTarget();
  const artifacts = mkdtempSync(join(tmpdir(), "pack-review-art-"));
  try {
    await fn(root, artifacts);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(artifacts, { recursive: true, force: true });
  }
}

function readOut(artifacts: string): string {
  return readFileSync(join(artifacts, REVIEW_MD_REL), "utf8");
}

function fakeAgent(
  text: string,
): { run: AgentRunner; calls: () => number; last: () => PackAgentOpts | undefined } {
  let calls = 0;
  let last: PackAgentOpts | undefined;
  const run: AgentRunner = async (opts) => {
    calls += 1;
    last = opts;
    const sessionFile = ticketSessionFile(opts.artifactsDir, opts.ticketId, opts.role);
    mkdirSync(dirname(sessionFile), { recursive: true });
    writeFileSync(
      sessionFile,
      `${JSON.stringify({ type: "message", message: { role: "assistant", content: text } })}\n`,
    );
    return { sessionFile, lastError: undefined };
  };
  return { run, calls: () => calls, last: () => last };
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

  await withTarget(async (root, artifacts) => {
    const fake = fakeAgent("should not run");
    await reviewDrain(root, { artifactsDir: artifacts, runAgent: fake.run });
    expectEqual("missing review-base does not call agent", fake.calls(), 0);
    expectEqual("missing review-base skip", readOut(artifacts), "skip: no review-base\n");
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
    const fake = fakeAgent("bug: missing test");
    await reviewDrain(root, {
      artifactsDir: artifacts,
      runAgent: fake.run,
      config: { model: "highland/deepseek-v4-flash", thinkingLevel: "high", concurrency: 4 },
    });
    expectEqual("non-empty diff calls agent once", fake.calls(), 1);
    const seen = fake.last();
    expect("agent ran", seen);
    expectEqual("review cwd is Main", seen?.cwd, root);
    expectEqual("review ticket id", seen?.ticketId, "drain-review");
    expectEqual("review role", seen?.role, "review");
    expectEqual("review model from config", seen?.model, "highland/deepseek-v4-flash");
    expectEqual("review thinkingLevel from config", seen?.thinkingLevel, "high");
    expectEqual("review tools", seen?.tools, REVIEW_TOOLS);
    expectEqual("review has no bash", seen?.useBash, false);
    expectEqual("review wall", seen?.wallMs, REVIEW_WALL_MS);
    expect("prompt pins range", seen?.prompt.includes(`${base}...HEAD`) === true);
    expect("prompt has diff", seen?.prompt.includes("work.txt") === true);
    expectEqual("bun writes last assistant text", readOut(artifacts), "bug: missing test\n");
    expectEqual(
      "review session path",
      ticketSessionFile(artifacts, "drain-review", "review"),
      join(artifacts, "sessions", "drain-review", "review.jsonl"),
    );
  });

  await withTarget(async (root, artifacts) => {
    await writeReviewBase(root, artifacts);
    writeFileSync(join(root, "work.txt"), "x\n");
    gitC(root, "add", "work.txt");
    gitC(root, "commit", "-m", "work");
    const fake: AgentRunner = async () => {
      throw new Error("boom");
    };
    await reviewDrain(root, { artifactsDir: artifacts, runAgent: fake });
    expectEqual("Pi throw is advisory", readOut(artifacts), "review error: boom\n");
  });

  await withTarget(async (root, artifacts) => {
    await writeReviewBase(root, artifacts);
    writeFileSync(join(root, "work.txt"), "x\n");
    gitC(root, "add", "work.txt");
    gitC(root, "commit", "-m", "work");
    const fake: AgentRunner = async (opts) => ({
      sessionFile: ticketSessionFile(opts.artifactsDir, opts.ticketId, opts.role),
      lastError: "Request timed out.",
    });
    await reviewDrain(root, { artifactsDir: artifacts, runAgent: fake });
    expectEqual("lastError fallback", readOut(artifacts), "Request timed out.\n");
  });

  await withTarget(async (root) => {
    const { ARTIFACTS_DIR: _drop, ...env } = process.env;
    const proc = spawnSync(process.execPath, [reviewScript], {
      cwd: root,
      encoding: "utf8",
      env: { ...env, NODE_USE_ENV_PROXY: "1" },
    });
    expect("bare review without artifacts fails", (proc.status ?? 1) !== 0, proc.status);
    expect("error names missing artifacts", (proc.stderr ?? "").includes("ARTIFACTS_DIR is required"));
  });

  await withTarget(async (root, artifacts) => {
    await writeReviewBase(root, artifacts);
    const { ARTIFACTS_DIR: _drop, ...env } = process.env;
    const proc = spawnSync(process.execPath, [reviewScript], {
      cwd: root,
      encoding: "utf8",
      env: { ...env, ARTIFACTS_DIR: artifacts, NODE_USE_ENV_PROXY: "1" },
    });
    expectEqual("empty-diff CLI exit 0", proc.status ?? 1, 0);
    const body = readOut(artifacts);
    expect("empty-diff CLI skips session", body.includes("empty diff") && body.includes("skipped"));
  });

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
}
