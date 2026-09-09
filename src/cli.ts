#!/usr/bin/env node
import { closeSync, existsSync, openSync } from "node:fs";
import { join, resolve } from "node:path";
import { cac } from "cac";
import { loadConfig } from "./config.js";
import { inspectText } from "./inspect.js";
import {
  assertNoLiveRun,
  createRun,
  openRun,
  type Journal,
} from "./journal.js";
import { reexecForProxy, spawnDetachedRun } from "./proxy.js";
import { prepareTarget, run } from "./run.js";

function childArgs(argv: string[], runId: string): string[] {
  const out: string[] = [];
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--detach") continue;
    if (rest[i] === "--run-id") {
      i++;
      continue;
    }
    out.push(rest[i]!);
  }
  out.push("--run-id", runId);
  return out;
}

function detach(journal: Journal, argv: string[], httpProxy: string | undefined, target: string): void {
  const logFile = join(journal.dir, "stdout.log");
  const fd = openSync(logFile, "a");
  const child = spawnDetachedRun({
    execPath: process.execPath,
    script: argv[1]!,
    args: childArgs(argv, journal.id),
    httpProxy,
    target,
    stdoutFd: fd,
  });
  closeSync(fd);
  if (child.pid == null) {
    journal.end(1);
    throw new Error("detach spawn produced no pid");
  }
  journal.setPid(child.pid);
  journal.log(`detached pid ${child.pid}`);
  child.unref();
}

function requireTarget(path: string): string {
  const target = resolve(path);
  if (!existsSync(target)) {
    console.error(`target not found: ${target}`);
    process.exit(1);
  }
  return target;
}

async function runCommand(
  targetArg: string,
  flags: {
    detach?: boolean;
    model?: string;
    thinkingLevel?: string;
    concurrency?: string | number;
    runId?: string;
  },
): Promise<void> {
  if (flags.detach && flags.runId) {
    console.error("cannot combine --detach and --run-id");
    process.exit(2);
  }
  const target = requireTarget(targetArg);
  const concurrency =
    flags.concurrency === undefined || flags.concurrency === ""
      ? undefined
      : Number(flags.concurrency);
  const config = loadConfig(target, {
    model: flags.model,
    thinkingLevel: flags.thinkingLevel,
    concurrency,
  });
  if (!flags.detach && !flags.runId && process.env.NODE_USE_ENV_PROXY !== "1") {
    reexecForProxy({
      execPath: process.execPath,
      argvSlice1: process.argv.slice(1),
      httpProxy: config.httpProxy,
      target,
    });
  }
  await prepareTarget(target);
  let journal: Journal | undefined;
  try {
    if (flags.runId) {
      journal = openRun(target, flags.runId);
    } else {
      assertNoLiveRun(target);
      journal = createRun(target);
    }
    journal.setPid(process.pid);
    if (flags.detach) {
      detach(journal, process.argv, config.httpProxy, target);
      console.log(`run ${journal.id} detached`);
      return;
    }
    console.log(`run ${journal.id}`);
    journal.log("run start");
    await run(target, config, journal);
    journal.end(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      journal?.log(msg);
      journal?.end(1);
    } catch {
      /* ignore */
    }
    console.error(msg);
    process.exit(1);
  }
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
    await runCommand(target, flags);
  });

cli.help();
cli.parse(process.argv, { run: false });
if (!cli.matchedCommand) {
  cli.outputHelp();
  process.exit(2);
}
await cli.runMatchedCommand();
