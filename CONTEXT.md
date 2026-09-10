# Coding Orchestrator

A Git-aware scheduler that runs coding-agent work as a baseline-dependency DAG: a Ticket starts only from the Main commit that already contains every merged incoming dependency.

## Git

**Target**:
The git repository the Orchestrator schedules. Tickets, Worktrees, and Main live there.
_Avoid_: this repo (the tool), workspace (when meaning the product under development)

**Main**:
The Target's integration branch. A MERGED Ticket is merged into Main. A first-start Worktree is created from Main's HEAD at that start.
_Avoid_: origin/main (as the required start point), develop, trunk (unless that name is Main for the run)

**Worktree**:
A temporary git worktree for one Ticket. First start creates it from Main HEAD. After FAILED, the same Worktree and branch are reused: current Main is integrated first; uncommitted files stay. Removed only after MERGED. If `pyproject.toml` is present, `uv sync --frozen` runs after create and before every agent session; that session's bash uses this Worktree's `.venv`, not Main's. Fail that command: Ticket FAILED, Worktree kept.
_Avoid_: working copy, clone, sandbox (as a lasting source of truth); sharing Main `.venv` across Worktrees; putting Main `.venv` on the Run PATH; `PYTHONPATH` of one Worktree on the Run process; deleting the Worktree to retry FAILED; `git reset --hard` on resume

**Git contract**:
The Orchestrator's git rules for one Ticket. First start: stamp RUNNING on Main, then create the Worktree from that HEAD. After FAILED, the next drain may start that Ticket again: stamp RUNNING; reuse the Worktree and branch; if the tree is missing but the branch exists, recreate the Worktree from that branch, not Main; if neither exists, create from Main HEAD; integrate current Main first; uncommitted files stay. A Ticket this drain just stamped FAILED is not started again in this drain. After the agent, any of these is FAILED: dirty Worktree; no commits on the ticket branch that current Main does not have; empty merge (HEAD unchanged); merge still broken after integrating Main or after the Conflict Agent. A merge that creates a commit on Main is MERGED and the Worktree is removed. On conflict, abort on Main; if Main then integrates into the Worktree cleanly, tryMerge again while the lock is still held. The Conflict Agent runs only when that integrate leaves a conflict in the Worktree (Main stays clean), including on resume. A leftover in-flight Ticket recovers as MERGED iff Main already has a merge commit of that Ticket branch (Worktree removed); otherwise FAILED (Worktree kept). Completing a Ticket is idempotent: if that merge commit exists, stamp MERGED and do not create a Worktree or merge again. Mere ancestry is not enough — the RUNNING Status commit is already on Main.
_Avoid_: comparing the ticket branch to a Main SHA taken before the RUNNING stamp; treating "Already up to date" as MERGED; treating ancestry alone as MERGED; returning retry to the scheduler so rematch happens after the lock is released; re-running the Implementation Agent when the merge commit already exists; deleting the Worktree or branch to start FAILED again; creating a resume Worktree from Main HEAD when the ticket branch still exists; starting a Ticket again in the same drain after this drain stamped it FAILED; a retry command that stamps READY

## Work units

**Ticket**:
One DAG node: an implementation issue file at `.scratch/<feature>/issues/<NN>-<slug>.md` with no wayfinder `Type:` (`research` / `prototype` / `grilling` / `task`). Id is `<feature>/<NN>` (e.g. `auth/02`). One branch, one Worktree. Each start is one Implementation Agent session; the next drain's start of a FAILED Ticket is another session on the same Worktree, not a new Ticket.
_Avoid_: Feature (as the scheduled unit), task, job, issue (when meaning the DAG node); a new Ticket to start FAILED again

**Feature**:
A grouping: `.scratch/<slug>/` plus its spec. Not a scheduler node.
_Avoid_: Ticket

## Roles

**Orchestrator**:
The program in this repository that manages Ticket lifecycle: DAG readiness, Worktree create/remove, git checks, merge, and Ticket Status. It does not read diffs or judge code quality. Each cycle it rebuilds the DAG from the Target's current `.scratch/` files; there is no stored graph. It is not an Archon workflow pack and does not run as Archon script nodes.
_Avoid_: agent, workflow engine, Archon; hosting the Git contract as Archon YAML inside this CLI

