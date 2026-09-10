#!/usr/bin/env bun
/** Temp-Target repro: drain loop without Pi. Empty ticket branch FAILED-exits 0 so pick can empty. No Archon engine, no repo src/. */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noopAgent } from "../scripts/agent.ts";
import { rematchLeftovers } from "../scripts/rematch.ts";
import { pickStartable } from "../scripts/pick.ts";
import { conflictTicket } from "../scripts/conflict.ts";
import { implementTicket } from "../scripts/implement.ts";
import { scanTickets } from "../scripts/tickets.ts";

const implementScript = join(import.meta.dir, "../../ticket-dag-execute/scripts/implement.ts");
const conflictScript = join(import.meta.dir, "../../ticket-dag-execute/scripts/conflict.ts");

function expect(name: string, cond: unknown, detail?: unknown): void {
  if (!cond) {
    throw new Error(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ""}`);
  }
}

function expectEqual(name: string, got: unknown, want: unknown): void {
  const gs = JSON.stringify(got);
  const ws = JSON.stringify(want);
  if (gs !== ws) throw new Error(`${name}: got ${gs}, want ${ws}`);
}

function gitC(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function statusOf(root: string, rel: string): string {
  const body = readFileSync(join(root, rel), "utf8");
  return body.match(/^(?:\*\*)?Status\s*:(?:\*\*)?\s*(\S+)/im)?.[1] ?? "";
}

function writeTicket(
  root: string,
  feature: string,
  nn: string,
  slug: string,
  status: string,
  blockedBy: string,
): string {
  const rel = `.scratch/${feature}/issues/${nn}-${slug}.md`;
  mkdirSync(join(root, `.scratch/${feature}/issues`), { recursive: true });
  writeFileSync(
    join(root, rel),
    `# ${nn}\n\n**Blocked by:** ${blockedBy}\n\nStatus: ${status}\n`,
  );
  return rel;
}

function initTarget(): string {
  const root = mkdtempSync(join(tmpdir(), "pack-drain-"));
  gitC(root, "init", "-b", "main");
  gitC(root, "config", "user.name", "test");
  gitC(root, "config", "user.email", "test@example.com");
  writeFileSync(join(root, "README.md"), "x\n");
  gitC(root, "add", "README.md");
  gitC(root, "commit", "-m", "init");
  return root;
}

function commitTickets(root: string, message = "tickets"): void {
  gitC(root, "add", ".scratch");
  gitC(root, "commit", "-m", message);
}

function ticketOf(root: string, id: string) {
  const t = scanTickets(root).find((x) => x.id === id);
  if (!t) throw new Error(`missing ticket ${id}`);
  return t;
}

function agentOpts(artifacts: string) {
  return { artifactsDir: artifacts, runAgent: noopAgent };
}

async function drainUntilEmpty(
  root: string,
  artifacts: string,
  concurrency: number,
): Promise<{ iterations: number; tokens: string[] }> {
  await rematchLeftovers(root, artifacts);
  const tokens: string[] = [];
  let iterations = 0;
  for (; iterations < 500; iterations++) {
    const picked = await pickStartable(root, { concurrency, artifactsDir: artifacts });
    if (picked.length === 0) break;
    const batch = await Promise.all(
      picked.map(async (t) => {
        const token = await implementTicket(root, t.id, agentOpts(artifacts));
        if (token === "resolve") return conflictTicket(root, t.id, agentOpts(artifacts));
        return token;
      }),
    );
    tokens.push(...batch);
  }
  return { iterations, tokens };
}

