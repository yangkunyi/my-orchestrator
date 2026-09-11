/**
 * The Ticket: its `Status:` line's vocabulary and format, what each Status means to the drain, and the
 * record itself. The classification is the one map of the vocabulary - a Status with no class does not
 * compile, so a new value in STATUSES forces its meaning to be decided here, beside the names.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

/** The Main commit subject that names a Status transition; the CLI writes the same string. */
export function statusMessage(ticketId: string, status: Status): string {
  return `orchestrator: ${ticketId} Status ${status}`;
}

/** The Main commit subject that names a merge; hasTicketMergeCommit matches it. */
export function mergeMessage(branch: string): string {
  return `orchestrator: merge ${branch}`;
}

/**
 * What one Status means to the drain, and the only partition of the vocabulary: BLOCKED waits on its
 * blockers, "startable" is admitted to a drain (READY is new work, FAILED is the retry), "in-flight" is
 * what a leftover pass recovers, and MERGED is terminal. The Record is exhaustive over Status, so a
 * Status that is neither in flight nor startable by accident cannot happen - it cannot be left out.
 */
export type StatusClass = "blocked" | "startable" | "in-flight" | "merged";

const STATUS_CLASS: Record<Status, StatusClass> = {
  BLOCKED: "blocked",
  READY: "startable",
  RUNNING: "in-flight",
  MERGING: "in-flight",
  CONFLICT: "in-flight",
  RESOLVING: "in-flight",
  MERGED: "merged",
  FAILED: "startable",
};

export function statusClass(status: Status): StatusClass {
  return STATUS_CLASS[status];
}

export function isBlocked(status: Status): boolean {
  return statusClass(status) === "blocked";
}

export function isStartable(status: Status): boolean {
  return statusClass(status) === "startable";
}

export function isInFlight(status: Status): boolean {
  return statusClass(status) === "in-flight";
}

export function isMerged(status: Status): boolean {
  return statusClass(status) === "merged";
}

export type Ticket = {
  id: string;
  feature: string;
  nn: string;
  slug: string;
  relPath: string;
  absPath: string;
  status: Status;
  blockedBy: string[];
  branch: string;
  worktreeRel: string;
};

const WAYFINDER = new Set(["research", "prototype", "grilling", "task"]);

function parseField(body: string, name: string): string | undefined {
  const re = new RegExp(`^(?:\\*\\*)?${name}\\s*:(?:\\*\\*)?\\s*(.+?)(?:\\*\\*)?\\s*$`, "im");
  return body.match(re)?.[1]?.trim();
}

function parseNnSlug(filename: string): { nn: string; slug: string } | undefined {
  const m = filename.match(/^(\d+)-(.+)\.md$/);
  if (!m) return undefined;
  return { nn: m[1]!, slug: m[2]! };
}

function parseBlockedBy(raw: string | undefined, feature: string): string[] {
  if (!raw) return [];
  const lower = raw.toLowerCase();
  if (lower.startsWith("none")) return [];
  return raw
    .split(",")
    .map((s) => s.trim().replace(/^`|`$/g, "").replace(/\.+$/, ""))
    .filter(Boolean)
    .filter((s) => !/^none\b/i.test(s))
    .map((s) => (s.includes("/") ? s : `${feature}/${s.replace(/-.*$/, "")}`));
}

export function scanTickets(target: string): Ticket[] {
  const scratch = join(target, ".scratch");
  if (!existsSync(scratch)) return [];
  const out: Ticket[] = [];
  for (const feature of readdirSync(scratch, { withFileTypes: true })) {
    if (!feature.isDirectory()) continue;
    const issuesDir = join(scratch, feature.name, "issues");
    if (!existsSync(issuesDir)) continue;
    for (const ent of readdirSync(issuesDir, { withFileTypes: true })) {
      if (!ent.isFile() || !ent.name.endsWith(".md")) continue;
      const parsed = parseNnSlug(ent.name);
      if (!parsed) continue;
      const absPath = join(issuesDir, ent.name);
      const body = readFileSync(absPath, "utf8");
      const type = parseField(body, "Type");
      if (type && WAYFINDER.has(type.toLowerCase())) continue;
      const status = parseStatus(body);
      const { nn, slug } = parsed;
      out.push({
        id: `${feature.name}/${nn}`,
        feature: feature.name,
        nn,
        slug,
        relPath: `.scratch/${feature.name}/issues/${ent.name}`,
        absPath,
        status,
        blockedBy: parseBlockedBy(parseField(body, "Blocked by"), feature.name),
        branch: `ticket/${feature.name}/${nn}-${slug}`,
        worktreeRel: `worktrees/${feature.name}-${nn}-${slug}`,
      });
    }
  }
  return out;
}

export function byId(tickets: Ticket[]): Map<string, Ticket> {
  return new Map(tickets.map((t) => [t.id, t]));
}

export function blockersMerged(ticket: Ticket, map: Map<string, Ticket>): boolean {
  return ticket.blockedBy.every((id) => {
    const blocker = map.get(id);
    return blocker !== undefined && isMerged(blocker.status);
  });
}

export function leftoverInFlight(tickets: Ticket[]): Ticket[] {
  return tickets.filter((t) => isInFlight(t.status));
}
