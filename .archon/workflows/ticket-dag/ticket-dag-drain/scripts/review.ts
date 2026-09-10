import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultAgent, type AgentRunner, type TicketAgentOpts } from "./agent.ts";
import { loadConfig } from "./config.ts";
import { git, gitOrThrow } from "./git.ts";
import { runNode } from "./node-entry.ts";
import { reviewPersona, reviewTask, REVIEW_AXES } from "./prompt.ts";
import { lastAssistantText } from "./session-log.ts";

export const REVIEW_BASE_REL = "review-base";
export const REVIEW_MD_REL = "review.md";
export const REVIEW_WALL_MS = 30 * 60 * 1000;
/** Bash is in there so a reviewer can read git history; the contract, not the allowlist, is read-only. */
export const REVIEW_TOOLS = ["read", "grep", "find", "ls", "bash"];

export async function writeReviewBase(target: string, artifactsDir: string): Promise<string> {
  mkdirSync(artifactsDir, { recursive: true });
  const sha = await gitOrThrow(target, ["rev-parse", "HEAD"]);
  writeFileSync(join(artifactsDir, REVIEW_BASE_REL), `${sha}\n`);
  return sha;
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
  // Reviewers fetch the range themselves, so bun only probes it: an empty range still skips before any
  // agent is spent, and a base git cannot read is still a bun-side error rather than three confused
  // reviewers. Nothing is pasted into the prompt - the diff used to be capped and handed over.
  const probe = await git(target, ["diff", "--stat", `${base}...HEAD`]);
  if (!probe.ok) {
    writeFileSync(outFile, `review error: git diff ${probe.stderr || probe.stdout}\n`);
    return;
  }
  if (!probe.stdout.trim()) {
    // The `skip:` prefix is the contract summary.ts matches on; an empty range is a skip, not a report.
    writeFileSync(outFile, `skip: empty diff ${base}...HEAD, skipped\n`);
    return;
  }
  const headR = await git(target, ["rev-parse", "HEAD"]);
  if (!headR.ok) {
    writeFileSync(outFile, `review error: git rev-parse ${headR.stderr || headR.stdout}\n`);
    return;
  }
  const head = headR.stdout.trim();
  const logR = await git(target, ["log", `${base}..HEAD`, "--oneline"]);
  const config = opts.config ?? loadConfig(target);
  const runAgent: AgentRunner = opts.runAgent ?? defaultAgent;
  const sections = await Promise.all(
    REVIEW_AXES.map(async (axis, i) => {
      const title = `${i + 1}. ${axis}`;
      try {
        const r = await runAgent({
          cwd: target,
          artifactsDir: opts.artifactsDir,
          ticketId: `drain-review-${i + 1}`,
          role: "review",
          model: config.model,
          thinkingLevel: config.thinkingLevel,
          runner: config.runner,
          persona: reviewPersona(base, axis),
          prompt: reviewTask(base, head, logR.ok ? logR.stdout : ""),
          tools: REVIEW_TOOLS,
          useBash: true,
          wallMs: REVIEW_WALL_MS,
        });
        // The runner's own final message first: reading it back out of a session log is the fallback for
        // a runner that does not hand one over (Pi writes its turn into the file it already owns).
        const text = r.text ?? lastAssistantText(r.sessionFile) ?? r.lastError ?? "(no review text)";
        return { title, body: text.trim() };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { title, body: `review error: ${msg}` };
      }
    }),
  );
  writeFileSync(outFile, sections.map((s) => `## ${s.title}\n\n${s.body}\n`).join("\n"));
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
