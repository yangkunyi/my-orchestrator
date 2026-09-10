# Spec: Coding Orchestrator

Git-aware scheduler for coding-agent work. A Ticket starts only from the Main commit that already contains every merged Baseline Dependency. The Orchestrator does not read diffs or judge code quality.

Glossary: `CONTEXT.md`. Decisions: `docs/adr/`. Module split after the fact: `.scratch/architecture/`.

This Feature records the product that shipped. Tickets are MERGED historical slices, not new work.

Operator surface, leftover rematch by merge commit, and FAILED Worktree resume: `.scratch/operator-surface/spec.md` (ADR-0029–0031).

## Not Archon

The Orchestrator is a small TypeScript program in this repository (`orchestrator` on PATH). It is not Archon and not an Archon workflow pack.

Archon child worktrees start from `origin/<base>`, while merge-one only updates local Main — the next Worktree would start from the wrong commit. This tool also wants a concurrency cap and to pick the agent. Those three beat wrapping Archon.

ADR-0001, ADR-0006, ADR-0019.

## Target and Main

This repo is the tool. It schedules a **Target** git repo given as a required path. Tickets, Worktrees, and Main live in the Target.

Merge only to local Main. Do not push origin. Worktrees are created from that local HEAD.

Orchestrator commits (merge + Status follow-up) use the Target's `user.name` / `user.email`. No synthetic bot author.

Refuse to start if Target Main is dirty. Merge and Status writes happen on Main.

ADR-0002, ADR-0004, ADR-0013, ADR-0020.

## Ticket and Feature

**Feature** is a grouping: `.scratch/<slug>/` plus `spec.md`. Not a scheduler node.

**Ticket** is one DAG node: `.scratch/<feature>/issues/<NN>-<slug>.md` with no wayfinder `Type:` (`research` / `prototype` / `grilling` / `task`). Missing `Type:` means implementation. Id is `<feature>/<NN>`.

One Ticket = one branch `ticket/<feature>/<NN>-<slug>` + one Worktree `worktrees/<feature>-<NN>-<slug>` + one Implementation Agent run.

**Baseline Dependency** is declared as `Blocked by`. Not inferred from code. Same-Feature may use `NN` alone; cross-Feature must use `<feature>/<NN>`.

The Orchestrator does not store a DAG. Each scheduling cycle scans current `.scratch/*/issues/*.md`. Status on those files is node state.

ADR-0005, ADR-0008, ADR-0009, ADR-0011, ADR-0018.

## Status

One `Status:` line. Values: `BLOCKED` → `READY` → `RUNNING` → `MERGING` → (`CONFLICT` → `RESOLVING` → `MERGING`) → `MERGED` | `FAILED`.

`/to-tickets` writes `BLOCKED` or `READY`. The Orchestrator writes every later value. `/implement` and the Conflict Agent leave Status alone.

Startable means Status is `READY` and every blocker is `MERGED`. `BLOCKED` with all blockers `MERGED` is stamped `READY` under the same lock as the start batch, then a Worktree is created from current Main HEAD.

`MERGED` and `FAILED` are follow-up commits on Main (not in the merge commit, not on the Ticket branch). `MERGED` is the only state that unblocks dependents.

ADR-0007 superseded by ADR-0010. ADR-0016.

Wayfinder still uses `claimed` / `resolved`. Triage five roles stay on incoming issues, not on implementation Tickets.

## Git contract (one Ticket)

Stamp `RUNNING` on Main, then create the Worktree from that HEAD.

After the agent, FAILED if: dirty Worktree; no commits on the ticket branch that **current** Main does not have; empty merge (HEAD unchanged); merge still broken after integrating Main or after the Conflict Agent.

A merge that creates a commit on Main is MERGED; then Status follow-up; then Worktree and branch removed.

On conflict: abort on Main so Main stays clean. If Main then integrates into the Worktree cleanly, `tryMerge` again while the lock is still held. Conflict Agent runs only when that integrate leaves a conflict in the Worktree.

Leftover in-flight (`RUNNING` / `MERGING` / `CONFLICT` / `RESOLVING`) at Run start: ticket branch already an ancestor of Main → `MERGED` (Worktree removed); else `FAILED` (Worktree kept).

Merges onto Main are serial (`withMergeLock` on the Target git dir). Agent sessions may run in parallel up to `concurrency`.

Git runs as `execFile("git", args, { cwd })`. `ok` is exit 0. simple-git treated a merge conflict as success and `tryMerge` returned `"empty"` while leaving `MERGE_HEAD`.

Do not compare the ticket branch to a Main SHA taken before the RUNNING stamp. Do not treat "Already up to date" as MERGED. Do not return retry to the scheduler so rematch happens after the lock is released.

ADR-0012, ADR-0017, ADR-0023, ADR-0028.

## Worktree environment

If the Worktree has `pyproject.toml`, run `uv sync --frozen` after create (lock already released) and before every agent session. Fail → Ticket FAILED, Worktree kept. No `--extra` / `--all-extras`. No `PYTHONPATH`.

That session's bash PATH prepends `{worktree}/.venv/bin`. The Run process PATH does not include Main `.venv`. Concurrent Tickets must not share one Run `process.env.PATH`.

`.venv/` and `worktrees/` are gitignored (Main-commit helper if the line is missing).

