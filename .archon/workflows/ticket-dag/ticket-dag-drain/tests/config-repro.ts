#!/usr/bin/env bun
/** Temp-Target repro: pack config loader. No Pi, no Archon engine, no repo src/. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../scripts/config.ts";
import { expectEqual, expectThrow, mkTemp } from "./target.ts";

const root = mkTemp("pack-config-");
mkdirSync(join(root, ".scratch"), { recursive: true });

try {
  expectEqual("missing file", loadConfig(root), {
    model: undefined,
    thinkingLevel: "high",
    concurrency: 4,
  });

  writeFileSync(
    join(root, ".scratch/orchestrator.yaml"),
    "model: from-orchestrator\nthinkingLevel: off\nconcurrency: 1\n",
  );
  expectEqual("orchestrator.yaml is not read", loadConfig(root), {
    model: undefined,
    thinkingLevel: "high",
    concurrency: 4,
  });

  writeFileSync(
    join(root, ".scratch/orchestrator.yaml"),
    "thinkingLevel: nope\nconcurrency: 0\n",
  );
  expectEqual("invalid orchestrator.yaml does not fail the drain", loadConfig(root), {
    model: undefined,
    thinkingLevel: "high",
    concurrency: 4,
  });

  writeFileSync(
    join(root, ".scratch/ticket-dag.yaml"),
    "model: from-file\nthinkingLevel: low\nconcurrency: 2\nextra: ignored\nhttpProxy: http://127.0.0.1:1\n",
  );
  expectEqual("ticket-dag.yaml + extra keys ignored", loadConfig(root), {
    model: "from-file",
    thinkingLevel: "low",
    concurrency: 2,
  });

  const other = join(root, "other.yaml");
  writeFileSync(other, "model: from-other\nthinkingLevel: medium\nconcurrency: 8\n");
  expectEqual("config path argument", loadConfig(root, other), {
    model: "from-other",
    thinkingLevel: "medium",
    concurrency: 8,
  });
  expectEqual("relative config path", loadConfig(root, "other.yaml"), {
    model: "from-other",
    thinkingLevel: "medium",
    concurrency: 8,
  });

  writeFileSync(join(root, ".scratch/ticket-dag.yaml"), "thinkingLevel: nope\n");
  expectThrow("invalid thinkingLevel", () => loadConfig(root), /invalid thinkingLevel/);

  writeFileSync(join(root, ".scratch/ticket-dag.yaml"), "thinkingLevel: 1\n");
  expectThrow("thinkingLevel number", () => loadConfig(root), /invalid thinkingLevel/);

  writeFileSync(join(root, ".scratch/ticket-dag.yaml"), "concurrency: 0\n");
  expectThrow("concurrency 0", () => loadConfig(root), /invalid concurrency/);

  writeFileSync(join(root, ".scratch/ticket-dag.yaml"), "concurrency: 1.5\n");
  expectThrow("concurrency 1.5", () => loadConfig(root), /invalid concurrency/);

  writeFileSync(join(root, ".scratch/ticket-dag.yaml"), "concurrency: -1\n");
  expectThrow("concurrency -1", () => loadConfig(root), /invalid concurrency/);

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
