import { mkdirSync } from "node:fs";
import type { TicketAgentOpts } from "./agent.ts";
import { git } from "./git.ts";
import { axisHeading, reviewAxes, reviewTask } from "./prompt.ts";
import { reportNodeCli, runReportNode, type ReportNode } from "./report-node.ts";
import { REVIEW_MD_REL, reviewErrorLine, reviewErrorText, skipLine } from "./review-artifacts.ts";

/**
 * The review node: three reviewers in parallel, one per axis, each writing its own section of
 * review.md.
 */
const REVIEW_NODE: ReportNode = {
  rel: REVIEW_MD_REL,
  errorLine: reviewErrorLine,
  // Reviewers fetch the range themselves, so bun only probes it: an empty range still skips before
  // any agent is spent, and a base git cannot read is still a bun-side error rather than three
  // confused reviewers. Nothing is pasted into the prompt - the diff used to be capped and handed
  // over.
  read: async ({ target, base }) => {
    const probe = await git(target, ["diff", "--stat", `${base}...HEAD`]);
    if (!probe.ok) return { stop: reviewErrorLine(`git diff ${probe.stderr || probe.stdout}`) };
    // An empty range is a skip, not a report: the consumer must not spend a summary agent on it.
    if (!probe.stdout.trim()) return { stop: skipLine(`empty diff ${base}...HEAD, skipped`) };
    return {
      report: async (range) => {
        const sections = await Promise.all(
          reviewAxes().map(async (axis) => {
            const heading = axisHeading(axis);
            try {
              const text = await range.ask({
                role: "review",
                args: { axisIndex: axis.index, base: range.base, axis: axis.title },
                prompt: reviewTask(range.base, range.head, range.log),
                fallback: "(no review text)",
              });
              return { heading, body: text.trim() };
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              return { heading, body: reviewErrorText(msg) };
            }
          }),
        );
        return sections.map((s) => `${s.heading}\n\n${s.body}\n`).join("\n");
      },
    };
  },
};

export async function reviewDrain(target: string, opts: TicketAgentOpts): Promise<void> {
  // This node may write review.md into an ARTIFACTS_DIR nobody has created yet - writeArtifact does
  // not create the directory - where summary only ever runs once review-base is in one.
  mkdirSync(opts.artifactsDir, { recursive: true });
  await runReportNode(REVIEW_NODE, target, opts);
}

const runReviewCli = reportNodeCli(REVIEW_NODE);

if (import.meta.main) {
  await runReviewCli();
}
