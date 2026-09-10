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
The Orchestrator's git rules for one Ticket. First start: stamp RUNNING on Main, then create the Worktree from that HEAD. Resume after FAILED: stamp RUNNING; reuse the Worktree and branch; if the tree is missing but the branch exists, recreate the Worktree from that branch, not Main; if neither exists, create from Main HEAD; integrate current Main first; uncommitted files stay. After the agent, any of these is FAILED: dirty Worktree; no commits on the ticket branch that current Main does not have; empty merge (HEAD unchanged); merge still broken after integrating Main or after the Conflict Agent. A merge that creates a commit on Main is MERGED and the Worktree is removed. On conflict, abort on Main; if Main then integrates into the Worktree cleanly, tryMerge again while the lock is still held. The Conflict Agent runs only when that integrate leaves a conflict in the Worktree (Main stays clean), including on resume. A leftover in-flight Ticket recovers as MERGED iff Main already has a merge commit of that Ticket branch (Worktree removed); otherwise FAILED (Worktree kept). Completing a Ticket is idempotent: if that merge commit exists, stamp MERGED and do not create a Worktree or merge again. Mere ancestry is not enough — the RUNNING Status commit is already on Main.
_Avoid_: comparing the ticket branch to a Main SHA taken before the RUNNING stamp; treating "Already up to date" as MERGED; treating ancestry alone as MERGED; returning retry to the scheduler so rematch happens after the lock is released; re-running the Implementation Agent when the merge commit already exists; deleting the Worktree or branch to retry FAILED; creating a resume Worktree from Main HEAD when the ticket branch still exists

## Work units

**Ticket**:
One DAG node: an implementation issue file at `.scratch/<feature>/issues/<NN>-<slug>.md` with no wayfinder `Type:` (`research` / `prototype` / `grilling` / `task`). Id is `<feature>/<NN>` (e.g. `auth/02`). One branch, one Worktree. Each start is one Implementation Agent session; Retry is another session on the same Worktree, not a new Ticket.
_Avoid_: Feature (as the scheduled unit), task, job, issue (when meaning the DAG node); a new Ticket to retry FAILED

**Feature**:
A grouping: `.scratch/<slug>/` plus its spec. Not a scheduler node.
_Avoid_: Ticket

## Roles

**Orchestrator**:
The program in this repository that manages Ticket lifecycle: DAG readiness, Worktree create/remove, git checks, merge, and Ticket Status. It does not read diffs or judge code quality. Each cycle it rebuilds the DAG from the Target's current `.scratch/` files; there is no stored graph. It is not an Archon workflow pack and does not run as Archon script nodes.
_Avoid_: agent, workflow engine, Archon; hosting the Git contract as Archon YAML with `--no-worktree`

**Run**:
One Orchestrator process draining Tickets on a Target. Created with an id at start. Records live at Target `.scratch/orchestrator/runs/<id>/` (gitignored): events, DAG snapshot, pid, Pi sessions under `sessions/<ticket-id>/`. `--detach` starts that process in the background and prints the id. That process is started with `NODE_USE_ENV_PROXY=1` so Pi's `fetch` uses `HTTP_PROXY`; Target `.scratch/orchestrator.yaml` key `httpProxy` is copied into that env when set.
_Avoid_: Ticket (a Run schedules many Tickets); Archon run

**Inspect**:
`orchestrator inspect <target> [id]` reads Run records. The Journal writes those records; Inspect only reads. No id: the currently running Run if there is one, otherwise the list of Runs. With id: that Run's pid, DAG snapshot, role session files (`implement.jsonl` / `conflict.jsonl` only), events, FAILED reason, leftover Worktree path, and next startable Tickets. `--follow` prints new events and exits when the Run has exited or the records are stale. Inspect stays read-only while a Run is live.
_Avoid_: git log as the inspect UI; listing nested Pi subagent jsonl; writing Run records from Inspect

**Retry**:
Operator action that stamps one FAILED Ticket READY when that Ticket's merge commit is not on Main. Not a Run. Refused while a Run is live. Merge commit already present: stamp MERGED instead.
_Avoid_: auto-retry; retry as a new Ticket; retry while a Run is live; Retry of a Ticket that is not FAILED

**Recover**:
Operator action that rematches leftover in-flight Tickets on a Target with no live Run. Same Git contract as leftover rematch at drain start. Not a Run.
_Avoid_: recover as a Run; recover while a Run is live

**Stop**:
Operator action that ends the live Run and then rematches leftovers (same as Recover). Not a Run.
_Avoid_: stop as FAILED-forever; aborting an in-progress merge on Main

**Implementation Agent**:
A coding-agent session whose working directory is the Ticket's Worktree. It takes one READY Ticket from start to a committed branch that is ready to merge.
_Avoid_: Orchestrator, reviewer (as an Orchestrator stage)

**Conflict Agent**:
A coding-agent session that resolves the current merge conflict, commits, and exits. It does not declare the Ticket MERGED.
_Avoid_: Implementation Agent (do not re-run the full implement loop)

## Lifecycle

**Status**:
The Orchestrator state on an implementation Ticket: `BLOCKED`, `READY`, `RUNNING`, `MERGING`, `CONFLICT`, `RESOLVING`, `MERGED`, `FAILED`. `/to-tickets` writes `BLOCKED` or `READY`; the Orchestrator writes every later value. `/implement` does not change Status.
_Avoid_: ready-for-agent, claimed, resolved (those are triage / wayfinder); a second sidecar field for "done"

**Status stamp**:
The only writer of Status after READY: the markdown Status line, a follow-up commit on Main, and the Run journal. Leftover rematch and operator retry use the same Git contract: merge commit of the Ticket branch already on Main → MERGED (Worktree removed); in-flight without that commit → FAILED (Worktree kept); FAILED without that commit → READY (no Run started).
_Avoid_: a second writer of Status after READY; removing the Worktree on FAILED; a human Status edit as the required path when the merge commit already exists

**Baseline Dependency**:
Ticket B depends on Ticket A means B must be implemented on the code state after A has been merged into Main. Declared on the Ticket as `Blocked by`; not inferred from code. Edges may cross Feature folders; the id is then `<feature>/<NN>`. Same-Feature edges may use `NN` alone.
_Avoid_: task order, blocked-by (as scheduling-only); Orchestrator discovering edges from the codebase

**BLOCKED**:
Status while at least one Baseline Dependency is not MERGED.

**READY**:
Status when every Baseline Dependency is MERGED and the Ticket is waiting to start: never started, or operator Retry from FAILED. A Ticket is startable only in this Status. BLOCKED with all blockers MERGED is stamped READY under the same lock as the start batch. First start creates a Worktree from current Main HEAD; Retry reuses the existing Worktree.
_Avoid_: unblocked (without the create-at-HEAD rule); starting a BLOCKED Ticket because its blockers are MERGED; deleting the Worktree as part of becoming READY again

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
Status when the git contract fails (dirty Worktree, no new commit, or merge still broken after the Conflict Agent). Written in a follow-up commit on Main, same as MERGED. Tickets that list this Ticket in `Blocked by` stay BLOCKED. Other READY Tickets keep running. The Orchestrator does not stop the whole run.
