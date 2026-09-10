import { execFile as execFileCb } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { loadConfig } from "./config.ts";

const execFile = promisify(execFileCb);

const STATUSES = [
  "BLOCKED",
  "READY",
  "RUNNING",
  "MERGING",
  "CONFLICT",
  "RESOLVING",
  "MERGED",
  "FAILED",
] as const;

type Status = (typeof STATUSES)[number];

const WAYFINDER = new Set(["research", "prototype", "grilling", "task"]);
const IN_FLIGHT = new Set<Status>(["RUNNING", "MERGING", "CONFLICT", "RESOLVING"]);

type Ticket = {
  id: string;
  feature: string;
  nn: string;
  slug: string;
  relPath: string;
  absPath: string;
  status: Status;
  branch: string;
  worktreeRel: string;
};

async function git(
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFile("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true, stdout: (stdout ?? "").trim(), stderr: (stderr ?? "").trim() };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: (err.stdout ?? "").trim(),
      stderr: (err.stderr ?? err.message ?? "").trim(),
    };
  }
}

async function gitOrThrow(cwd: string, args: string[]): Promise<string> {
  const r = await git(cwd, args);
  if (!r.ok) throw new Error(`git ${args.join(" ")}\n${r.stderr || r.stdout}`);
  return r.stdout;
}

function parseField(body: string, name: string): string | undefined {
  const re = new RegExp(`^(?:\\*\\*)?${name}\\s*:(?:\\*\\*)?\\s*(.+?)(?:\\*\\*)?\\s*$`, "im");
  return body.match(re)?.[1]?.trim();
}

function parseNnSlug(filename: string): { nn: string; slug: string } | undefined {
  const m = filename.match(/^(\d+)-(.+)\.md$/);
  if (!m) return undefined;
  return { nn: m[1]!, slug: m[2]! };
}

function scanTickets(target: string): Ticket[] {
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
      out.push({
        id: `${feature.name}/${nn}`,
        feature: feature.name,
        nn,
        slug,
        relPath: `.scratch/${feature.name}/issues/${ent.name}`,
        absPath,
        status,
        branch: `ticket/${feature.name}/${nn}-${slug}`,
        worktreeRel: `worktrees/${feature.name}-${nn}-${slug}`,
      });
    }
  }
  return out;
}

function leftoverInFlight(tickets: Ticket[]): Ticket[] {
  return tickets.filter((t) => IN_FLIGHT.has(t.status));
}

function setStatusInFile(absPath: string, status: Status): void {
  const body = readFileSync(absPath, "utf8");
  const next = /^(?:\*\*)?Status\s*:(?:\*\*)?\s*.+$/im.test(body)
    ? body.replace(/^(?:\*\*)?Status\s*:(?:\*\*)?\s*.+$/im, `Status: ${status}`)
    : `${body.trimEnd()}\n\nStatus: ${status}\n`;
  writeFileSync(absPath, next);
}

async function stamp(target: string, ticket: Ticket, status: Status): Promise<void> {
  setStatusInFile(ticket.absPath, status);
  await gitOrThrow(target, ["add", ticket.relPath]);
  await gitOrThrow(target, ["commit", "-m", `orchestrator: ${ticket.id} Status ${status}`]);
  ticket.status = status;
}

/** True iff Main has that Ticket's --no-ff merge commit (message + second parent on the branch). */
async function hasTicketMergeCommit(target: string, branch: string): Promise<boolean> {
  const log = await git(target, ["log", "--format=%P%x00%s", "HEAD"]);
  if (!log.ok || !log.stdout) return false;
  for (const line of log.stdout.split("\n")) {
    const nul = line.indexOf("\0");
    if (nul < 0) continue;
    const parents = line.slice(0, nul).split(" ").filter(Boolean);
    const subject = line.slice(nul + 1);
    if (parents.length < 2) continue;
    if (subject !== `orchestrator: merge ${branch}`) continue;
    const p2 = parents[1]!;
    const onBranch = await git(target, ["merge-base", "--is-ancestor", p2, branch]);
    if (onBranch.ok) return true;
  }
  return false;
}

async function removeWorktreeAndBranch(target: string, ticket: Ticket): Promise<void> {
  await git(target, ["worktree", "remove", "--force", join(target, ticket.worktreeRel)]);
  await git(target, ["branch", "-D", ticket.branch]);
}

export async function rematchLeftovers(target: string): Promise<void> {
  for (const ticket of leftoverInFlight(scanTickets(target))) {
    if (await hasTicketMergeCommit(target, ticket.branch)) {
      await stamp(target, ticket, "MERGED");
      await removeWorktreeAndBranch(target, ticket);
    } else {
      await stamp(target, ticket, "FAILED");
    }
  }
}

if (import.meta.main) {
  const target = process.cwd();
  loadConfig(target, process.env.INPUTS_CONFIG);
  await rematchLeftovers(target);
}