**Archon pack**:
A second runner of the same Ticket DAG and Git contract, started on a Target with `archon workflow run`. Not the Orchestrator. Not a Run. Source is this repository's `.archon/workflows/ticket-dag/`, copied to `~/.archon/workflows/` (global). Pack bun TypeScript scripts reimplement the Git contract; they do not import this repository's TypeScript. Public drain is `ticket-dag-drain`: leftover rematch, then a loop of startable Tickets. Each Ticket is two script nodes (implement, then conflict if settle is resolve) — two Pi SDK sessions, not parent/child, cwd the Ticket Worktree, not Archon `prompt:` and not a spawned `pi` CLI. Drain may run more than one Ticket at a time; merge onto Main stays serial under the pack's lock. Inspect is Archon's run records, not `orchestrator inspect`. Mutual exclusion with a CLI Run is convention. Stop is `archon workflow cancel`; leftover rematch is the next drain's first node. There is no pack retry or recover workflow.
_Avoid_: calling the pack the Orchestrator; wrapping this CLI as an Archon node; static YAML nodes per Ticket; Archon `isolation: worktree` as the Ticket Worktree; importing `src/` or `dist/` from this repository; writing Orchestrator Run records from the pack; nested `archon workflow run` per Ticket; Archon `prompt:` for implement/conflict; Python pack scripts; Claude as the pack agent; spawning `pi -p`

**ticket-dag.yaml**:
The Archon pack's config on the Target at `.scratch/ticket-dag.yaml`: `model`, `thinkingLevel`, `concurrency`. Not `orchestrator.yaml`. A drain may pass another path as the Archon `config` input (default this file). Missing file: Pi's default model, `thinkingLevel: high`, `concurrency: 4`.
_Avoid_: orchestrator.yaml (as pack config); Archon project assistant settings (as pack model)

**Run**:
One Orchestrator process draining Tickets on a Target. Created with an id at start. Records live at Target `.scratch/orchestrator/runs/<id>/` (gitignored): events, DAG snapshot, pid, Pi sessions under `sessions/<ticket-id>/`. `--detach` starts that process in the background and prints the id. That process is started with `NODE_USE_ENV_PROXY=1` so Pi's `fetch` uses `HTTP_PROXY`; Target `.scratch/orchestrator.yaml` key `httpProxy` is copied into that env when set.
_Avoid_: Ticket (a Run schedules many Tickets); Archon run

**Inspect**:
`orchestrator inspect <target> [id]` reads Run records. The Journal writes those records; Inspect only reads. No id: the currently running Run if there is one, otherwise the list of Runs. With id: that Run's pid, DAG snapshot, role session files (`implement.jsonl` / `conflict.jsonl` only), events, FAILED reason, leftover Worktree path, and next startable Tickets. `--follow` prints new events and exits when the Run has exited or the records are stale. Inspect stays read-only while a Run is live.
_Avoid_: git log as the inspect UI; listing nested Pi subagent jsonl; writing Run records from Inspect

**Retry**:
Not a command. The next drain starts a FAILED Ticket when Main has no merge commit of that Ticket branch and this drain has not already attempted that id. Same Worktree. A Ticket this drain just stamped FAILED is not started again in this drain. FAILED with a merge commit already on Main is stamped MERGED (no agent).
_Avoid_: `orchestrator retry`; a pack retry workflow; starting a just-failed Ticket again in the same drain; a new Ticket to start FAILED again

**Recover**:
Operator action that rematches leftover in-flight Tickets on a Target with no live Run. Same Git contract as leftover rematch at drain start. Not a Run.
_Avoid_: recover as a Run; recover while a Run is live

**Stop**:
Operator action that ends the live Run and then rematches leftovers (same as Recover). Not a Run.
_Avoid_: stop as FAILED-forever; aborting an in-progress merge on Main

