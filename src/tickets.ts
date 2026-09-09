import { readdirSync, readFileSync, existsSync } from "node:fs";
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

const WAYFINDER = new Set(["research", "prototype", "grilling", "task"]);
const IN_FLIGHT = new Set<Status>(["RUNNING", "MERGING", "CONFLICT", "RESOLVING"]);
const TERMINAL = new Set<Status>(["MERGED", "FAILED"]);

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

function parseField(body: string, name: string): string | undefined {
  const re = new RegExp(
    `^(?:\\*\\*)?${name}\\s*:(?:\\*\\*)?\\s*(.+?)(?:\\*\\*)?\\s*$`,
    "im",
  );
  const m = body.match(re);
  return m?.[1]?.trim();
}

function parseNnSlug(filename: string): { nn: string; slug: string } | undefined {
  const m = filename.match(/^(\d+)-(.+)\.md$/);
  if (!m) return undefined;
  return { nn: m[1], slug: m[2] };
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
      const statusRaw = parseField(body, "Status") ?? "BLOCKED";
      const status = STATUSES.includes(statusRaw as Status) ? (statusRaw as Status) : "BLOCKED";
      const { nn, slug } = parsed;
      const id = `${feature.name}/${nn}`;
      out.push({
        id,
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
  return ticket.blockedBy.every((id) => map.get(id)?.status === "MERGED");
}

export function startable(ticket: Ticket, map: Map<string, Ticket>): boolean {
  if (IN_FLIGHT.has(ticket.status) || TERMINAL.has(ticket.status)) return false;
  return blockersMerged(ticket, map);
}

export function leftoverInFlight(tickets: Ticket[]): Ticket[] {
  return tickets.filter((t) => IN_FLIGHT.has(t.status));
}

export { IN_FLIGHT, TERMINAL };
