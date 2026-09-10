import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultAgent, type AgentRunner, type TicketAgentOpts } from "./agent.ts";
import { loadConfig } from "./config.ts";
import { git } from "./git.ts";
import { runNode } from "./node-entry.ts";
import { summaryTask } from "./prompt.ts";
import { REVIEW_BASE_REL, REVIEW_MD_REL } from "./review.ts";
import { roleAgent } from "./roles.ts";
import { lastAssistantText } from "./session-log.ts";

export const SUMMARY_MD_REL = "summary.md";

function write(outFile: string, body: string): void {
  writeFileSync(outFile, body.endsWith("\n") ? body : `${body}\n`);
}

/**
 * The last node: one agent merges the three reviews into a report a human reads first. It runs only
 * when there is something to merge - a skipped or errored review is not worth a session, and the
 * artifact says which case it was.
 */
export async function summarizeDrain(target: string, opts: TicketAgentOpts): Promise<void> {
  const outFile = join(opts.artifactsDir, SUMMARY_MD_REL);
  const baseFile = join(opts.artifactsDir, REVIEW_BASE_REL);
  const reviewFile = join(opts.artifactsDir, REVIEW_MD_REL);
  if (!existsSync(baseFile)) {
    write(outFile, "skip: no review-base");
    return;
  }
  const base = readFileSync(baseFile, "utf8").trim();
  if (!base) {
    write(outFile, "skip: empty review-base");
    return;
  }
  if (!existsSync(reviewFile)) {
    write(outFile, "skip: no review.md");
    return;
  }
  const reviewMd = readFileSync(reviewFile, "utf8");
  if (!reviewMd.trim()) {
    write(outFile, "skip: empty review.md");
    return;
  }
  if (/^(skip|review error):/.test(reviewMd.trim())) {
    write(outFile, `skip: review.md: ${reviewMd.trim().split("\n")[0]}`);
    return;
  }
  const headR = await git(target, ["rev-parse", "HEAD"]);
  if (!headR.ok) {
    write(outFile, `summary error: git rev-parse ${headR.stderr || headR.stdout}`);
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
    write(outFile, text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    write(outFile, `summary error: ${msg}`);
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