**Implementation Agent**:
A coding-agent session whose working directory is the Ticket's Worktree. It takes one startable Ticket from start to a committed branch that is ready to merge. The Orchestrator starts it with Pi. The Archon pack starts it with the Pi SDK (`createAgentSession`) in pack bun scripts, cwd the Worktree.
_Avoid_: Orchestrator, reviewer (as an Orchestrator stage); Archon project assistant (as the pack agent)

**Conflict Agent**:
A coding-agent session that resolves the current merge conflict, commits, and exits. It does not declare the Ticket MERGED. Same split: Pi under the Orchestrator; Pi SDK under the Archon pack.
_Avoid_: Implementation Agent (do not re-run the full implement loop)

## Lifecycle

**Status**:
The Orchestrator state on an implementation Ticket: `BLOCKED`, `READY`, `RUNNING`, `MERGING`, `CONFLICT`, `RESOLVING`, `MERGED`, `FAILED`. `/to-tickets` writes `BLOCKED` or `READY`; the Orchestrator or the Archon pack writes every later value. `/implement` does not change Status.
_Avoid_: ready-for-agent, claimed, resolved (those are triage / wayfinder); a second sidecar field for "done"

**Status stamp**:
The markdown Status line plus a follow-up commit on Main. Leftover rematch uses the Git contract: merge commit of the Ticket branch already on Main → MERGED (Worktree removed); in-flight without that commit → FAILED (Worktree kept). FAILED without that commit is startable on the next drain (no READY stamp required). One writer process at a time on a Target: either one Orchestrator Run or one Archon pack run, not both. That exclusion is convention: the Orchestrator does not detect a pack run.
_Avoid_: two Status writers live on one Target; removing the Worktree on FAILED; a human Status edit as the required path when the merge commit already exists; stamping READY as the only way to start FAILED again

**Baseline Dependency**:
Ticket B depends on Ticket A means B must be implemented on the code state after A has been merged into Main. Declared on the Ticket as `Blocked by`; not inferred from code. Edges may cross Feature folders; the id is then `<feature>/<NN>`. Same-Feature edges may use `NN` alone.
_Avoid_: task order, blocked-by (as scheduling-only); Orchestrator discovering edges from the codebase

**BLOCKED**:
Status while at least one Baseline Dependency is not MERGED.

**READY**:
Status when every Baseline Dependency is MERGED and the Ticket has never started. BLOCKED with all blockers MERGED is stamped READY under the same lock as the start batch. First start creates a Worktree from current Main HEAD.
_Avoid_: unblocked (without the create-at-HEAD rule); starting a BLOCKED Ticket because its blockers are MERGED; treating READY as the only startable Status

**startable**:
A Ticket this drain may begin: every blocker is MERGED, Main has no merge commit of that Ticket branch, this drain has not already attempted that id, and Status is READY or FAILED. First start (READY, no tree, no branch) creates the Worktree from Main HEAD. FAILED reuses the Worktree.
_Avoid_: starting BLOCKED; starting a Ticket this drain already stamped FAILED; treating ancestry as complete

**RUNNING**:
Status while the Implementation Agent session is live.

**MERGING**:
Status while the Orchestrator is merging the Ticket branch into Main.

**CONFLICT**:
Status when `git merge` left a conflict (`MERGE_HEAD` present).

**RESOLVING**:
Status while the Conflict Agent session is live.

**MERGED**:
Status written only after the Ticket branch is in Main, in a follow-up commit on Main (not in the merge commit, not on the Ticket branch). The only state that unblocks downstream Tickets. The next Orchestrator run skips this Ticket.
_Avoid_: done, completed, implemented, resolved (as the unlock signal)

**FAILED**:
Status when the git contract fails (dirty Worktree, no new commit, or merge still broken after the Conflict Agent). Written in a follow-up commit on Main, same as MERGED. Worktree kept. Tickets that list this Ticket in `Blocked by` stay BLOCKED. Other startable Tickets keep running. This drain does not start this Ticket again. The next drain may. The Orchestrator does not stop the whole run.
_Avoid_: deleting the Worktree on FAILED; auto-starting this Ticket again in the same drain; a retry command
