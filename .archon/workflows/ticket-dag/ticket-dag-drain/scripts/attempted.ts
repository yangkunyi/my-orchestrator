import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILE = "attempted-ids.json";

function attemptedFile(artifactsDir: string): string {
  return join(artifactsDir, FILE);
}

export function readAttempted(artifactsDir: string): Set<string> {
  const p = attemptedFile(artifactsDir);
  if (!existsSync(p)) return new Set();
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as unknown;
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export function addAttempted(artifactsDir: string, ids: string[]): void {
  if (ids.length === 0) return;
  mkdirSync(artifactsDir, { recursive: true });
  const cur = readAttempted(artifactsDir);
  for (const id of ids) cur.add(id);
  writeFileSync(attemptedFile(artifactsDir), `${JSON.stringify([...cur].sort())}\n`);
}
