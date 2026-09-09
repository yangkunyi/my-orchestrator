import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/** Env for a process that will call Pi. Node fetch ignores HTTP_PROXY unless NODE_USE_ENV_PROXY is set at start. */
export function childEnv(opts: {
  httpProxy: string | undefined;
  target: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_USE_ENV_PROXY: "1" };
  if (opts.httpProxy) {
    env.HTTP_PROXY = opts.httpProxy;
    env.HTTPS_PROXY = opts.httpProxy;
    env.http_proxy = opts.httpProxy;
    env.https_proxy = opts.httpProxy;
  }
  const venvBin = join(opts.target, ".venv", "bin");
  if (existsSync(venvBin)) {
    env.PATH = `${venvBin}${delimiter}${env.PATH ?? ""}`;
  }
  return env;
}

/** Detached Run child. Caller writes pid / unref / journal. */
export function spawnDetachedRun(opts: {
  execPath: string;
  script: string;
  args: string[];
  httpProxy: string | undefined;
  target: string;
  stdoutFd: number;
}): ChildProcess {
  return spawn(opts.execPath, [opts.script, ...opts.args], {
    detached: true,
    stdio: ["ignore", opts.stdoutFd, opts.stdoutFd],
    env: childEnv(opts),
  });
}

/**
 * If this process is not yet a Pi-capable Run process, re-exec with childEnv and never return.
 * Skip when already NODE_USE_ENV_PROXY=1 (the --run-id child).
 */
export function reexecForProxy(opts: {
  execPath: string;
  argvSlice1: string[]; // process.argv.slice(1)
  httpProxy: string | undefined;
  target: string;
}): void {
  if (process.env.NODE_USE_ENV_PROXY === "1") return;
  const r = spawnSync(opts.execPath, opts.argvSlice1, {
    env: childEnv(opts),
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}
