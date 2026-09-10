# 05 Implementation Agent is only Pi

**What to build:** `agent.ts` is the Pi adapter: open the role session file, prompt, dispose, last assistant error. Worktree already prepared the cwd. Run records own on-disk session layout and listing. Git contract reads the error if it needs a FAILED reason.

**Blocked by:** 02, 04

Status: MERGED

- [x] `runPi` does not call `uv sync`. PATH prepend comes from the Worktree module (spawnHook may stay as a one-liner importing Worktree PATH).
- [x] `listRoleSessions` is not defined in `agent.ts`. Inspect already reads Run records (ticket 04).
- [x] `scripts/session-persist.mjs` and `scripts/session-error.mjs` still pass (error parse may stay next to the adapter; listing does not).
- [x] Do not change Git contract, drain scheduler, or Run detach.
- [x] `npx tsc` clean. Do not commit.

## Comments

Landed in `601bde6`. `src/agent.ts` is Pi: session file, prompt, dispose, `lastAssistantError`. `runPi` spawnHook prepends Worktree `.venv` via `prependVenvBin`. Listing lives in `journal.ts`.

## Files

Own: `src/agent.ts`.

Do not own: `src/run.ts`, `src/contract.ts`, `src/git.ts`, `src/cli.ts`, `src/journal.ts`, `src/inspect.ts`.
