import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listRoleSessions } from "./agent.js";
import { listRuns, liveRuns, pidAlive, runDir, type DagSnapshot, type RunMeta } from "./journal.js";

function readMeta(dir: string): RunMeta | undefined {
  const p = join(dir, "meta.json");
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as RunMeta;
  } catch {
    return undefined;
  }
}

function runState(meta: RunMeta): string {
  if (meta.status === "running" && meta.pid != null && pidAlive(meta.pid)) {
    return `running  pid ${meta.pid}`;
  }
  if (meta.status === "running") return `stale  pid ${meta.pid ?? "-"} (not running)`;
  const code = meta.exitCode == null ? "" : `  exit ${meta.exitCode}`;
  return `exited${code}`;
}

export function formatRunList(target: string): string {
  const runs = listRuns(target);
  if (runs.length === 0) return "no runs";
  const live = new Set(liveRuns(target).map((r) => r.id));
  const lines = runs.map((r) => {
    const mark = live.has(r.id) ? "* " : "  ";
    return `${mark}${r.id}  ${runState(r)}`;
  });
  if (live.size === 0) lines.unshift("none running");
  return lines.join("\n");
}

function readDag(dir: string): DagSnapshot | undefined {
  const p = join(dir, "dag.json");
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as DagSnapshot;
  } catch {
    return undefined;
  }
}

function formatEventLine(line: string): string {
  try {
    const rec = JSON.parse(line) as { time?: unknown; msg?: unknown };
    if (typeof rec.msg === "string") {
      const t =
        typeof rec.time === "string"
          ? rec.time
          : typeof rec.time === "number"
            ? new Date(rec.time).toISOString()
            : "";
      return t ? `${t} ${rec.msg}` : rec.msg;
    }
  } catch {
    /* raw line */
  }
  return line;
}

function tailEvents(dir: string, n: number): string[] {
  const p = join(dir, "events.log");
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split("\n").filter((l) => l.length > 0);
  return lines.slice(-n).map(formatEventLine);
}

export function formatInspect(target: string, id: string): string {
  const dir = runDir(target, id);
  const meta = readMeta(dir);
  if (!meta) throw new Error(`run not found: ${id}`);
  const dag = readDag(dir);
  const events = tailEvents(dir, 100);
  const out: string[] = [];
  out.push(`run ${meta.id}  ${runState(meta)}`);
  out.push(`target ${meta.target}`);
  out.push(`started ${meta.startedAt}`);
  if (meta.endedAt) out.push(`ended ${meta.endedAt}`);
  out.push("");
  if (!dag) {
    out.push("DAG (no snapshot yet)");
  } else {
    out.push(`DAG (snapshot ${dag.updatedAt})`);
    if (dag.nodes.length === 0) out.push("  (no tickets)");
    for (const n of dag.nodes) {
      const dep = n.blockedBy.length ? `  blocked by ${n.blockedBy.join(", ")}` : "";
      out.push(`  ${n.id}  ${n.status}${dep}`);
    }
  }
  out.push("");
  const sessions = listRoleSessions(dir);
  out.push(sessions.length ? "sessions" : "sessions (none)");
  for (const s of sessions) out.push(`  ${s}`);
  out.push("");
  out.push(events.length ? `events (last ${events.length})` : "events (none)");
  for (const line of events) out.push(`  ${line}`);
  return out.join("\n");
}

export function inspectText(target: string, id: string | undefined): string {
  if (id) return formatInspect(target, id);
  const live = liveRuns(target);
  if (live.length === 1) {
    const current = live[0];
    if (current) return formatInspect(target, current.id);
  }
  return formatRunList(target);
}
