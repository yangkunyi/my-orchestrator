import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import pino from "pino";
import { listRoleSessions } from "./agent.js";
import type { Ticket } from "./tickets.js";

export type RunMeta = {
  id: string;
  target: string;
  startedAt: string;
  pid: number | null;
  status: "running" | "exited";
  endedAt: string | null;
  exitCode: number | null;
};

export type DagSnapshot = {
  updatedAt: string;
  nodes: { id: string; status: string; blockedBy: string[] }[];
};

export type Journal = {
  id: string;
  dir: string;
  log(msg: string): void;
  snapshot(tickets: Ticket[]): void;
  setPid(pid: number): void;
  end(exitCode: number): void;
};

export function runsDir(target: string): string {
  return join(target, ".scratch", "orchestrator", "runs");
}

export function runDir(target: string, id: string): string {
  return join(runsDir(target), id);
}

// ponytail: kill 0 only; a crashed Run (status still running) plus pid reuse can look live.
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return Boolean(e && typeof e === "object" && "code" in e && e.code === "EPERM");
  }
}

function newId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  return `${stamp}-${randomBytes(2).toString("hex")}`;
}

function writeMeta(dir: string, meta: RunMeta): void {
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
}

function readMetaFile(dir: string): RunMeta | undefined {
  const p = join(dir, "meta.json");
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as RunMeta;
  } catch {
    return undefined;
  }
}

function bind(dir: string, meta: RunMeta): Journal {
  const dest = pino.destination({ dest: join(dir, "events.log"), sync: true, mkdir: true, append: true });
  const logger = pino({ base: {}, timestamp: pino.stdTimeFunctions.isoTime }, dest);
  return {
    id: meta.id,
    dir,
    log(msg: string) {
      console.log(msg);
      logger.info(msg);
    },
    snapshot(tickets: Ticket[]) {
      const dag: DagSnapshot = {
        updatedAt: new Date().toISOString(),
        nodes: tickets.map((t) => ({ id: t.id, status: t.status, blockedBy: t.blockedBy })),
      };
      writeFileSync(join(dir, "dag.json"), JSON.stringify(dag, null, 2) + "\n");
    },
    setPid(pid: number) {
      meta.pid = pid;
      writeFileSync(join(dir, "pid"), `${pid}\n`);
      writeMeta(dir, meta);
    },
    end(exitCode: number) {
      meta.status = "exited";
      meta.endedAt = new Date().toISOString();
      meta.exitCode = exitCode;
      writeMeta(dir, meta);
      dest.flushSync();
      dest.end();
    },
  };
}

export function createRun(target: string): Journal {
  const id = newId();
  const dir = runDir(target, id);
  mkdirSync(dir, { recursive: true });
  const meta: RunMeta = {
    id,
    target,
    startedAt: new Date().toISOString(),
    pid: null,
    status: "running",
    endedAt: null,
    exitCode: null,
  };
  writeMeta(dir, meta);
  return bind(dir, meta);
}

export function openRun(target: string, id: string): Journal {
  const dir = runDir(target, id);
  const meta = readMetaFile(dir);
  if (!meta) throw new Error(`run not found: ${id}`);
  return bind(dir, meta);
}

export function listRuns(target: string): RunMeta[] {
  const root = runsDir(target);
  if (!existsSync(root)) return [];
  const out: RunMeta[] = [];
  for (const ent of readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const meta = readMetaFile(join(root, ent.name));
    if (meta) out.push(meta);
  }
  out.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return out;
}

export function liveRuns(target: string): RunMeta[] {
  return listRuns(target).filter((r) => r.status === "running" && r.pid != null && pidAlive(r.pid));
}

export function assertNoLiveRun(target: string): void {
  const live = liveRuns(target);
  if (live.length === 0) return;
  throw new Error(
    `already running: ${live.map((r) => `${r.id} (pid ${r.pid})`).join(", ")}`,
  );
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
  const meta = readMetaFile(dir);
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
  const sessions = listSessionFiles(dir);
  out.push(sessions.length ? "sessions" : "sessions (none)");
  for (const s of sessions) out.push(`  ${s}`);
  out.push("");
  out.push(events.length ? `events (last ${events.length})` : "events (none)");
  for (const line of events) out.push(`  ${line}`);
  return out.join("\n");
}

function listSessionFiles(dir: string): string[] {
  return listRoleSessions(dir);
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
