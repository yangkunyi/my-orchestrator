import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

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

/** The only keys the pack reads; every other top-level key is ignored, as before. */
const CONFIG_KEYS = ["model", "thinkingLevel", "concurrency", "runner"] as const;
type ConfigKey = (typeof CONFIG_KEYS)[number];

function isConfigKey(key: string): key is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(key);
}

function isThinkingLevel(v: string): v is ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(v);
}

/** A shape the reader refuses to guess at. The message names the file and the 1-based line. */
function configError(file: string, line: number, detail: string): Error {
  return new Error(`cannot read ${file} at line ${line}: ${detail}`);
}

/** Cut a `#` comment, ignoring `#` inside a quoted value. */
function stripComment(raw: string): string {
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (quote === '"') {
      if (ch === "\\") i++;
      else if (ch === '"') quote = undefined;
    } else if (quote === "'") {
      if (ch === "'" && raw[i + 1] === "'") i++;
      else if (ch === "'") quote = undefined;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#" && (i === 0 || raw[i - 1] === " " || raw[i - 1] === "\t")) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

/** One inline scalar: a quoted string, a number, a boolean, null, or a bare string. */
function parseScalar(text: string, file: string, line: number): unknown {
  const lead = text[0]!;
  if (lead === "{" || lead === "[" || lead === "|" || lead === ">" || lead === "&" || lead === "*" || lead === "!") {
    throw configError(file, line, `unsupported value ${JSON.stringify(text)}`);
  }
  if (lead === '"') {
    if (text.length < 2 || !text.endsWith('"')) {
      throw configError(file, line, "unterminated double-quoted value");
    }
    try {
      return JSON.parse(text);
    } catch {
      throw configError(file, line, `unreadable double-quoted value ${JSON.stringify(text)}`);
    }
  }
  if (lead === "'") {
    if (text.length < 2 || !text.endsWith("'")) {
      throw configError(file, line, "unterminated single-quoted value");
    }
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text)) return Number(text);
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null" || text === "~") return null;
  return text;
}

/**
 * Read the pack config out of the tiny YAML subset people actually write on a Target: one flat
 * mapping of scalars, with `#` comments and blank lines. Anything the reader does not understand - a
 * nested map or list, a key with no value, a duplicate key, a value that opens a flow collection or
 * block scalar - throws with the file and line instead of being silently reinterpreted. Unknown keys
 * are ignored, as they always were. `file` only names the source in error messages, so tests can
 * drive this without a filesystem.
 */
export function parseConfigText(text: string, file: string): PackConfig {
  const config: PackConfig = { ...DEFAULTS };
  const seen = new Set<string>();
  let topIndent: number | undefined;
  let currentKey: string | undefined;
  /** A known key whose scalar is still missing: the next line decides "nested value" or "no value". */
  let pending: { key: string; line: number } | undefined;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = stripComment(lines[i]!).replace(/[ \t\r]+$/, "");
    if (line.trim() === "" || line.trim() === "---" || line.trim() === "...") continue;

    const indent = line.length - line.trimStart().length;
    if (topIndent === undefined) topIndent = indent;
    if (indent > topIndent) {
      if (pending !== undefined) {
        throw configError(file, pending.line, `"${pending.key}" must be a single scalar, not a nested value`);
      }
      if (currentKey !== undefined && isConfigKey(currentKey)) {
        throw configError(file, lineNo, `"${currentKey}" must be a single scalar, not a nested value`);
      }
      continue;
    }
    if (indent < topIndent) throw configError(file, lineNo, "line is indented less than the first key");

    if (pending !== undefined) {
      throw configError(file, pending.line, `"${pending.key}" has no value`);
    }
    const kv = /^([A-Za-z0-9_.-]+):(.*)$/.exec(line.slice(indent));
    if (!kv) throw configError(file, lineNo, `expected a "key: value" line, found ${JSON.stringify(line.trim())}`);
    const key = kv[1]!;
    currentKey = key;
    if (seen.has(key)) throw configError(file, lineNo, `duplicate key "${key}"`);
    seen.add(key);
    if (!isConfigKey(key)) continue;

    const valueText = kv[2]!.trim();
    if (valueText === "") {
      pending = { key, line: lineNo };
      continue;
    }
    const value = parseScalar(valueText, file, lineNo);
    switch (key) {
      case "model":
        if (typeof value === "string") config.model = value;
        break;
      case "thinkingLevel":
        if (typeof value !== "string" || !isThinkingLevel(value)) {
          throw new Error(`invalid thinkingLevel in ${file}: ${String(value)}`);
        }
        config.thinkingLevel = value;
        break;
      case "concurrency":
        if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
          throw new Error(`invalid concurrency in ${file}: ${String(value)}`);
        }
        config.concurrency = value;
        break;
      case "runner":
        if (value !== "pi" && value !== "dsh") {
          throw new Error(`invalid runner in ${file}: ${String(value)} (expected pi or dsh)`);
        }
        config.runner = value;
        break;
    }
  }
  if (pending !== undefined) {
    throw configError(file, pending.line, `"${pending.key}" has no value`);
  }
  return config;
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
  return parseConfigText(readFileSync(file, "utf8"), file);
}
