import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultAgent, type AgentRunner, type TicketAgentOpts } from "./agent.ts";
import { loadConfig } from "./config.ts";
import { git } from "./git.ts";
import { runNode } from "./node-entry.ts";
import { summaryTask } from "./prompt.ts";
import {
  readReviewBase,
  REVIEW_MD_REL,
  reviewSkipReason,
  skipLine,
  SUMMARY_MD_REL,
  writeArtifact,
} from "./review-artifacts.ts";
import { roleAgent } from "./roles.ts";
import { lastAssistantText } from "./session-log.ts";

/**
 * The last node: one agent merges the three reviews into a report a human reads first. It runs only
 * when there is something to merge - a skipped or errored review is not worth a session, and the
 * artifact says which case it was.
 */
export async function summarizeDrain(target: string, opts: TicketAgentOpts): Promise<void> {
  const outFile = join(opts.artifactsDir, SUMMARY_MD_REL);
  const baseR = readReviewBase(opts.artifactsDir);
  if ("skip" in baseR) {
    writeArtifact(outFile, baseR.skip);
    return;
  }
  const base = baseR.base;
  const reviewFile = join(opts.artifactsDir, REVIEW_MD_REL);
  if (!existsSync(reviewFile)) {
    writeArtifact(outFile, skipLine("no review.md"));
    return;
  }
  const reviewMd = readFileSync(reviewFile, "utf8");
  if (!reviewMd.trim()) {
    writeArtifact(outFile, skipLine("empty review.md"));
    return;
  }
  const skipped = reviewSkipReason(reviewMd);
  if (skipped) {
    writeArtifact(outFile, skipLine(`review.md: ${skipped}`));
    return;
  }
  const headR = await git(target, ["rev-parse", "HEAD"]);
  if (!headR.ok) {
    writeArtifact(outFile, `summary error: git rev-parse ${headR.stderr || headR.stdout}`);
    return;
  }
  const logR = await git(target, ["log", `${base}..HEAD`, "--oneline"]);
  const config = opts.config ?? loadConfig(target);
  const runAgent: AgentRunner = opts.runAgent ?? defaultAgent;
  try {
    const agent = roleAgent({
      role: "summary",
      args: { base },
      cwd: target,
      artifactsDir: opts.artifactsDir,
      config,
      prompt: summaryTask(base, headR.stdout.trim(), logR.ok ? logR.stdout : "", reviewMd),
    });
    const r = await runAgent(agent.opts);
    // The runner's own final message first, as in review: the session log is the fallback for a runner
    // that does not hand one over.
    const text = r.text ?? lastAssistantText(r.sessionFile) ?? r.lastError ?? "(no summary text)";
    writeArtifact(outFile, text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeArtifact(outFile, `summary error: ${msg}`);
  }
}

export async function runSummaryCli(): Promise<void> {
  await runNode({
    artifacts: true,
    proxy: true,
    run: ({ target, artifactsDir, config }) => summarizeDrain(target, { artifactsDir, config }),
  });
}

if (import.meta.main) {
  await runSummaryCli();
}
