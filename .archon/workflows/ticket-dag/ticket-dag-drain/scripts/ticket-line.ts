/** The Ticket file's `Status:` line: its vocabulary, its two regexes, and the two Main commit messages that name a Status or a merge. */

export const STATUSES = [
  "BLOCKED",
  "READY",
  "RUNNING",
  "MERGING",
  "CONFLICT",
  "RESOLVING",
  "MERGED",
  "FAILED",
] as const;

export type Status = (typeof STATUSES)[number];

function isStatus(v: string): v is Status {
  return (STATUSES as readonly string[]).includes(v);
}

/** Read the Status line. Missing or unknown value reads as BLOCKED. */
export function parseStatus(body: string): Status {
  const raw = body.match(/^(?:\*\*)?Status\s*:(?:\*\*)?\s*(.+?)(?:\*\*)?\s*$/im)?.[1]?.trim();
  return raw && isStatus(raw) ? raw : "BLOCKED";
}

/** Rewrite the Status line in `body`, or append one when absent. */
export function statusLine(body: string, status: Status): string {
  return /^(?:\*\*)?Status\s*:(?:\*\*)?\s*.+$/im.test(body)
    ? body.replace(/^(?:\*\*)?Status\s*:(?:\*\*)?\s*.+$/im, `Status: ${status}`)
    : `${body.trimEnd()}\n\nStatus: ${status}\n`;
}

export function statusMessage(ticketId: string, status: Status): string {
  return `orchestrator: ${ticketId} Status ${status}`;
}

export function mergeMessage(branch: string): string {
  return `orchestrator: merge ${branch}`;
}