async function withTarget(
  fn: (root: string, artifacts: string) => Promise<void>,
): Promise<void> {
  const root = initTarget();
  const artifacts = mkdtempSync(join(tmpdir(), "pack-drain-art-"));
  try {
    await fn(root, artifacts);
  } finally {
    try {
      execFileSync("git", ["-C", root, "worktree", "prune"], {
        encoding: "utf8",
        stdio: "ignore",
      });
    } catch {
      /* ignore */
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(artifacts, { recursive: true, force: true });
  }
}

try {
  await withTarget(async (root, artifacts) => {
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const token = await implementTicket(root, "feat/01", agentOpts(artifacts));
    expectEqual("empty branch stdout token", token, "failed");
    expectEqual("empty branch Status", statusOf(root, rel), "FAILED");
    const ticket = ticketOf(root, "feat/01");
    expect("Worktree kept", existsSync(join(root, ticket.worktreeRel)), ticket.worktreeRel);
  });

  await withTarget(async (root) => {
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const { INPUTS_TICKET: _drop, ...env } = process.env;
    const proc = spawnSync(process.execPath, [implementScript], {
      cwd: root,
      encoding: "utf8",
      env: { ...env, NODE_USE_ENV_PROXY: "1" },
    });
    expect("bare implement without ticket is unsupported", (proc.status ?? 1) !== 0, proc.status);
    expect("error names missing ticket", (proc.stderr ?? "").includes("INPUTS_TICKET is required"));
  });

  await withTarget(async (root) => {
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const { INPUTS_TICKET: _drop, ...env } = process.env;
    const proc = spawnSync(process.execPath, [conflictScript], {
      cwd: root,
      encoding: "utf8",
      env: { ...env, NODE_USE_ENV_PROXY: "1" },
    });
    expect("bare conflict without ticket is unsupported", (proc.status ?? 1) !== 0, proc.status);
    expect("conflict error names missing ticket", (proc.stderr ?? "").includes("INPUTS_TICKET is required"));
  });

  await withTarget(async (root) => {
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const { ARTIFACTS_DIR: _drop, ...env } = process.env;
    const proc = spawnSync(process.execPath, [implementScript], {
      cwd: root,
      encoding: "utf8",
      env: { ...env, INPUTS_TICKET: "feat/01", NODE_USE_ENV_PROXY: "1" },
    });
    expect("implement requires artifacts dir", (proc.status ?? 1) !== 0, proc.status);
    expect("error names missing artifacts", (proc.stderr ?? "").includes("ARTIFACTS_DIR is required"));
  });

  await withTarget(async (root, artifacts) => {
    const r01 = writeTicket(root, "feat", "01", "one", "READY", "None");
    const r02 = writeTicket(root, "feat", "02", "two", "READY", "None");
    commitTickets(root);
    const { iterations, tokens } = await drainUntilEmpty(root, artifacts, 1);
    expectEqual("loop finished before cap", iterations < 500, true);
    expect("pick became empty", iterations >= 1, iterations);
    expectEqual("both empty branches failed", [...tokens].sort(), ["failed", "failed"]);
    expectEqual("01 FAILED", statusOf(root, r01), "FAILED");
    expectEqual("02 FAILED", statusOf(root, r02), "FAILED");
    const t1 = ticketOf(root, "feat/01");
    const t2 = ticketOf(root, "feat/02");
    expect("01 Worktree kept", existsSync(join(root, t1.worktreeRel)));
    expect("02 Worktree kept", existsSync(join(root, t2.worktreeRel)));
    const after = await pickStartable(root, { concurrency: 4, artifactsDir: artifacts });
    expectEqual("same drain does not re-pick just-FAILED", after.map((t) => t.id), []);
  });

  await withTarget(async (root, artifacts) => {
    writeFileSync(join(root, "conflict.txt"), "base\n");
    gitC(root, "add", "conflict.txt");
    gitC(root, "commit", "-m", "base conflict file");
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const ticket = ticketOf(root, "feat/01");
    const wtRel = ticket.worktreeRel;
    const wt = join(root, wtRel);
    mkdirSync(join(root, "worktrees"), { recursive: true });
    gitC(root, "worktree", "add", "-b", ticket.branch, wtRel, "HEAD");
    writeFileSync(join(wt, "conflict.txt"), "from-agent\n");
    execFileSync("git", ["-C", wt, "add", "conflict.txt"], { encoding: "utf8" });
    execFileSync("git", ["-C", wt, "commit", "-m", "agent conflict"], { encoding: "utf8" });
    writeFileSync(join(root, rel), "# 01\n\n**Blocked by:** None\n\nStatus: FAILED\n");
    gitC(root, "add", rel);
    gitC(root, "commit", "-m", "orchestrator: feat/01 Status FAILED");
    writeFileSync(join(root, "conflict.txt"), "from-main\n");
    gitC(root, "add", "conflict.txt");
    gitC(root, "commit", "-m", "main conflict");
    const token = await implementTicket(root, "feat/01", agentOpts(artifacts));
    expectEqual("resume-conflict implement token", token, "resolve");
    expectEqual("status still RUNNING until conflict node", statusOf(root, rel), "RUNNING");
    const conflictToken = await conflictTicket(root, "feat/01", agentOpts(artifacts));
    expectEqual("conflict stdout token", conflictToken, "failed");
    expectEqual("conflict stamps FAILED", statusOf(root, rel), "FAILED");
    expect("Worktree kept after unresolved conflict", existsSync(wt));
  });

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
}
