import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TicketAgentOpts } from "./agent.ts";
import { summaryTask } from "./prompt.ts";
import { reportNodeCli, runReportNode, type ReportNode } from "./report-node.ts";
import {
  REVIEW_MD_REL,
  reviewSkipReason,
  skipLine,
  SUMMARY_MD_REL,
} from "./review-artifacts.ts";

/**
 * The summary node: one agent merges the three reviews into a report a human reads first. It runs
 * only when there is something to merge - a skipped or errored review is not worth a session, and
 * the artifact says which case it was.
 */
const SUMMARY_NODE: ReportNode = {
  rel: SUMMARY_MD_REL,
  errorLine: (detail) => `summary error: ${detail}`,
  read: ({ artifactsDir, base }) => {
    const reviewFile = join(artifactsDir, REVIEW_MD_REL);
    if (!existsSync(reviewFile)) return { stop: skipLine("no review.md") };
    const reviewMd = readFileSync(reviewFile, "utf8");
    if (!reviewMd.trim()) return { stop: skipLine("empty review.md") };
    const skipped = reviewSkipReason(reviewMd);
    if (skipped) return { stop: skipLine(`review.md: ${skipped}`) };
    return {
      report: (range) =>
        range.ask({
          role: "summary",
          args: { base },
          prompt: summaryTask(base, range.head, range.log, reviewMd),
          fallback: "(no summary text)",
        }),
    };
  },
};

export async function summarizeDrain(target: string, opts: TicketAgentOpts): Promise<void> {
  await runReportNode(SUMMARY_NODE, target, opts);
}

export const runSummaryCli = reportNodeCli(SUMMARY_NODE);

if (import.meta.main) {
  await runSummaryCli();
}
