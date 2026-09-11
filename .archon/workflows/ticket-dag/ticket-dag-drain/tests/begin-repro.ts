#!/usr/bin/env bun
/** Temp-Target repro: Worktree begin / resume. No Pi, no Archon engine, no repo src/. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beginTicket } from "../scripts/transitions.ts";
import {
  addTicketWorktree,
  commitFile,
  commitTickets,
  expect,
  expectEqual,
  gitC,
  statusOf,
  ticketOf,
  withTarget,
  writeTicket,
} from "./target.ts";

try {
  await withTarget(async (root) => {
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const ticket = ticketOf(root, "feat/01");
    const result = await beginTicket(root, ticket);
    const wt = join(root, ticket.worktreeRel);
    expectEqual("first start Status", statusOf(root, rel), "RUNNING");
    expect("first start Worktree exists", existsSync(wt), wt);
    expectEqual("first start stamp message", gitC(root, "log", "-1", "--format=%s"), "orchestrator: feat/01 Status RUNNING");
    expectEqual("Worktree is Main HEAD after RUNNING stamp", gitC(wt, "rev-parse", "HEAD"), gitC(root, "rev-parse", "HEAD"));
    expectEqual("Worktree ticket file is RUNNING", statusOf(wt, rel), "RUNNING");
    expectEqual("branch at Main HEAD", gitC(root, "rev-parse", ticket.branch), gitC(root, "rev-parse", "HEAD"));
    expect("result.worktree is the tree", result.worktree === wt, result);
    expect("first start ok", result.ok, result);
  });

  await withTarget(async (root) => {
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const ticket = ticketOf(root, "feat/01");
    const wt = addTicketWorktree(root, ticket);
    commitFile(wt, "agent.txt", "from-branch\n", "agent work");
    const agentSha = gitC(wt, "rev-parse", "HEAD");
    writeFileSync(join(wt, "agent.txt"), "dirty-keep\n");
    writeFileSync(join(wt, "untracked.txt"), "untracked\n");
    writeFileSync(join(root, rel), "# 01\n\n**Blocked by:** None\n\nStatus: FAILED\n");
    gitC(root, "add", rel);
    gitC(root, "commit", "-m", "orchestrator: feat/01 Status FAILED");
    writeFileSync(join(root, "main-only.txt"), "main moved\n");
    gitC(root, "add", "main-only.txt");
    gitC(root, "commit", "-m", "main moved");
    const failed = ticketOf(root, "feat/01");
    const result = await beginTicket(root, failed);
    expectEqual("resume Status", statusOf(root, rel), "RUNNING");
    expect("resume reuses Worktree", existsSync(wt), wt);
    expectEqual("resume worktree path", result.worktree, wt);
    expectEqual("dirty tracked file kept", readFileSync(join(wt, "agent.txt"), "utf8"), "dirty-keep\n");
    expectEqual("untracked file kept", readFileSync(join(wt, "untracked.txt"), "utf8"), "untracked\n");
    expect("agent commit still on branch", gitC(root, "merge-base", "--is-ancestor", agentSha, ticket.branch) === "");
    expect("Main integrated (main-only.txt)", existsSync(join(wt, "main-only.txt")));
    expect("resume ok", result.ok, result);
  });

  await withTarget(async (root) => {
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const ticket = ticketOf(root, "feat/01");
    const wt = addTicketWorktree(root, ticket);
    commitFile(wt, "branch-only.txt", "from-branch\n", "agent on branch");
    const branchSha = gitC(root, "rev-parse", ticket.branch);
    gitC(root, "worktree", "remove", "--force", ticket.worktreeRel);
    expect("tree gone before begin", !existsSync(wt));
    writeFileSync(join(root, rel), "# 01\n\n**Blocked by:** None\n\nStatus: FAILED\n");
    gitC(root, "add", rel);
    gitC(root, "commit", "-m", "orchestrator: feat/01 Status FAILED");
    writeFileSync(join(root, "main-only.txt"), "main moved\n");
    gitC(root, "add", "main-only.txt");
    gitC(root, "commit", "-m", "main moved");
    const failed = ticketOf(root, "feat/01");
    const result = await beginTicket(root, failed);
    expectEqual("missing-tree Status", statusOf(root, rel), "RUNNING");
    expect("Worktree recreated", existsSync(wt), wt);
    expectEqual("recreated from branch, not Main", readFileSync(join(wt, "branch-only.txt"), "utf8"), "from-branch\n");
    expect("old branch commit is ancestor", gitC(root, "merge-base", "--is-ancestor", branchSha, ticket.branch) === "");
    expect("Main integrated after recreate", existsSync(join(wt, "main-only.txt")));
    expect("not Main HEAD only", gitC(wt, "rev-parse", "HEAD") !== gitC(root, "rev-parse", "HEAD"));
    expect("result ok", result.ok, result);
  });

  await withTarget(async (root) => {
    const rel = writeTicket(root, "feat", "01", "demo", "FAILED", "None");
    commitTickets(root);
    const ticket = ticketOf(root, "feat/01");
    const result = await beginTicket(root, ticket);
    const wt = join(root, ticket.worktreeRel);
    expectEqual("neither-exists Status", statusOf(root, rel), "RUNNING");
    expect("neither-exists Worktree", existsSync(wt), wt);
    expectEqual("neither-exists from Main HEAD", gitC(wt, "rev-parse", "HEAD"), gitC(root, "rev-parse", "HEAD"));
    expect("result ok", result.ok, result);
  });

  await withTarget(async (root) => {
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const result = await beginTicket(root, ticketOf(root, "feat/01"));
    expectEqual("no pyproject Status", statusOf(root, rel), "RUNNING");
    expect("no pyproject skips .venv", !existsSync(join(result.worktree, ".venv")));
    expect("no pyproject ok", result.ok, result);
  });

  await withTarget(async (root) => {
    const pyproject = `[project]\nname = "wt"\nversion = "0.1.0"\nrequires-python = ">=3.11"\ndependencies = []\n`;
    writeFileSync(join(root, "pyproject.toml"), pyproject);
    execFileSync("uv", ["lock"], { cwd: root, encoding: "utf8" });
    gitC(root, "add", "pyproject.toml", "uv.lock");
    gitC(root, "commit", "-m", "python project");
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const result = await beginTicket(root, ticketOf(root, "feat/01"));
    expectEqual("uv sync Status", statusOf(root, rel), "RUNNING");
    expect("uv sync created .venv", existsSync(join(result.worktree, ".venv", "bin")), result.worktree);
    expect("uv sync ok", result.ok, result);
    const porcelain = gitC(result.worktree, "status", "--porcelain");
    expect(".venv ignored after sync", !porcelain.split("\n").some((l) => l.includes(".venv")), porcelain);
  });

  await withTarget(async (root) => {
    writeFileSync(
      join(root, "pyproject.toml"),
      `[project]\nname = "wt"\nversion = "0.1.0"\nrequires-python = ">=3.11"\ndependencies = []\n`,
    );
    gitC(root, "add", "pyproject.toml");
    gitC(root, "commit", "-m", "pyproject no lock");
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const ticket = ticketOf(root, "feat/01");
    const said: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => {
      said.push(args.map(String).join(" "));
    };
    let result;
    try {
      result = await beginTicket(root, ticket);
    } finally {
      console.error = realError;
    }
    const wt = join(root, ticket.worktreeRel);
    expectEqual("uv fail Status", statusOf(root, rel), "FAILED");
    expect("uv fail Worktree kept", existsSync(wt), wt);
    // The env sync is the one FAILED cause that used to print nothing at all: the reason lived in a
    // BeginResult field no caller read. It is recorded now, at the owner.
    expect(
      "uv fail says why",
      (said[0] ?? "").startsWith("feat/01 FAILED: uv sync --frozen failed:"),
      said.join(" | "),
    );
    expectEqual("uv fail stamp", gitC(root, "log", "-1", "--format=%s"), "orchestrator: feat/01 Status FAILED");
    expect("RUNNING then FAILED", gitC(root, "log", "-1", "--format=%s", "HEAD~1").includes("Status RUNNING"));
    expect("result not ok", result.ok === false, result);
    expectEqual("uv fail outcome", result.outcome, "failed");
    expect("branch kept", gitC(root, "rev-parse", "--verify", ticket.branch).length > 0);
  });

  await withTarget(async (root) => {
    writeFileSync(join(root, "conflict.txt"), "base\n");
    gitC(root, "add", "conflict.txt");
    gitC(root, "commit", "-m", "base conflict file");
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const ticket = ticketOf(root, "feat/01");
    const wt = addTicketWorktree(root, ticket);
    commitFile(wt, "conflict.txt", "from-agent\n", "agent conflict");
    writeFileSync(join(wt, "untracked.txt"), "keep\n");
    writeFileSync(join(root, rel), "# 01\n\n**Blocked by:** None\n\nStatus: FAILED\n");
    gitC(root, "add", rel);
    gitC(root, "commit", "-m", "orchestrator: feat/01 Status FAILED");
    writeFileSync(join(root, "conflict.txt"), "from-main\n");
    gitC(root, "add", "conflict.txt");
    gitC(root, "commit", "-m", "main conflict");
    const result = await beginTicket(root, ticketOf(root, "feat/01"));
    expectEqual("resume-conflict Status stays RUNNING", statusOf(root, rel), "RUNNING");
    expectEqual("resume-conflict outcome", result.outcome, "resolve");
    expect("resume-conflict not ok-ready", result.ok === false, result);
    expect("MERGE_HEAD present", gitC(wt, "rev-parse", "-q", "--verify", "MERGE_HEAD").length > 0);
    expectEqual("untracked kept through conflict", readFileSync(join(wt, "untracked.txt"), "utf8"), "keep\n");
    expect("Main stays clean of MERGE_HEAD", (() => {
      try {
        gitC(root, "rev-parse", "-q", "--verify", "MERGE_HEAD");
        return false;
      } catch {
        return true;
      }
    })());
  });

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
}
