# 02 Worktree owns lifetime and environment

**What to build:** A Worktree module: create from Main HEAD, make the tree ready for the agent (`uv sync --frozen` if `pyproject.toml`; that session's bash PATH is `{worktree}/.venv/bin`), remove after MERGED. Implementation Agent receives a cwd that is already that environment. Run process PATH does not gain Main `.venv`.

ADR-0027 is already in the working tree (`syncWorktreeEnv`, `prependVenvBin`, bash `spawnHook`, `ensureVenvIgnored`, `childEnv` without Main venv). Move that behavior into the Worktree module. Do not re-implement uv sync. Do not reopen ADR-0026.

**Blocked by:** None

Status: READY

- [ ] New module (one file is enough) owns sync + PATH prepend. `agent.ts` may re-export for one cycle so `run.ts` / `runPi` still compile (tickets 03 / 05 delete the re-export).
- [ ] Create/remove still use `git.ts` primitives. This ticket does not change merge-lock ownership (ticket 01).
- [ ] `uv sync --frozen` after create (lock already released) and before each agent session remains the rule. Failure throws; caller stamps FAILED and keeps the Worktree.
- [ ] Skip when no `pyproject.toml`. No `--extra` / `--all-extras`. No `PYTHONPATH`.
- [ ] `scripts/venv-path-check.mjs` still passes: Run `childEnv` PATH has no Main `.venv`; sync `--frozen` creates Worktree `.venv`; no pyproject skips; missing lockfile throws.
- [ ] Do not rewrite `run.ts` (ticket 03 wires create → ready). Do not shrink `runPi` to Pi-only (ticket 05).
- [ ] `npx tsc` clean. Do not commit.

## Files

Own: new Worktree module file, `src/agent.ts` only to move/re-export env helpers, `scripts/venv-path-check.mjs` if imports change.

Do not own: `src/contract.ts`, `src/status.ts`, `src/run.ts`, `src/cli.ts`, `src/proxy.ts`, `src/journal.ts`, `src/inspect.ts`. Do not change `withMergeLock` behavior in `git.ts`.
