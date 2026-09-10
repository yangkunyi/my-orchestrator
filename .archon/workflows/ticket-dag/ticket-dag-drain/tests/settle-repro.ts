#!/usr/bin/env bun
/** Temp-Target repro: settle after agent. Matches empty-merge and merge-conflict CLI repros. No Pi, no Archon engine, no repo src/. */
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
import { beginTicket } from "../scripts/begin.ts";
import { tryMerge } from "../scripts/git.ts";
import { settleAfterAgent } from "../scripts/settle.ts";
import { scanTickets } from "../scripts/tickets.ts";

const settleScript = join(import.meta.dir, "../scripts/settle.ts");

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
  const root = mkdtempSync(join(tmpdir(), "pack-settle-"));
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

function commitsAhead(worktree: string, base: string): number {
  return Number(gitC(worktree, "rev-list", "--count", `${base}..HEAD`));
}

function subjects(root: string): string[] {
  const out = gitC(root, "log", "--pretty=%s");
  return out ? out.split("\n") : [];
}

function hasMergeHead(cwd: string): boolean {
  try {
    gitC(cwd, "rev-parse", "-q", "--verify", "MERGE_HEAD");
    return true;
  } catch {
    return false;
  }
}

function branchExists(root: string, branch: string): boolean {
  try {
    gitC(root, "rev-parse", "--verify", branch);
    return true;
  } catch {
    return false;
  }
}

function commitOnTree(wt: string, file: string, content: string, message: string): void {
  writeFileSync(join(wt, file), content);
  execFileSync("git", ["-C", wt, "add", file], { encoding: "utf8" });
  execFileSync("git", ["-C", wt, "commit", "-m", message], { encoding: "utf8" });
}

function runSettleScript(
  root: string,
  ticketId: string,
): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(process.execPath, [settleScript], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, INPUTS_TICKET: ticketId },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withTarget(fn: (root: string) => Promise<void>): Promise<void> {
  const root = initTarget();
  try {
    await fn(root);
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
  }
}

