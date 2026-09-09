#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { cac } from "cac";
import { inspectText } from "./inspect.js";
import { startRun } from "./journal.js";

function requireTarget(path: string): string {
  const target = resolve(path);
  if (!existsSync(target)) {
    console.error(`target not found: ${target}`);
    process.exit(1);
  }
  return target;
}

const cli = cac("orchestrator");

cli
  .command("inspect <target> [id]", "Show the live Run, or a Run by id")
  .action((targetArg: string, id: string | undefined) => {
    const target = requireTarget(targetArg);
    try {
      console.log(inspectText(target, id));
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

cli
  .command("[target]", "Drain implementation Tickets")
  .option("--detach", "Run in the background")
  .option("--model <name>", "Pi model")
  .option("--thinking-level <level>", "Pi thinking level")
  .option("--concurrency <n>", "Max parallel Tickets")
  .option("--run-id <id>", "Internal child Run id")
  .action(async (target: string | undefined, flags: {
    detach?: boolean;
    model?: string;
    thinkingLevel?: string;
    concurrency?: string | number;
    runId?: string;
  }) => {
    if (!target) {
      cli.outputHelp();
      process.exit(2);
    }
    await startRun(requireTarget(target), flags);
  });

cli.help();
cli.parse(process.argv, { run: false });
if (!cli.matchedCommand) {
  cli.outputHelp();
  process.exit(2);
}
await cli.runMatchedCommand();
