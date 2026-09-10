#!/usr/bin/env bun
/** Shared Target fixture for the repro scripts: temp repo, Ticket files, Status reads, git helpers, expects. */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isLockHeld, tryMerge, withMergeLock } from "../scripts/main-writes.ts";
import { parseStatus, type Status } from "../scripts/ticket-line.ts";
import { scanTickets, type Ticket } from "../scripts/tickets.ts";

export function mkTemp(prefix = "pack-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function gitC(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

export function expect(name: string, cond: unknown, detail?: unknown): void {
  if (!cond) {
    throw new Error(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ""}`);
  }
}

export function expectEqual(name: string, got: unknown, want: unknown): void {
  const gs = JSON.stringify(got);
  const ws = JSON.stringify(want);
  if (gs !== ws) throw new Error(`${name}: got ${gs}, want ${ws}`);
}

export function expectThrow(name: string, fn: () => unknown, re: RegExp): void {
  try {
    fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!re.test(msg)) throw new Error(`${name}: threw ${JSON.stringify(msg)}`);
    return;
  }
  throw new Error(`${name}: expected throw`);
}

/** expectThrow for async code: awaits fn and requires it to reject. */
export async function expectReject(name: string, fn: () => Promise<unknown>, re: RegExp): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!re.test(msg)) throw new Error(`${name}: rejected ${JSON.stringify(msg)}`);
    return;
  }
  throw new Error(`${name}: expected rejection`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Target repo on Main with one seed commit. */
export function initTarget(prefix = "pack-"): string {
  const root = mkTemp(prefix);
  gitC(root, "init", "-b", "main");
  gitC(root, "config", "user.name", "test");
  gitC(root, "config", "user.email", "test@example.com");
  writeFileSync(join(root, "README.md"), "x\n");
  gitC(root, "add", "README.md");
  gitC(root, "commit", "-m", "init");
  return root;
}

/** Target + artifacts + state temp dirs, torn down after fn. Callbacks may ignore the extra args. */
export async function withTarget(
  fn: (root: string, artifacts: string, state: string) => Promise<void>,
): Promise<void> {
  const root = initTarget();
  const artifacts = mkTemp("pack-art-");
  const state = mkTemp("pack-state-");
  try {
    await fn(root, artifacts, state);
  } finally {
    try {
      execFileSync("git", ["-C", root, "worktree", "prune"], { encoding: "utf8", stdio: "ignore" });
    } catch {
      /* ignore */
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(artifacts, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
  }
}

export function writeTicket(
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

/** Read the Ticket's Status through the same reader the pack uses - no second regex in the tests. */
export function statusOf(root: string, rel: string): Status {
  return parseStatus(readFileSync(join(root, rel), "utf8"));
}

export function commitTickets(root: string, message = "tickets"): void {
  gitC(root, "add", ".scratch");
  gitC(root, "commit", "-m", message);
}

export function ticketOf(root: string, id: string): Ticket {
  const t = scanTickets(root).find((x) => x.id === id);
  if (!t) throw new Error(`missing ticket ${id}`);
  return t;
}

/** Worktree for a Ticket, branched from Main HEAD. Returns the worktree path. */
export function addTicketWorktree(root: string, ticket: Ticket): string {
  mkdirSync(join(root, "worktrees"), { recursive: true });
  gitC(root, "worktree", "add", "-b", ticket.branch, ticket.worktreeRel, "HEAD");
  return join(root, ticket.worktreeRel);
}

export function commitFile(cwd: string, file: string, content: string, message: string): void {
  writeFileSync(join(cwd, file), content);
  execFileSync("git", ["-C", cwd, "add", file], { encoding: "utf8" });
  execFileSync("git", ["-C", cwd, "commit", "-m", message], { encoding: "utf8" });
}

export function commitsAhead(worktree: string, base: string): number {
  return Number(gitC(worktree, "rev-list", "--count", `${base}..HEAD`));
}

export function subjects(root: string): string[] {
  const out = gitC(root, "log", "--pretty=%s");
  return out ? out.split("\n") : [];
}

export function hasMergeHead(cwd: string): boolean {
  try {
    gitC(cwd, "rev-parse", "-q", "--verify", "MERGE_HEAD");
    return true;
  } catch {
    return false;
  }
}

export function branchExists(root: string, branch: string): boolean {
  try {
    gitC(root, "rev-parse", "--verify", branch);
    return true;
  } catch {
    return false;
  }
}

export function envWithout(...names: string[]): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of names) delete env[name];
  return env;
}

/** Run a pack script node the way Archon does, with the proxy env already set. */
export function runScript(
  script: string,
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(process.execPath, [script], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1", ...env },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

// Self-check: the fixture builds a Target, writes a Ticket, and reads its Status back.
if (import.meta.main) {
  const root = initTarget();
  try {
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const ticket = ticketOf(root, "feat/01");
    addTicketWorktree(root, ticket);
    commitFile(join(root, ticket.worktreeRel), "work.txt", "x\n", "work");
    expectEqual("ticket id", ticket.id, "feat/01");
    expectEqual("status read back", statusOf(root, rel), "READY");
    expect("worktree commit on branch", commitsAhead(join(root, ticket.worktreeRel), gitC(root, "rev-parse", "HEAD")) === 1);
    // The Main-write seam owns the lock: a merge without it refuses instead of racing.
    await expectReject("unlocked tryMerge", () => tryMerge(root, "ticket/x/01"), /must run inside withMergeLock/);
    await withMergeLock(root, async () => expect("lock held inside", isLockHeld()));
    expect("lock released after", !isLockHeld());
    console.log(JSON.stringify({ ok: true }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    process.exitCode = 1;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
