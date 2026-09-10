import { spawnSync } from "node:child_process";

/** NODE_USE_ENV_PROXY must be set at process start. Does not copy httpProxy from YAML. */
export function proxyEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, NODE_USE_ENV_PROXY: "1" };
}

export function reexecForProxy(): void {
  if (process.env.NODE_USE_ENV_PROXY === "1") return;
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    env: proxyEnv(),
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}
