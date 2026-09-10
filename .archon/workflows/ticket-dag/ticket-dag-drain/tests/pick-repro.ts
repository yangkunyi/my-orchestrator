#!/usr/bin/env bun
/** Temp-Target repro: startable pick. No Pi, no Archon engine, no repo src/. */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rematchLeftovers } from "../scripts/rematch.ts";
import { pickStartable } from "../scripts/pick.ts";

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
  const root = mkdtempSync(join(tmpdir(), "pack-pick-"));
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

function ids(picked: { id: string }[]): string[] {
  return picked.map((t) => t.id).sort();
}

function listNonDot(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      const parent = (e as { parentPath?: string }).parentPath ?? dir;
      return join(parent, e.name).slice(dir.length).replace(/^\//, "");
    })
    .sort();
}

async function withTarget(fn: (root: string, artifacts: string, state: string) => Promise<void>): Promise<void> {
  const root = initTarget();
  const artifacts = mkdtempSync(join(tmpdir(), "pack-pick-art-"));
  const state = mkdtempSync(join(tmpdir(), "pack-pick-state-"));
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

try {
  await withTarget(async (root, artifacts, state) => {
    const r01 = writeTicket(root, "feat", "01", "one", "MERGED", "None");
    const r02 = writeTicket(root, "feat", "02", "two", "BLOCKED", "01");
    commitTickets(root);
    const picked = await pickStartable(root, { concurrency: 4, artifactsDir: artifacts });
    expectEqual("blocked→ready pick ids", ids(picked), ["feat/02"]);
    expectEqual("02 stamped READY", statusOf(root, r02), "READY");
    expectEqual("01 stays MERGED", statusOf(root, r01), "MERGED");
    const stampMsg = gitC(root, "log", "-1", "--format=%s");
    expectEqual("READY stamp commit", stampMsg, "orchestrator: feat/02 Status READY");
    expect("artifacts got attempted ids", listNonDot(artifacts).length > 0, listNonDot(artifacts));
    expectEqual("state dir unused", listNonDot(state), []);
  });

  await withTarget(async (root, artifacts) => {
    writeTicket(root, "feat", "01", "one", "MERGED", "None");
    writeTicket(root, "feat", "02", "two", "BLOCKED", "01");
    writeTicket(root, "feat", "03", "three", "BLOCKED", "01");
    commitTickets(root);
    const picked = await pickStartable(root, { concurrency: 1, artifactsDir: artifacts });
    expectEqual("concurrency 1 pick size", picked.length, 1);
    expectEqual("02 READY before pick", statusOf(root, ".scratch/feat/issues/02-two.md"), "READY");
    expectEqual("03 READY before pick", statusOf(root, ".scratch/feat/issues/03-three.md"), "READY");
    const remaining = ["feat/02", "feat/03"].filter((id) => id !== picked[0]?.id);
    expectEqual("unpicked sibling still READY", remaining.length, 1);
  });

  await withTarget(async (root, artifacts) => {
    writeTicket(root, "feat", "01", "one", "FAILED", "None");
    writeTicket(root, "feat", "02", "two", "BLOCKED", "01");
    commitTickets(root);
    const picked = await pickStartable(root, { concurrency: 4, artifactsDir: artifacts });
    expectEqual("FAILED blocker: 01 is startable", ids(picked), ["feat/01"]);
    expectEqual("dependent of FAILED stays BLOCKED", statusOf(root, ".scratch/feat/issues/02-two.md"), "BLOCKED");
  });

  await withTarget(async (root, artifacts) => {
    writeTicket(root, "feat", "01", "a", "READY", "None");
    writeTicket(root, "feat", "02", "b", "READY", "None");
    writeTicket(root, "feat", "03", "c", "READY", "None");
    commitTickets(root);
    const first = await pickStartable(root, { concurrency: 2, artifactsDir: artifacts });
    expectEqual("concurrency first pick size", first.length, 2);
    const second = await pickStartable(root, { concurrency: 2, artifactsDir: artifacts });
    expectEqual("concurrency second pick size", second.length, 1);
    const third = await pickStartable(root, { concurrency: 2, artifactsDir: artifacts });
    expectEqual("concurrency third pick empty", third.length, 0);
    const all = [...ids(first), ...ids(second)].sort();
    expectEqual("all three startable eventually", all, ["feat/01", "feat/02", "feat/03"]);
  });

  await withTarget(async (root, artifacts) => {
    writeTicket(root, "feat", "01", "one", "FAILED", "None");
    commitTickets(root);
    const first = await pickStartable(root, { concurrency: 4, artifactsDir: artifacts });
    expectEqual("FAILED is startable", ids(first), ["feat/01"]);
    expectEqual("FAILED status unchanged by pick", statusOf(root, ".scratch/feat/issues/01-one.md"), "FAILED");
    const second = await pickStartable(root, { concurrency: 4, artifactsDir: artifacts });
    expectEqual("just-attempted FAILED not re-picked", ids(second), []);
  });

  await withTarget(async (root) => {
    writeTicket(root, "feat", "01", "one", "FAILED", "None");
    commitTickets(root);
    const drain1 = mkdtempSync(join(tmpdir(), "pack-pick-d1-"));
    const drain2 = mkdtempSync(join(tmpdir(), "pack-pick-d2-"));
    try {
      const a = await pickStartable(root, { concurrency: 4, artifactsDir: drain1 });
      expectEqual("drain1 picks FAILED", ids(a), ["feat/01"]);
      const b = await pickStartable(root, { concurrency: 4, artifactsDir: drain2 });
      expectEqual("next drain may pick eligible FAILED", ids(b), ["feat/01"]);
    } finally {
      rmSync(drain1, { recursive: true, force: true });
      rmSync(drain2, { recursive: true, force: true });
    }
  });

  await withTarget(async (root, artifacts) => {
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const branch = "ticket/feat/01-demo";
    const wtRel = "worktrees/feat-01-demo";
    mkdirSync(join(root, "worktrees"), { recursive: true });
    gitC(root, "worktree", "add", "-b", branch, wtRel, "HEAD");
    writeFileSync(join(root, wtRel, "work.txt"), "agent\n");
    execFileSync("git", ["-C", join(root, wtRel), "add", "work.txt"], { encoding: "utf8" });
    execFileSync("git", ["-C", join(root, wtRel), "commit", "-m", "agent work"], { encoding: "utf8" });
    gitC(root, "merge", "--no-ff", "-m", `orchestrator: merge ${branch}`, branch);
    const picked = await pickStartable(root, { concurrency: 4, artifactsDir: artifacts });
    expectEqual("merge commit: not startable", ids(picked), []);
    expectEqual("READY with merge commit stays READY", statusOf(root, rel), "READY");
  });

  await withTarget(async (root, artifacts) => {
    writeTicket(root, "feat", "01", "one", "RUNNING", "None");
    writeTicket(root, "feat", "02", "two", "MERGED", "None");
    writeTicket(root, "other", "01", "research", "READY", "None");
    writeFileSync(
      join(root, ".scratch/other/issues/01-research.md"),
      "# 01\n\nType: research\n\n**Blocked by:** None\n\nStatus: READY\n",
    );
    commitTickets(root);
    const picked = await pickStartable(root, { concurrency: 4, artifactsDir: artifacts });
    expectEqual("in-flight, MERGED, wayfinder skipped", ids(picked), []);
  });

  await withTarget(async (root, artifacts) => {
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root, "ticket");
    writeFileSync(join(root, rel), "# 01\n\n**Blocked by:** None\n\nStatus: RUNNING\n");
    gitC(root, "add", rel);
    gitC(root, "commit", "-m", "orchestrator: feat/01 Status RUNNING");
    const branch = "ticket/feat/01-demo";
    const wtRel = "worktrees/feat-01-demo";
    mkdirSync(join(root, "worktrees"), { recursive: true });
    gitC(root, "worktree", "add", "-b", branch, wtRel, "HEAD");
    await rematchLeftovers(root, artifacts);
    expectEqual("rematch leftover → FAILED", statusOf(root, rel), "FAILED");
    const picked = await pickStartable(root, { concurrency: 4, artifactsDir: artifacts });
    expectEqual("just-FAILED leftover not picked this drain", ids(picked), []);
  });

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
}
