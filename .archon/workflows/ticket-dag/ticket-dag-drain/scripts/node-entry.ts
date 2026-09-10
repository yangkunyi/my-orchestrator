import { reexecForProxy } from "./agent.ts";
import { loadConfig, type PackConfig } from "./config.ts";

export type NodeEnv = {
  target: string;
  ticketId: string;
  artifactsDir: string;
  config: PackConfig;
};

export type NodeOpts = {
  /** Require INPUTS_TICKET. */
  ticket?: boolean;
  /** Require ARTIFACTS_DIR. */
  artifacts?: boolean;
  /** Re-exec for NODE_USE_ENV_PROXY first. Only the nodes that can call Pi need it. */
  proxy?: boolean;
  run: (env: NodeEnv) => string | undefined | void | Promise<string | undefined | void>;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/**
 * The Script-node protocol the YAMLs match on: env in, one stdout token out.
 * A Git-contract outcome (including `failed`) exits 0; misconfiguration and thrown errors exit
 * non-zero. The handler's string result is written verbatim, so include your own trailing newline.
 */
export async function runNode(opts: NodeOpts): Promise<void> {
  if (opts.proxy) reexecForProxy();
  try {
    const target = process.cwd();
    const ticketId = opts.ticket ? requireEnv("INPUTS_TICKET") : "";
    const artifactsDir = opts.artifacts ? requireEnv("ARTIFACTS_DIR") : "";
    const config = loadConfig(target, process.env.INPUTS_CONFIG);
    const token = await opts.run({ target, ticketId, artifactsDir, config });
    if (typeof token === "string") process.stdout.write(token);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
