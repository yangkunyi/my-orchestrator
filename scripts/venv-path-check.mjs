#!/usr/bin/env node
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childEnv } from "../dist/proxy.js";

const dir = mkdtempSync(join(tmpdir(), "venv-path-check-"));
try {
  mkdirSync(join(dir, ".venv", "bin"), { recursive: true });
  const env = childEnv({ httpProxy: undefined, target: dir });
  const prefix = join(dir, ".venv", "bin");
  if (!env.PATH?.startsWith(`${prefix}:`) && env.PATH !== prefix) {
    throw new Error(`PATH missing venv bin: ${env.PATH}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
