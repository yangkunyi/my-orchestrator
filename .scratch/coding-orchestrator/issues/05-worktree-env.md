# 05 Worktree lifetime and environment

**What to build:** a Worktree is a temporary git worktree for one Ticket, created from Main HEAD after `RUNNING`, removed after `MERGED`. Not the long-lived source of truth.

If the Worktree has `pyproject.toml`, run `uv sync --frozen` after create (lock already released) and before every agent session. Fail → Ticket FAILED, Worktree kept. No `--extra` / `--all-extras`. No `PYTHONPATH`. Session bash PATH prepends `{worktree}/.venv/bin`. Run process PATH does not include Main `.venv`. PATH injected per bash spawn so concurrent Tickets do not share one Run `process.env.PATH`.

**Blocked by:** 04

Status: MERGED

- [x] Names from Ticket id (ADR-0011)
- [x] Remove after MERGED; keep on FAILED (ADR-0017)
- [x] Per-Worktree `uv sync --frozen` (ADR-0027; ADR-0026 superseded)
- [x] `.venv/` gitignored on Main

## Comments

ADR-0027 landed in `601bde6` (`src/worktree.ts`). ADR-0026 (Main `.venv` on Run PATH) is dead.

Module alignment: `architecture/02`.
