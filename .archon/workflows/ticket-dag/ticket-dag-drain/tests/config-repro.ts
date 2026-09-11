#!/usr/bin/env bun
/** Temp-Target repro: pack config loader. No Pi, no Archon engine, no repo src/. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, parseConfigText, type PackConfig } from "../scripts/config.ts";
import { expectEqual, expectThrow, mkTemp } from "./target.ts";

const root = mkTemp("pack-config-");
mkdirSync(join(root, ".scratch"), { recursive: true });

try {
  expectEqual("missing file", loadConfig(root), {
    model: undefined,
    thinkingLevel: "high",
    concurrency: 4,
    runner: "pi",
  });

  writeFileSync(
    join(root, ".scratch/orchestrator.yaml"),
    "model: from-orchestrator\nthinkingLevel: off\nconcurrency: 1\n",
  );
  expectEqual("orchestrator.yaml is not read", loadConfig(root), {
    model: undefined,
    thinkingLevel: "high",
    concurrency: 4,
    runner: "pi",
  });

  writeFileSync(
    join(root, ".scratch/orchestrator.yaml"),
    "thinkingLevel: nope\nconcurrency: 0\n",
  );
  expectEqual("invalid orchestrator.yaml does not fail the drain", loadConfig(root), {
    model: undefined,
    thinkingLevel: "high",
    concurrency: 4,
    runner: "pi",
  });

  writeFileSync(
    join(root, ".scratch/ticket-dag.yaml"),
    "model: from-file\nthinkingLevel: low\nconcurrency: 2\nextra: ignored\nhttpProxy: http://127.0.0.1:1\n",
  );
  expectEqual("ticket-dag.yaml + extra keys ignored", loadConfig(root), {
    model: "from-file",
    thinkingLevel: "low",
    concurrency: 2,
    runner: "pi",
  });

  writeFileSync(join(root, ".scratch/ticket-dag.yaml"), "runner: dsh\n");
  expectEqual("runner: dsh", loadConfig(root), {
    model: undefined,
    thinkingLevel: "high",
    concurrency: 4,
    runner: "dsh",
  });

  const other = join(root, "other.yaml");
  writeFileSync(other, "model: from-other\nthinkingLevel: medium\nconcurrency: 8\n");
  expectEqual("config path argument", loadConfig(root, other), {
    model: "from-other",
    thinkingLevel: "medium",
    concurrency: 8,
    runner: "pi",
  });
  expectEqual("relative config path", loadConfig(root, "other.yaml"), {
    model: "from-other",
    thinkingLevel: "medium",
    concurrency: 8,
    runner: "pi",
  });

  writeFileSync(join(root, ".scratch/ticket-dag.yaml"), "thinkingLevel: nope\n");
  expectThrow("invalid thinkingLevel", () => loadConfig(root), /invalid thinkingLevel/);

  writeFileSync(join(root, ".scratch/ticket-dag.yaml"), "thinkingLevel: 1\n");
  expectThrow("thinkingLevel number", () => loadConfig(root), /invalid thinkingLevel/);

  writeFileSync(join(root, ".scratch/ticket-dag.yaml"), "runner: nope\n");
  expectThrow("invalid runner", () => loadConfig(root), /invalid runner/);

  writeFileSync(join(root, ".scratch/ticket-dag.yaml"), "concurrency: 0\n");
  expectThrow("concurrency 0", () => loadConfig(root), /invalid concurrency/);

  writeFileSync(join(root, ".scratch/ticket-dag.yaml"), "concurrency: 1.5\n");
  expectThrow("concurrency 1.5", () => loadConfig(root), /invalid concurrency/);

  writeFileSync(join(root, ".scratch/ticket-dag.yaml"), "concurrency: -1\n");
  expectThrow("concurrency -1", () => loadConfig(root), /invalid concurrency/);

  // ---- parseConfigText: the reader, driven without a filesystem ---------------------------------
  const defaults: PackConfig = {
    model: undefined,
    thinkingLevel: "high",
    concurrency: 4,
    runner: "pi",
  };

  // Shapes people actually write; each want is what the removed `yaml` reader produced for this text.
  const shapes: { name: string; text: string; want: PackConfig }[] = [
    { name: "empty file", text: "", want: defaults },
    { name: "only blank lines and comments", text: "# a comment\n\n   \n", want: defaults },
    {
      name: "inline comment after a value",
      text: "model: from-file # why\nrunner: dsh\t# ditto\n",
      want: { ...defaults, model: "from-file", runner: "dsh" },
    },
    { name: "double-quoted value", text: 'model: "from-file"\n', want: { ...defaults, model: "from-file" } },
    { name: "single-quoted value", text: "runner: 'dsh'\n", want: { ...defaults, runner: "dsh" } },
    {
      name: "trailing whitespace",
      text: "model: from-file   \nthinkingLevel: low\t\n",
      want: { ...defaults, model: "from-file", thinkingLevel: "low" },
    },
    {
      name: "CRLF line endings",
      text: "model: from-file\r\nrunner: dsh\r\n",
      want: { ...defaults, model: "from-file", runner: "dsh" },
    },
    { name: "no final newline", text: "runner: dsh", want: { ...defaults, runner: "dsh" } },
    {
      name: "all four keys",
      text: "model: m\nthinkingLevel: off\nconcurrency: 2\nrunner: dsh\n",
      want: { model: "m", thinkingLevel: "off", concurrency: 2, runner: "dsh" },
    },
    { name: "non-string model is ignored", text: "model: 3\n", want: defaults },
    {
      name: "unknown keys stay ignored",
      text: "extra: ignored\nhttpProxy: http://127.0.0.1:1\n",
      want: defaults,
    },
    {
      name: "unknown key with a nested block stays ignored",
      text: "extra:\n  a: 1\n  - b\nmodel: from-file\n",
      want: { ...defaults, model: "from-file" },
    },
  ];
  for (const { name, text, want } of shapes) {
    expectEqual(`parseConfigText: ${name}`, parseConfigText(text, "cfg"), want);
  }

  // Shapes the reader refuses to guess at; the error must name the file and the line.
  const strict: { name: string; text: string; re: RegExp }[] = [
    {
      name: "nested map under a known key",
      text: "model:\n  name: x\n",
      re: /cfg at line 1: "model" must be a single scalar, not a nested value/,
    },
    {
      name: "nested list under a known key",
      text: "concurrency:\n  - 1\n  - 2\n",
      re: /cfg at line 1: "concurrency" must be a single scalar, not a nested value/,
    },
    {
      name: "a value then a nested block",
      text: "runner: pi\n  - dsh\n",
      re: /cfg at line 2: "runner" must be a single scalar, not a nested value/,
    },
    { name: "known key with no value at EOF", text: "# comment\nrunner:\n", re: /cfg at line 2: "runner" has no value/ },
    {
      name: "known key with no value before another key",
      text: "thinkingLevel:\nrunner: pi\n",
      re: /cfg at line 1: "thinkingLevel" has no value/,
    },
    { name: "inline map under a known key", text: "model: {a: 1}\n", re: /cfg at line 1: unsupported value/ },
    { name: "inline list under a known key", text: "concurrency: [1]\n", re: /cfg at line 1: unsupported value/ },
    { name: "block scalar under a known key", text: "model: |\n  x\n", re: /cfg at line 1: unsupported value/ },
    { name: "duplicate key", text: "model: a\nmodel: b\n", re: /cfg at line 2: duplicate key "model"/ },
  ];
  for (const { name, text, re } of strict) {
    expectThrow(`parseConfigText: ${name}`, () => parseConfigText(text, "cfg"), re);
  }

  // The four key validations, through the reader, with the messages the existing tests pin.
  const badValues: { name: string; text: string; re: RegExp }[] = [
    { name: "thinkingLevel not an enum", text: "thinkingLevel: nope\n", re: /invalid thinkingLevel in cfg: nope/ },
    { name: "thinkingLevel not a string", text: "thinkingLevel: 1\n", re: /invalid thinkingLevel in cfg: 1/ },
    { name: "concurrency zero", text: "concurrency: 0\n", re: /invalid concurrency in cfg: 0/ },
    { name: "concurrency fractional", text: "concurrency: 1.5\n", re: /invalid concurrency in cfg: 1.5/ },
    { name: "concurrency negative", text: "concurrency: -1\n", re: /invalid concurrency in cfg: -1/ },
    { name: "concurrency quoted", text: 'concurrency: "2"\n', re: /invalid concurrency in cfg: 2/ },
    {
      name: "runner not pi or dsh",
      text: "runner: nope\n",
      re: /invalid runner in cfg: nope \(expected pi or dsh\)/,
    },
  ];
  for (const { name, text, re } of badValues) {
    expectThrow(`parseConfigText: ${name}`, () => parseConfigText(text, "cfg"), re);
  }

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
