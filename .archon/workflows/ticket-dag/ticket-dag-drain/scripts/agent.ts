import type { PackConfig, ThinkingLevel } from "./config.ts";
import { ticketSessionFile } from "./session-log.ts";

export type AgentRole = "implement" | "conflict" | "review";

/** Implement/conflict wall clock, then session.abort(). */
export const AGENT_WALL_MS = 2 * 60 * 60 * 1000;

export type PackAgentOpts = {
  cwd: string;
  artifactsDir: string;
  ticketId: string;
  role: AgentRole;
  model: string | undefined;
  thinkingLevel: ThinkingLevel;
  prompt: string;
  tools?: string[];
  useBash?: boolean;
  wallMs?: number;
};

export type PackAgentResult = {
  sessionFile: string;
  lastError: string | undefined;
};

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
  return { sessionFile: ticketSessionFile(opts.artifactsDir, opts.ticketId, opts.role), lastError: undefined };
}

export async function defaultAgent(opts: PackAgentOpts): Promise<PackAgentResult> {
  const { runPackPi } = await import("./pi-session.ts");
  return runPackPi(opts);
}
