# 03 — Worktree begin / resume

**What to build:** First start (READY, no tree, no branch): stamp RUNNING, create the Worktree from Main HEAD. FAILED resume: stamp RUNNING, reuse the Worktree and branch, integrate current Main first, keep uncommitted files (no `git reset --hard`). Missing tree with branch: recreate the Worktree from that branch, not Main. Neither exists: first-start from Main HEAD. If `pyproject.toml` is present, `uv sync --frozen` after create and before every agent session; fail that command → Ticket FAILED, Worktree kept.

**Blocked by:** 02

Status: MERGED

- [ ] First start creates the Worktree from Main HEAD after the RUNNING stamp
- [ ] FAILED resume reuses tree and branch, integrates current Main, keeps dirty files
- [ ] Missing tree with existing branch recreates from the branch
- [ ] `uv sync --frozen` when `pyproject.toml` is present; failure is FAILED, Worktree kept
- [ ] Temp-Target tests; no live Pi
