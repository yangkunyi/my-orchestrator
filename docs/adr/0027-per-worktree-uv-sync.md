# Per-Worktree `uv sync --frozen`

If a Worktree has `pyproject.toml`, the Orchestrator runs `uv sync --frozen` in that Worktree after create (Main-write lock already released) and again before every agent session. Failure stamps the Ticket FAILED and keeps the Worktree. The command is always `uv sync --frozen` (no `--extra` / `--all-extras`). Environment changes are Implementation Agent edits to pyproject and the lockfile, then merge to Main.

That session's bash PATH prepends `{worktree}/.venv/bin`. The Run process PATH does not include Main `.venv`. No `PYTHONPATH`. `.venv/` is gitignored with the same Main-commit helper as `worktrees/`.

`createAgentSession` has no session `env`. PATH is injected with `createBashToolDefinition` `spawnHook` so concurrent Tickets do not share one Run `process.env.PATH`.

Supersedes ADR-0026.

Rejected: extras or GPU as an Orchestrator fork; Main `.venv` on the Run PATH; `PYTHONPATH` of one Worktree on the Run; sibling worktrees instead of nested `{Target}/worktrees/<slug>/`.
