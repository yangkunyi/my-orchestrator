import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createAgentSession,
  ModelRuntime,
  resolveCliModel,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "./config.js";

export type AgentRole = "implement" | "conflict";

export function ticketSessionFile(runDir: string, ticketId: string, role: AgentRole): string {
  return join(runDir, "sessions", ticketId, `${role}.jsonl`);
}

/** Open a Pi session file under the Run dir. Empty file is initialized by SessionManager.open. */
export function openTicketSession(
  cwd: string,
  runDir: string,
  ticketId: string,
  role: AgentRole,
): SessionManager {
  const file = ticketSessionFile(runDir, ticketId, role);
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, "");
  return SessionManager.open(file, dirname(file), cwd);
}

export type PiResult = { sessionFile: string; lastError: string | undefined };

export async function runPi(opts: {
  cwd: string;
  runDir: string;
  ticketId: string;
  role: AgentRole;
  model: string | undefined;
  thinkingLevel: ThinkingLevel;
  prompt: string;
}): Promise<PiResult> {
  const sessionManager = openTicketSession(opts.cwd, opts.runDir, opts.ticketId, opts.role);
  sessionManager.appendSessionInfo(`${opts.ticketId} ${opts.role}`);
  const modelRuntime = await ModelRuntime.create();
  let model = undefined;
  if (opts.model) {
    const resolved = resolveCliModel({
      cliModel: opts.model,
      cliThinking: opts.thinkingLevel,
      modelRuntime,
    });
    if (resolved.error || !resolved.model) {
      throw new Error(resolved.error ?? `unknown model ${opts.model}`);
    }
    model = resolved.model;
  }
  const { session } = await createAgentSession({
    cwd: opts.cwd,
    model,
    thinkingLevel: opts.thinkingLevel,
    modelRuntime,
    sessionManager,
  });
  try {
    await session.prompt(opts.prompt);
  } finally {
    session.dispose();
  }
  const sessionFile = sessionManager.getSessionFile() ?? ticketSessionFile(opts.runDir, opts.ticketId, opts.role);
  return { sessionFile, lastError: lastAssistantError(sessionFile) };
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

/** Role session files only: `multi-user/10/implement.jsonl` relative to sessions/. No nested subagent jsonl. */
export function listRoleSessions(runDir: string): string[] {
  const root = join(runDir, "sessions");
  if (!existsSync(root)) return [];
  const out: string[] = [];
  walkRoleSessions(root, "", out);
  out.sort();
  return out;
}

function walkRoleSessions(dir: string, rel: string, out: string[]): void {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) walkRoleSessions(join(dir, ent.name), r, out);
    else if (ent.name === "implement.jsonl" || ent.name === "conflict.jsonl") out.push(r);
  }
}

export function implementPrompt(ticketRelPath: string): string {
  return `/skill:implement ${ticketRelPath}\nThis ticket is not done. Implement the acceptance criteria in this worktree and commit the product-code changes on the current branch before exiting. Leave the ticket Status line unchanged.\n`;
}

export function conflictPrompt(ticketRelPath: string): string {
  return `/skill:resolving-merge-conflicts ${ticketRelPath}\n`;
}
