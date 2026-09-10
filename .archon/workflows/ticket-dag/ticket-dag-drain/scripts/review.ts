import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultAgent, type AgentRunner, type TicketAgentOpts } from "./agent.ts";
import { loadConfig } from "./config.ts";
import { git, gitOrThrow } from "./git.ts";
import { runNode } from "./node-entry.ts";
import { lastAssistantText } from "./session-log.ts";

export const REVIEW_BASE_REL = "review-base";
export const REVIEW_MD_REL = "review.md";
export const REVIEW_WALL_MS = 30 * 60 * 1000;
export const REVIEW_TOOLS = ["read", "grep", "find", "ls"];

const DIFF_MAX = 400_000;

export async function writeReviewBase(target: string, artifactsDir: string): Promise<string> {
  mkdirSync(artifactsDir, { recursive: true });
  const sha = await gitOrThrow(target, ["rev-parse", "HEAD"]);
  writeFileSync(join(artifactsDir, REVIEW_BASE_REL), `${sha}\n`);
  return sha;
}

export function reviewPrompt(base: string, log: string, diff: string): string {
  return `You are a read-only reviewer of git range ${base}...HEAD on this repository.

Use read, grep, find, and ls only. Do not edit, commit, spawn agents, or invoke /code-review or /tdd.

Report only issues in added or modified lines, plus the impact of those changes on other files.

Cover:
1. Bugs and incorrect assumptions in the diff
2. Missing tests for changed behavior
3. Cross-file breakage (callers, contracts, tickets interacting)

Do not check ticket acceptance criteria. Do not produce a Standards-vs-Spec pair.

If nothing material, say so briefly. Markdown. Under 800 words.

Commits:
${log || "(none)"}

Diff:
\`\`\`diff
${diff}
\`\`\`
`;
}

function capDiff(diff: string): string {
  if (diff.length <= DIFF_MAX) return diff;
  return `${diff.slice(0, DIFF_MAX)}\n\n[truncated ${String(diff.length - DIFF_MAX)} bytes]\n`;
}

export async function reviewDrain(target: string, opts: TicketAgentOpts): Promise<void> {
  const outFile = join(opts.artifactsDir, REVIEW_MD_REL);
  const baseFile = join(opts.artifactsDir, REVIEW_BASE_REL);
  mkdirSync(opts.artifactsDir, { recursive: true });
  if (!existsSync(baseFile)) {
    writeFileSync(outFile, "skip: no review-base\n");
    return;
  }
  const base = readFileSync(baseFile, "utf8").trim();
  if (!base) {
    writeFileSync(outFile, "skip: empty review-base\n");
    return;
  }
  const diffR = await git(target, ["diff", `${base}...HEAD`]);
  if (!diffR.ok) {
    writeFileSync(outFile, `review error: git diff ${diffR.stderr || diffR.stdout}\n`);
    return;
  }
  const logR = await git(target, ["log", `${base}..HEAD`, "--oneline"]);
  const diff = diffR.stdout;
  if (!diff.trim()) {
    writeFileSync(outFile, `empty diff ${base}...HEAD, skipped\n`);
    return;
  }
  const config = opts.config ?? loadConfig(target);
  const runAgent: AgentRunner = opts.runAgent ?? defaultAgent;
  try {
    const pi = await runAgent({
      cwd: target,
      artifactsDir: opts.artifactsDir,
      ticketId: "drain-review",
      role: "review",
      model: config.model,
      thinkingLevel: config.thinkingLevel,
      prompt: reviewPrompt(base, logR.stdout, capDiff(diff)),
      tools: REVIEW_TOOLS,
      useBash: false,
      wallMs: REVIEW_WALL_MS,
    });
    const text = lastAssistantText(pi.sessionFile) ?? pi.lastError ?? "(no review text)";
    writeFileSync(outFile, text.endsWith("\n") ? text : `${text}\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeFileSync(outFile, `review error: ${msg}\n`);
  }
}

export async function runReviewCli(): Promise<void> {
  await runNode({
    artifacts: true,
    proxy: true,
    run: ({ target, artifactsDir, config }) => reviewDrain(target, { artifactsDir, config }),
  });
}

if (import.meta.main) {
  await runReviewCli();
}
