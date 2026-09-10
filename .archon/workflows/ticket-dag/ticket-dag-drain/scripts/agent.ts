import type { PackConfig, Runner, ThinkingLevel } from "./config.ts";
import { roleSessionFile } from "./session-log.ts";

export type AgentRole = "implement" | "conflict" | "review" | "summary";

/** Implement/conflict wall clock, then session.abort(). */
export const AGENT_WALL_MS = 2 * 60 * 60 * 1000;

export type PackAgentOpts = {
  cwd: string;
  artifactsDir: string;
  /**
   * The key this role's session lives under: a Ticket id for the ticket nodes, the node's own name
   * for the drain-end readers (one per review axis, one for the summary).
   */
  sessionKey: string;
  role: AgentRole;
  model: string | undefined;
  thinkingLevel: ThinkingLevel;
  /** Which runtime to spend on this node. Defaults to pi; every node takes either one. */
  runner?: Runner;
  /**
   * The skill or contract this role runs under: dsh carries it as the whole system prompt, Pi folds
   * it into the message. Required, and the only place a node's read-only contract is stated for a
   * runner that cannot enforce it (see dsh-agent.ts).
   */
  persona: string;
  prompt: string;
  wallMs?: number;
};

/**
 * One turn's answer. Each runner reads its own product - Pi its session jsonl, dsh its event stream -
 * and reports what it found here, so a node reads one value and never parses another product's log.
 */
export type PackAnswer =
  /** The turn's final assistant text. */
  | { kind: "text"; text: string }
  /** The turn produced no assistant text at all: an abort, a crash, a turn that ended before it spoke. */
  | { kind: "none" };

export type PackAgentResult = {
  /**
   * Diagnostics, not the answer: where this turn's session lives, for a human and for the jsonl a
   * debugging operator reads. `answer` is the answer channel; never read a log back for it.
   */
  sessionFile: string;
  /** The turn's answer: the runner's own final text, or that it produced none. */
  answer: PackAnswer;
  /**
   * The runner's own report of what went wrong on this turn (a timeout, an abort, a nonzero exit).
   * The ticket nodes settle on it; a report node uses it as the reason a turn answered no text.
   */
  lastError: string | undefined;
};

/** One turn's answer from the text a runner read out of its own product. */
export function packAnswer(text: string | undefined): PackAnswer {
  return text === undefined ? { kind: "none" } : { kind: "text", text };
}

export type AgentRunner = (opts: PackAgentOpts) => Promise<PackAgentResult>;

export type TicketAgentOpts = {
  artifactsDir: string;
  config?: PackConfig;
  runAgent?: AgentRunner;
};

export function armSessionAbort(session: { abort: () => Promise<void> }, wallMs: number): () => void {
  const timer = setTimeout(() => {
    void session.abort();
  }, wallMs);
  timer.unref();
  return () => clearTimeout(timer);
}

export async function noopAgent(opts: PackAgentOpts): Promise<PackAgentResult> {
  return {
    sessionFile: roleSessionFile(opts.artifactsDir, opts.sessionKey, opts.role),
    answer: { kind: "none" },
    lastError: undefined,
  };
}

export async function defaultAgent(opts: PackAgentOpts): Promise<PackAgentResult> {
  if (opts.runner === "dsh") {
    const { dshAgent } = await import("./dsh-agent.ts");
    return dshAgent(opts);
  }
  const { runPackPi } = await import("./pi-session.ts");
  return runPackPi(opts);
}