ADR-0026 superseded by ADR-0027.

## Run, Inspect, config

One Orchestrator process on a Target is a **Run**, with an id at start. Records: Target `.scratch/orchestrator/runs/<id>/` (gitignored): `meta.json`, `events.log` (pino JSON), `dag.json` (inspect copy, not the scheduling source), `pid`, `stdout.log`, Pi sessions.

`--detach` spawns a child, writes pid, prints `run <id> detached`, exits. One live Run per Target; a second start is refused.

`orchestrator inspect <target> [id]` reads records. Journal writes; Inspect only reads. No id: live Run if one exists, else the list. With id: pid, DAG snapshot, role jsonl (`implement.jsonl` / `conflict.jsonl` only), events.

CLI: `orchestrator <target>` and `orchestrator inspect`. Flags `--model`, `--thinking-level`, `--concurrency` override Target `.scratch/orchestrator.yaml`. `httpProxy` is YAML-only.

Missing keys: Pi's default model, `thinkingLevel: high`, `concurrency: 4`, no `httpProxy`.

`httpProxy` is copied into the Run env. The process starts with `NODE_USE_ENV_PROXY=1` so Pi's `fetch` uses `HTTP_PROXY` (clash on this machine: `http://127.0.0.1:23379`).

Parsing is `cac`. Detach is Node `spawn({ detached: true })`.

ADR-0015, ADR-0021, ADR-0022, ADR-0025.

## Agents

Implementation Agent and Conflict Agent are in-process `@earendil-works/pi-coding-agent` sessions (`createAgentSession`), cwd = Worktree.

Implementation prompt: `/skill:implement` plus the Ticket path; implement criteria, commit, leave Status unchanged.

Conflict prompt: `/skill:resolving-merge-conflicts` plus the Ticket path. Resolve and commit. Do not declare MERGED. Do not re-run the full implement loop.

Sessions: `.scratch/orchestrator/runs/<id>/sessions/<ticket-id>/<role>.jsonl`. `SessionManager.open` on that path.

ADR-0003, ADR-0024.

## Drain

`prepareTarget` once at Run start (clean Main, gitignore lines). Recover leftovers. Then loop: promote BLOCKED→READY when blockers are MERGED; start up to `concurrency` READY Tickets; each Ticket is `executeTicket` (Worktree + agent + Git contract) to MERGED or FAILED.

FAILED does not stop the Run. Dependents stay BLOCKED. Other READY Tickets still start. A human may set Status back to `READY` to retry. No auto-retry.

ADR-0014.

## Modules

Names on files (Feature `architecture`, commit `601bde6`):

| CONTEXT name | File |
| --- | --- |
| Git (raw) | `src/git.ts` |
| Git contract | `src/contract.ts` |
| Status stamp | `src/status.ts` |
| Worktree env | `src/worktree.ts` |
| Ticket scan | `src/tickets.ts` |
| Drain | `src/run.ts` |
| Run records + process | `src/journal.ts` |
| Inspect | `src/inspect.ts` |
| Implementation / Conflict Agent | `src/agent.ts` |
| CLI | `src/cli.ts` |
| YAML config | `src/config.ts` |

Leftover: `ensureGitignoreLine` still takes `withMergeLock`; ALS re-entry stays so `stamp` can nest under the contract lock. See `architecture/01`.

## ADR index

| ADR | Decision |
| --- | --- |
| 0001 | Thin scheduler, not Archon |
| 0002 | Tool operates on a Target path |
| 0003 | Pi SDK is the agent runtime |
| 0004 | Merge only to local Main |
| 0005 | DAG node is a Ticket file |
| 0006 | Orchestrator is TypeScript |
| 0007 | Superseded by 0010 |
| 0008 | `Blocked by` may cross Feature folders |
| 0009 | Implementation Tickets only (skip wayfinder `Type:`) |
| 0010 | `Status:` is the Orchestrator state machine |
| 0011 | Branch `ticket/<feature>/<NN>-<slug>`; Worktree `worktrees/<feature>-<NN>-<slug>` |
| 0012 | Serial merge onto Main |
| 0013 | Refuse dirty Main |
| 0014 | FAILED blocks dependents only; Run continues |
| 0015 | YAML config + CLI overrides; `httpProxy` YAML-only |
| 0016 | Status follow-up commit on Main |
| 0017 | Remove Worktree and branch after MERGED; keep on FAILED |
| 0018 | DAG rebuilt from `.scratch` each cycle |
| 0019 | CLI name `orchestrator` |
| 0020 | Git identity from the Target |
| 0021 | Run records, `--detach`, `inspect` |
| 0022 | `cac` + pino; homemade detach / tickets / scheduler |
| 0023 | Empty merge is FAILED; compare to current Main |
| 0024 | Pi sessions under the Run dir |
| 0025 | `NODE_USE_ENV_PROXY=1` + optional `httpProxy` |
| 0026 | Superseded by 0027 |
| 0027 | Per-Worktree `uv sync --frozen` |
| 0028 | Git via `execFile`; drop simple-git |

## Out of scope

Push to origin. Review/verify as an Orchestrator stage. Inferring `Blocked by` from code. Auto-retry FAILED. A stored DAG file. Scheduling wayfinder tickets. Wrapping the `pi` CLI.
