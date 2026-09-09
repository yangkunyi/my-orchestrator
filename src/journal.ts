import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import pino from "pino";
import { loadConfig } from "./config.js";
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

export function readMetaFile(dir: string): RunMeta | undefined {
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

/** Env for a process that will call Pi. Node fetch ignores HTTP_PROXY unless NODE_USE_ENV_PROXY is set at start. */
export function childEnv(opts: { httpProxy: string | undefined }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_USE_ENV_PROXY: "1" };
  if (opts.httpProxy) {
    env.HTTP_PROXY = opts.httpProxy;
    env.HTTPS_PROXY = opts.httpProxy;
    env.http_proxy = opts.httpProxy;
    env.https_proxy = opts.httpProxy;
  }
  return env;
}

export function spawnDetachedRun(opts: {
  execPath: string;
  script: string;
  args: string[];
  httpProxy: string | undefined;
  stdoutFd: number;
}): ChildProcess {
  return spawn(opts.execPath, [opts.script, ...opts.args], {
    detached: true,
    stdio: ["ignore", opts.stdoutFd, opts.stdoutFd],
    env: childEnv({ httpProxy: opts.httpProxy }),
  });
}

export function reexecForProxy(opts: {
  execPath: string;
  argvSlice1: string[];
  httpProxy: string | undefined;
}): void {
  if (process.env.NODE_USE_ENV_PROXY === "1") return;
  const r = spawnSync(opts.execPath, opts.argvSlice1, {
    env: childEnv({ httpProxy: opts.httpProxy }),
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}

function childArgs(argv: string[], runId: string): string[] {
  const out: string[] = [];
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--detach") continue;
    if (rest[i] === "--run-id") {
      i++;
      continue;
    }
    out.push(rest[i]!);
  }
  out.push("--run-id", runId);
  return out;
}

function detach(journal: Journal, argv: string[], httpProxy: string | undefined): void {
  const logFile = join(journal.dir, "stdout.log");
  const fd = openSync(logFile, "a");
  const child = spawnDetachedRun({
    execPath: process.execPath,
    script: argv[1]!,
    args: childArgs(argv, journal.id),
    httpProxy,
    stdoutFd: fd,
  });
  closeSync(fd);
  if (child.pid == null) {
    journal.end(1);
    throw new Error("detach spawn produced no pid");
  }
  journal.setPid(child.pid);
  journal.log(`detached pid ${child.pid}`);
  child.unref();
}

export async function startRun(
  target: string,
  flags: {
    detach?: boolean;
    model?: string;
    thinkingLevel?: string;
    concurrency?: string | number;
    runId?: string;
  },
): Promise<void> {
  if (flags.detach && flags.runId) {
    console.error("cannot combine --detach and --run-id");
    process.exit(2);
  }
  const concurrency =
    flags.concurrency === undefined || flags.concurrency === ""
      ? undefined
      : Number(flags.concurrency);
  const config = loadConfig(target, {
    model: flags.model,
    thinkingLevel: flags.thinkingLevel,
    concurrency,
  });
  if (!flags.detach && !flags.runId) {
    reexecForProxy({
      execPath: process.execPath,
      argvSlice1: process.argv.slice(1),
      httpProxy: config.httpProxy,
    });
  }
  // ponytail: static import of run.ts would pull Pi into inspect.
  const { run } = await import("./run.js");
  let journal: Journal | undefined;
  try {
    if (flags.runId) {
      journal = openRun(target, flags.runId);
    } else {
      assertNoLiveRun(target);
      journal = createRun(target);
    }
    journal.setPid(process.pid);
    if (flags.detach) {
      detach(journal, process.argv, config.httpProxy);
      console.log(`run ${journal.id} detached`);
      return;
    }
    console.log(`run ${journal.id}`);
    journal.log("run start");
    await run(target, config, journal);
    journal.end(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      journal?.log(msg);
      journal?.end(1);
    } catch {
      /* ignore */
    }
    console.error(msg);
    process.exit(1);
  }
}
