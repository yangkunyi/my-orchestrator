/**
 * Pi's session file: where this pack tells Pi to keep one role's session, and how Pi's own jsonl
 * reads back. The reader below knows Pi's row shape and only pi-session.ts uses it - dsh keeps its
 * log where its harness does and reports that path instead. The session file is diagnostics; the
 * answer travels on PackAgentResult.answer.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRole } from "./agent.ts";

/** Where one role's session for one session key lives: artifacts/sessions/<key>/<role>.jsonl. */
export function roleSessionFile(artifactsDir: string, sessionKey: string, role: AgentRole): string {
  return join(artifactsDir, "sessions", sessionKey, `${role}.jsonl`);
}

/**
 * A part counts only when its own type is "text": a text key alone is not evidence. dsh's reasoning
 * parts do carry one (that is how thinking once leaked into a report), and this reader must apply the
 * same rule as dsh's answerText even though Pi's own parts happen to obey it - measured over 344 real
 * Pi session files, every part carrying a text key had type "text".
 */
function contentText(content: unknown): string | undefined {
  if (typeof content === "string" && content.trim()) return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") parts.push(part);
    else if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
      const text = (part as { text: unknown }).text;
      if (typeof text === "string" && text) parts.push(text);
    }
  }
  const joined = parts.join("").trim();
  return joined.length > 0 ? joined : undefined;
}

type Row = {
  type?: unknown;
  message?: { role?: unknown; content?: unknown; errorMessage?: unknown };
};

/**
 * One pass over Pi's session jsonl: the last assistant text Pi wrote and the last errorMessage. Both
 * are values, not throws: a missing or half-written file reads as absence.
 */
export function readPiSession(sessionFile: string): { text: string | undefined; error: string | undefined } {
  if (!existsSync(sessionFile)) return { text: undefined, error: undefined };
  let text: string | undefined;
  let error: string | undefined;
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    if (!line) continue;
    let row: Row | null;
    try {
      row = JSON.parse(line) as Row | null;
    } catch {
      continue; /* skip bad line */
    }
    // ponytail: optional chaining, not a try/catch - a JSON line that is not an object must skip,
    // the way the old per-reader try/catch did.
    const type = row?.type;
    const msg = row?.message;
    if (typeof msg?.errorMessage === "string" && msg.errorMessage.length > 0) error = msg.errorMessage;
    if (type && type !== "message") continue;
    if (msg?.role !== "assistant") continue;
    const found = contentText(msg.content);
    if (found) text = found;
  }
  return { text, error };
}
