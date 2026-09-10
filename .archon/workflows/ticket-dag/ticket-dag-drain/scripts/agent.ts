import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PackConfig, ThinkingLevel } from "./config.ts";
import { STATUSES } from "./ticket-line.ts";

export type AgentRole = "implement" | "conflict" | "review";

/** Implement/conflict wall clock, then session.abort(). */
export const AGENT_WALL_MS = 2 * 60 * 60 * 1000;

/** The Status vocabulary as the prompts spell it. */
const STATUS_VALUES = STATUSES.map((s) => `\`${s}\``).join(" / ");

const IMPLEMENT_SKILL = `Implement the work described by the user in the spec or tickets.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Commit your work to the current branch.

Leave the ticket file's \`Status:\` line unchanged (${STATUS_VALUES}). Those values are owned by \`/to-tickets\` and the Orchestrator, not by implement.`;

const CONFLICT_SKILL = `1. **See the current state** of the merge/rebase. Check git history, and the conflicting files.

2. **Find the primary sources** for each conflict. Understand deeply why each change was made, and what the original intent was. Read the commit messages, check the PRs, check original issues/tickets.

3. **Resolve each hunk.** Preserve both intents where possible. Where incompatible, pick the one matching the merge's stated goal and note the trade-off. Do **not** invent new behaviour. Always resolve; never \`--abort\`.

4. Discover the project's **automated checks** and run them — typically typecheck, then tests, then format. Fix anything the merge broke.

5. **Finish the merge/rebase.** Stage everything and commit. If rebasing, continue the rebase process until all commits are rebased.

Leave the ticket file's \`Status:\` line unchanged (${STATUS_VALUES}). Those values are owned by \`/to-tickets\` and the Orchestrator, not by conflict resolution.`;

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

export function ticketSessionFile(artifactsDir: string, ticketId: string, role: AgentRole): string {
  return join(artifactsDir, "sessions", ticketId, `${role}.jsonl`);
}

export function implementPrompt(ticketRelPath: string): string {
  return `${IMPLEMENT_SKILL}\n\n${ticketRelPath}\nThis ticket is not done. Implement the acceptance criteria in this worktree and commit the product-code changes on the current branch before exiting. Leave the ticket Status line unchanged.\n`;
}

export function conflictPrompt(ticketRelPath: string): string {
  return `${CONFLICT_SKILL}\n\n${ticketRelPath}\n`;
}

export function lastAssistantError(sessionFile: string): string | undefined {
  if (!existsSync(sessionFile)) return undefined;
  let last: string | undefined;
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const row = JSON.parse(line) as { message?: { errorMessage?: unknown } };
      const msg = row.message?.errorMessage;
      if (typeof msg === "string" && msg.length > 0) last = msg;
    } catch {
      /* skip bad line */
    }
  }
  return last;
}

function contentText(content: unknown): string | undefined {
  if (typeof content === "string" && content.trim()) return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") parts.push(part);
    else if (part && typeof part === "object" && "text" in part) {
      const text = (part as { text: unknown }).text;
      if (typeof text === "string" && text) parts.push(text);
    }
  }
  const joined = parts.join("").trim();
  return joined.length > 0 ? joined : undefined;
}

export function lastAssistantText(sessionFile: string): string | undefined {
  if (!existsSync(sessionFile)) return undefined;
  let last: string | undefined;
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const row = JSON.parse(line) as { type?: string; message?: { role?: string; content?: unknown } };
      if (row.type && row.type !== "message") continue;
      const msg = row.message;
      if (!msg || msg.role !== "assistant") continue;
      const text = contentText(msg.content);
      if (text) last = text;
    } catch {
      /* skip bad line */
    }
  }
  return last;
}

/** NODE_USE_ENV_PROXY must be set at process start. Does not copy httpProxy from YAML. */
export function proxyEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, NODE_USE_ENV_PROXY: "1" };
}

export function reexecForProxy(): void {
  if (process.env.NODE_USE_ENV_PROXY === "1") return;
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    env: proxyEnv(),
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}

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