try {
  await withTarget(async (root) => {
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const ticket = ticketOf(root, "feat/01");
    const shaBeforeBegin = gitC(root, "rev-parse", "HEAD");
    const begun = await beginTicket(root, ticket);
    const wt = begun.worktree;
    const vsOld = commitsAhead(wt, shaBeforeBegin);
    const vsMain = commitsAhead(wt, gitC(root, "rev-parse", "HEAD"));
    const result = await settleAfterAgent(root, ticket, wt);
    const mergeOnMain = subjects(root).some((l) => l.startsWith("orchestrator: merge "));
    expectEqual("empty merge result", result, "failed");
    expectEqual("empty merge Status", statusOf(root, rel), "FAILED");
    expect("RUNNING stamp counted vs old Main", vsOld > 0, vsOld);
    expectEqual("no commits vs current Main", vsMain, 0);
    expect("no merge commit on Main", !mergeOnMain, subjects(root));
    expect("Worktree kept", existsSync(wt), wt);
    expect("branch kept", branchExists(root, ticket.branch));
  });

  await withTarget(async (root) => {
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const ticket = ticketOf(root, "feat/01");
    const begun = await beginTicket(root, ticket);
    const wt = begun.worktree;
    commitOnTree(wt, "work.txt", "agent\n", "agent work");
    writeFileSync(join(wt, "work.txt"), "dirty\n");
    writeFileSync(join(wt, "untracked.txt"), "u\n");
    const result = await settleAfterAgent(root, ticket, wt);
    expectEqual("dirty result", result, "failed");
    expectEqual("dirty Status", statusOf(root, rel), "FAILED");
    expect("dirty Worktree kept", existsSync(wt), wt);
    expectEqual("dirty file kept", readFileSync(join(wt, "work.txt"), "utf8"), "dirty\n");
    expectEqual("untracked kept", readFileSync(join(wt, "untracked.txt"), "utf8"), "u\n");
    expect("no merge commit when dirty", !subjects(root).some((l) => l.startsWith("orchestrator: merge ")));
    expect("branch kept when dirty", branchExists(root, ticket.branch));
  });

  await withTarget(async (root) => {
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const ticket = ticketOf(root, "feat/01");
    const begun = await beginTicket(root, ticket);
    const wt = begun.worktree;
    commitOnTree(wt, "work.txt", "agent\n", "agent work");
    const branchSha = gitC(root, "rev-parse", ticket.branch);
    const result = await settleAfterAgent(root, ticket, wt);
    expectEqual("success result", result, "merged");
    expectEqual("success Status", statusOf(root, rel), "MERGED");
    expect("Worktree removed", !existsSync(wt), wt);
    expect("branch removed", !branchExists(root, ticket.branch));
    expectEqual("follow-up Status commit", gitC(root, "log", "-1", "--format=%s"), "orchestrator: feat/01 Status MERGED");
    const mergeMsg = gitC(root, "log", "-1", "--format=%s", "HEAD~1");
    expectEqual("merge message matches CLI", mergeMsg, `orchestrator: merge ${ticket.branch}`);
    const parents = gitC(root, "rev-list", "--parents", "-n", "1", "HEAD~1").split(" ");
    expectEqual("merge has two parents", parents.length, 3);
    expectEqual("second parent is ticket branch", parents[2], branchSha);
    expect("work landed on Main", existsSync(join(root, "work.txt")));
  });

  await withTarget(async (root) => {
    writeFileSync(join(root, "f"), "a\n");
    gitC(root, "add", "f");
    gitC(root, "commit", "-m", "init f");
    gitC(root, "checkout", "-b", "ticket/feat/01-demo");
    writeFileSync(join(root, "f"), "b\n");
    gitC(root, "add", "f");
    gitC(root, "commit", "-m", "ticket");
    gitC(root, "checkout", "-");
    writeFileSync(join(root, "f"), "c\n");
    gitC(root, "add", "f");
    gitC(root, "commit", "-m", "mainline");
    const result = await tryMerge(root, "ticket/feat/01-demo");
    expectEqual("tryMerge conflict", result, "conflict");
    expect("Main MERGE_HEAD aborted", !hasMergeHead(root));
    expectEqual("Main porcelain clean", gitC(root, "status", "--porcelain"), "");
  });

  await withTarget(async (root) => {
    writeFileSync(join(root, "f"), "a\n");
    gitC(root, "add", "f");
    gitC(root, "commit", "-m", "init f");
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const ticket = ticketOf(root, "feat/01");
    const begun = await beginTicket(root, ticket);
    const wt = begun.worktree;
    commitOnTree(wt, "f", "b\n", "ticket");
    writeFileSync(join(root, "f"), "c\n");
    gitC(root, "add", "f");
    gitC(root, "commit", "-m", "mainline");
    const result = await settleAfterAgent(root, ticket, wt);
    expectEqual("conflict settle result", result, "resolve");
    expectEqual("conflict Status", statusOf(root, rel), "CONFLICT");
    expect("Worktree kept on resolve", existsSync(wt), wt);
    expect("branch kept on resolve", branchExists(root, ticket.branch));
    expect("Main MERGE_HEAD aborted", !hasMergeHead(root));
    expectEqual("Main porcelain clean", gitC(root, "status", "--porcelain"), "");
    expect("Worktree MERGE_HEAD present", hasMergeHead(wt));
  });

  await withTarget(async (root) => {
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const ticket = ticketOf(root, "feat/01");
    await beginTicket(root, ticket);
    const proc = runSettleScript(root, "feat/01");
    expectEqual("failed stdout token", proc.stdout, "failed\n");
    expectEqual("git-contract FAILED exit 0", proc.status, 0);
    expect("logs on stderr not stdout", !proc.stdout.includes("\nfailed") || proc.stdout === "failed\n");
  });

  await withTarget(async (root) => {
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const ticket = ticketOf(root, "feat/01");
    const begun = await beginTicket(root, ticket);
    commitOnTree(begun.worktree, "work.txt", "agent\n", "agent work");
    const proc = runSettleScript(root, "feat/01");
    expectEqual("merged stdout token", proc.stdout, "merged\n");
    expectEqual("merged exit 0", proc.status, 0);
  });

  await withTarget(async (root) => {
    writeFileSync(join(root, "f"), "a\n");
    gitC(root, "add", "f");
    gitC(root, "commit", "-m", "init f");
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const ticket = ticketOf(root, "feat/01");
    const begun = await beginTicket(root, ticket);
    commitOnTree(begun.worktree, "f", "b\n", "ticket");
    writeFileSync(join(root, "f"), "c\n");
    gitC(root, "add", "f");
    gitC(root, "commit", "-m", "mainline");
    const proc = runSettleScript(root, "feat/01");
    expectEqual("resolve stdout token", proc.stdout, "resolve\n");
    expectEqual("resolve exit 0", proc.status, 0);
  });

  await withTarget(async (root) => {
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const ticket = ticketOf(root, "feat/01");
    const begun = await beginTicket(root, ticket);
    commitOnTree(begun.worktree, "work.txt", "agent\n", "agent work");
    writeFileSync(join(root, ".git.lock"), "cli-lock\n");
    const result = await settleAfterAgent(root, ticket, begun.worktree);
    expectEqual("CLI lock file is not the pack lock", result, "merged");
    expectEqual("CLI lock file left untouched", readFileSync(join(root, ".git.lock"), "utf8"), "cli-lock\n");
  });

  await withTarget(async (root) => {
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const ticket = ticketOf(root, "feat/01");
    const begun = await beginTicket(root, ticket);
    commitOnTree(begun.worktree, "work.txt", "agent\n", "agent work");
    const lockPath = join(root, ".git", "ticket-dag.lock");
    writeFileSync(lockPath, `${process.pid}\n`);
    let finished = false;
    const p = settleAfterAgent(root, ticket, begun.worktree).then((r) => {
      finished = true;
      return r;
    });
    await sleep(250);
    expect("pack lock serializes Main writes", finished === false);
    rmSync(lockPath);
    const result = await p;
    expectEqual("settle after pack lock released", result, "merged");
  });

  await withTarget(async (root) => {
    writeTicket(root, "feat", "01", "one", "READY", "None");
    writeTicket(root, "feat", "02", "two", "READY", "None");
    commitTickets(root);
    const t1 = ticketOf(root, "feat/01");
    const t2 = ticketOf(root, "feat/02");
    const b1 = await beginTicket(root, t1);
    const b2 = await beginTicket(root, ticketOf(root, "feat/02"));
    commitOnTree(b1.worktree, "one.txt", "1\n", "one");
    commitOnTree(b2.worktree, "two.txt", "2\n", "two");
    const [r1, r2] = await Promise.all([
      settleAfterAgent(root, t1, b1.worktree),
      settleAfterAgent(root, t2, b2.worktree),
    ]);
    expectEqual("parallel first", r1, "merged");
    expectEqual("parallel second", r2, "merged");
    expectEqual("01 MERGED", statusOf(root, t1.relPath), "MERGED");
    expectEqual("02 MERGED", statusOf(root, t2.relPath), "MERGED");
    expect("both merge messages on Main", subjects(root).includes(`orchestrator: merge ${t1.branch}`));
    expect("both merge messages on Main 02", subjects(root).includes(`orchestrator: merge ${t2.branch}`));
    expect("one.txt on Main", existsSync(join(root, "one.txt")));
    expect("two.txt on Main", existsSync(join(root, "two.txt")));
  });

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
}
