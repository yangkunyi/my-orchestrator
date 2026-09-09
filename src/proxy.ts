import { spawn, spawnSync, type ChildProcess } from "node:child_process";

/** Env for a process that will call Pi. Node fetch ignores HTTP_PROXY unless NODE_USE_ENV_PROXY is set at start. */
export function childEnv(httpProxy: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_USE_ENV_PROXY: "1" };
  if (httpProxy) {
    env.HTTP_PROXY = httpProxy;
    env.HTTPS_PROXY = httpProxy;
    env.http_proxy = httpProxy;
    env.https_proxy = httpProxy;
  }
  return env;
}

/** Detached Run child. Caller writes pid / unref / journal. */
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
    env: childEnv(opts.httpProxy),
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
}): void {
  if (process.env.NODE_USE_ENV_PROXY === "1") return;
  const r = spawnSync(opts.execPath, opts.argvSlice1, {
    env: childEnv(opts.httpProxy),
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}
