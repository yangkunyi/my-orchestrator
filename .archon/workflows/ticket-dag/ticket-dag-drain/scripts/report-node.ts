/**
 * The skeleton both drain-end report nodes run: read review-base and stop with the owner's skip line
 * when it is not there, let the node read its own input, read HEAD and the range's commit menu, run
 * the node's agents and take each answer off the runner (else its session log, else its last error),
 * write the artifact, and turn a throw from the report into the node's own error line.
 *
 * Review and summary were two copies of those six steps, differing only in the shape they produce
 * (one reviewer per axis, one summariser over review.md) and in the word their error line starts
 * with. A node states those two differences and nothing else, so a fourth report node is a shape
 * rather than another copy.
 */
import { join } from "node:path";
import { defaultAgent, type AgentRole, type AgentRunner, type TicketAgentOpts } from "./agent.ts";
import { loadConfig, type PackConfig } from "./config.ts";
import { git } from "./git.ts";
import { runNode } from "./node-entry.ts";
import { readReviewBase, writeArtifact } from "./review-artifacts.ts";
import { roleAgent, type RoleShape } from "./roles.ts";
import { lastAssistantText } from "./session-log.ts";

/** One agent a node asks for: the role and its own arguments, the message, and the empty-answer text. */
export type ReportAsk<R extends AgentRole> = {
  role: R;
  args: RoleShape[R];
  prompt: string;
  /** What a runner that hands over no message, no session log and no last error leaves behind. */
  fallback: string;
};

/** What a node's report step is handed once the range is readable. */
export type ReportRange = {
  target: string;
  artifactsDir: string;
  config: PackConfig;
  base: string;
  /** The range's end. */
  head: string;
  /** The range's commit menu: "" when git could not read it, which the personas take as "(none)". */
  log: string;
  /**
   * The one way a node runs an agent: builds the role's opts (session key, persona, tools, bash need
   * and wall clock all come from roles.ts), runs it, and takes the answer - the runner's own final
   * message, else its session log, else its last error, else the caller's fallback.
   */
  ask: <R extends AgentRole>(call: ReportAsk<R>) => Promise<string>;
};

/** What a node's own read gets: where it runs, and the base it reports on. */
export type ReportInput = Pick<ReportRange, "target" | "artifactsDir" | "base">;

/**
 * What a node's own read answers: the line to write and stop with (a skip or the node's own range
 * error, and no agent is spent), or the step that produces the artifact.
 */
export type ReportPrep = { stop: string } | { report: (range: ReportRange) => Promise<string> };

/**
 * One drain-end report node: the artifact it writes, how its failure line reads, and its own read of
 * its input. The order of the steps, the skip short-circuits, the answer channel and the error-line
 * handling are not a node's business.
 */
export type ReportNode = {
  /** The artifact the node writes, relative to ARTIFACTS_DIR (review.md / summary.md). */
  rel: string;
  /** The node's failure line for a detail the skeleton found: reviewErrorLine, `summary error: ...`. */
  errorLine: (detail: string) => string;
  /**
   * The node's own first step. A line to stop with is written as the whole artifact; the report step
   * runs only for a range git can read.
   */
  read: (input: ReportInput) => Promise<ReportPrep> | ReportPrep;
};

/** Run one report node end to end: the ordering, the skips and the error handling live here. */
export async function runReportNode(
  node: ReportNode,
  target: string,
  opts: TicketAgentOpts,
): Promise<void> {
  const outFile = join(opts.artifactsDir, node.rel);
  const baseR = readReviewBase(opts.artifactsDir);
  if ("skip" in baseR) {
    writeArtifact(outFile, baseR.skip);
    return;
  }
  const read = await node.read({ target, artifactsDir: opts.artifactsDir, base: baseR.base });
  if ("stop" in read) {
    writeArtifact(outFile, read.stop);
    return;
  }
  const headR = await git(target, ["rev-parse", "HEAD"]);
  if (!headR.ok) {
    writeArtifact(outFile, node.errorLine(`git rev-parse ${headR.stderr || headR.stdout}`));
    return;
  }
  const logR = await git(target, ["log", `${baseR.base}..HEAD`, "--oneline"]);
  const config = opts.config ?? loadConfig(target);
  const runAgent: AgentRunner = opts.runAgent ?? defaultAgent;
  const ask = async <R extends AgentRole>({
    role,
    args,
    prompt,
    fallback,
  }: ReportAsk<R>): Promise<string> => {
    const agent = roleAgent({ role, args, cwd: target, artifactsDir: opts.artifactsDir, config, prompt });
    const r = await runAgent(agent.opts);
    // The runner's own final message first: reading it back out of a session log is the fallback for
    // a runner that does not hand one over.
    return r.text ?? lastAssistantText(r.sessionFile) ?? r.lastError ?? fallback;
  };
  const range: ReportRange = {
    target,
    artifactsDir: opts.artifactsDir,
    config,
    base: baseR.base,
    head: headR.stdout.trim(),
    log: logR.ok ? logR.stdout : "",
    ask,
  };
  let body: string;
  try {
    body = await read.report(range);
  } catch (e) {
    body = node.errorLine(e instanceof Error ? e.message : String(e));
  }
  writeArtifact(outFile, body);
}

/** The node's Script-node entry: the env in, one report out. Every report node ends this way. */
export function reportNodeCli(node: ReportNode): () => Promise<void> {
  return async () => {
    await runNode({
      artifacts: true,
      proxy: true,
      run: ({ target, artifactsDir, config }) => runReportNode(node, target, { artifactsDir, config }),
    });
  };
}
