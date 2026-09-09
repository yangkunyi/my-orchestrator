import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export type Config = {
  model: string | undefined;
  thinkingLevel: ThinkingLevel;
  concurrency: number;
  httpProxy: string | undefined;
};

const DEFAULTS: Config = {
  model: undefined,
  thinkingLevel: "high",
  concurrency: 4,
  httpProxy: undefined,
};

function isThinkingLevel(v: string): v is ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(v);
}

export function loadConfig(
  target: string,
  flags: { model?: string; thinkingLevel?: string; concurrency?: number },
): Config {
  const file = join(target, ".scratch", "orchestrator.yaml");
  let fromFile: Partial<Config> = {};
  if (existsSync(file)) {
    const raw = parseYaml(readFileSync(file, "utf8")) as Record<string, unknown> | null;
    if (raw && typeof raw === "object") {
      if (typeof raw.model === "string") fromFile.model = raw.model;
      if (typeof raw.thinkingLevel === "string") {
        if (!isThinkingLevel(raw.thinkingLevel)) {
          throw new Error(`invalid thinkingLevel in ${file}: ${raw.thinkingLevel}`);
        }
        fromFile.thinkingLevel = raw.thinkingLevel;
      }
      if (typeof raw.concurrency === "number") fromFile.concurrency = raw.concurrency;
      if (typeof raw.httpProxy === "string" && raw.httpProxy.trim()) {
        fromFile.httpProxy = raw.httpProxy.trim();
      }
    }
  }
  const thinkingLevel = flags.thinkingLevel ?? fromFile.thinkingLevel ?? DEFAULTS.thinkingLevel;
  if (!isThinkingLevel(thinkingLevel)) {
    throw new Error(`invalid thinkingLevel: ${thinkingLevel}`);
  }
  const concurrency = flags.concurrency ?? fromFile.concurrency ?? DEFAULTS.concurrency;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`invalid concurrency: ${concurrency}`);
  }
  return {
    model: flags.model ?? fromFile.model ?? DEFAULTS.model,
    thinkingLevel,
    concurrency,
    httpProxy: fromFile.httpProxy ?? DEFAULTS.httpProxy,
  };
}
