# Coding Orchestrator

Git-aware scheduler for coding-agent work. It drains implementation **Tickets** on a **Target** git repo: start a Ticket only from the Main commit that already contains every merged dependency, run Pi in a Worktree, then merge or fail from git facts. It does not read diffs or judge code quality.

Terms: [CONTEXT.md](CONTEXT.md). Decisions: [docs/adr/](docs/adr/).

## Install

Node 22+.

```bash
npm install
npm run build
```

Put `dist/cli.js` on `PATH` as `orchestrator`, for example:

```bash
ln -sf "$(pwd)/dist/cli.js" ~/.local/bin/orchestrator
```

Pi (`@earendil-works/pi-coding-agent`) needs its usual model credentials in the environment.

## Target

The product repo, not this tool repo. Main must be clean. Tickets live at:

```
.scratch/<feature>/issues/<NN>-<slug>.md
```

Id is `<feature>/<NN>` (e.g. `auth/02`). Files with `Type: research` / `prototype` / `grilling` / `task` are skipped.

```markdown
# 02 clip registration

**Blocked by:** 01

Status: BLOCKED
```

`Blocked by: None` (or omitted) plus `Status: READY` can start immediately. Same-feature blockers may be `NN` alone; cross-feature must be `<feature>/<NN>`.

Optional config: Target `.scratch/orchestrator.yaml`. CLI flags override the file except `httpProxy` (YAML only). Missing keys: Pi's default model, `thinkingLevel: high`, `concurrency: 4`, no `httpProxy`.

```yaml
model: grok-4
thinkingLevel: high
concurrency: 4
httpProxy: http://127.0.0.1:23379
```

`httpProxy` is copied into the Run process env. The process is started with `NODE_USE_ENV_PROXY=1` so Node `fetch` uses that proxy (Pi SDK ignores `HTTP_PROXY` otherwise).

## Commands

```bash
orchestrator <target> [--detach] [--model <name>] [--thinking-level <level>] [--concurrency <n>]
orchestrator inspect <target> [id]
```

`--detach` prints a Run id and returns. One live Run per Target.

```bash
orchestrator /path/to/target --detach
orchestrator inspect /path/to/target
orchestrator inspect /path/to/target 20260909T115901Z-2673
```

Run records: Target `.scratch/orchestrator/runs/<id>/` (gitignored). Inspect lists `implement.jsonl` / `conflict.jsonl` only.

## Drain

Each cycle the DAG is rebuilt from current `.scratch/` files. Startable Tickets (blockers `MERGED`, not in-flight, not `FAILED`) run up to `concurrency`.

For one Ticket: stamp `RUNNING` on Main, create a Worktree from that HEAD, run `uv sync --frozen` in the Worktree if it has `pyproject.toml` (again before each agent session; fail → `FAILED`), run the Implementation Agent. Then:

- dirty Worktree, no commits ahead of **current** Main, empty merge, or merge still broken after the Conflict Agent → `FAILED` (Worktree kept)
- merge that creates a commit on Main → `MERGED` (Worktree removed)
- conflict on Main is aborted; Conflict Agent works in the Worktree

`FAILED` does not stop the Run. Dependents stay `BLOCKED`. A human may set `Status: READY` to retry.

Crash leftovers: if the ticket branch is already an ancestor of Main, recover as `MERGED`; otherwise `FAILED`.
