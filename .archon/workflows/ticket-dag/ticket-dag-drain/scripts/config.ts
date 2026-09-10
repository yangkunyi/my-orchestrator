import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
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

/** Which runtime spends an agent node: the in-process Pi session, or DeepSeek Harness. */
export type Runner = "pi" | "dsh";

export type PackConfig = {
  model: string | undefined;
  thinkingLevel: ThinkingLevel;
  concurrency: number;
  runner: Runner;
};

export const DEFAULT_CONFIG_REL = ".scratch/ticket-dag.yaml";

const DEFAULTS: PackConfig = {
  model: undefined,
  thinkingLevel: "high",
  concurrency: 4,
  runner: "pi",
};

function isThinkingLevel(v: string): v is ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(v);
}

export function resolveConfigPath(target: string, configPath?: string): string {
  const raw = configPath?.trim() ? configPath.trim() : DEFAULT_CONFIG_REL;
  return isAbsolute(raw) ? raw : resolve(target, raw);
}

export function loadConfig(target: string, configPath?: string): PackConfig {
  const file = resolveConfigPath(target, configPath);
  if (!existsSync(file)) {
    return { ...DEFAULTS };
  }
  const raw = parseYaml(readFileSync(file, "utf8")) as Record<string, unknown> | null;
  let model = DEFAULTS.model;
  let thinkingLevel = DEFAULTS.thinkingLevel;
  let concurrency = DEFAULTS.concurrency;
  let runner = DEFAULTS.runner;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (typeof raw.model === "string") model = raw.model;
    if ("thinkingLevel" in raw) {
      if (typeof raw.thinkingLevel !== "string" || !isThinkingLevel(raw.thinkingLevel)) {
        throw new Error(`invalid thinkingLevel in ${file}: ${String(raw.thinkingLevel)}`);
      }
      thinkingLevel = raw.thinkingLevel;
    }
    if (raw.concurrency !== undefined) {
      if (typeof raw.concurrency !== "number" || !Number.isInteger(raw.concurrency) || raw.concurrency < 1) {
        throw new Error(`invalid concurrency in ${file}: ${String(raw.concurrency)}`);
      }
      concurrency = raw.concurrency;
    }
    if (raw.runner !== undefined) {
      if (raw.runner !== "pi" && raw.runner !== "dsh") {
        throw new Error(`invalid runner in ${file}: ${String(raw.runner)} (expected pi or dsh)`);
      }
      runner = raw.runner;
    }
  }
  return { model, thinkingLevel, concurrency, runner };
}
