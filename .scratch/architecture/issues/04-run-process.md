# 04 Run owns the process and the records

**What to build:** One Run module: Pi-fetch env (`NODE_USE_ENV_PROXY` + optional `httpProxy`), foreground reexec vs `--detach` spawn, pid liveness, record dir. Inspect reads meta, DAG, events, and role jsonl from that dir. `cli.ts` only parses flags. Role-session listing leaves `agent.ts` so Inspect does not load the Pi SDK.

**Blocked by:** None

Status: MERGED

- [x] `childEnv` / `spawnDetachedRun` / `reexecForProxy` live next to Run records (same module or `journal.ts` + thin `proxy` kept only if it still earns the deletion test). Duplicate `NODE_USE_ENV_PROXY` checks (cli gate + reexec guard) collapse to one.
- [x] Inspect does not import `agent.ts`. Role jsonl listing (`implement.jsonl` / `conflict.jsonl` only) lives with Run records.
- [x] `inspect.ts` does not duplicate `readMeta`. Use the Journal/Run reader.
- [x] `scripts/http-proxy-repro.mjs` and `scripts/inspect-repro.mjs` still pass. `scripts/session-error.mjs` listing check still passes if it imported `listRoleSessions` — update the import.
- [x] Do not change Git contract, Worktree env, drain loop, or `runPi` prompts.
- [x] `npx tsc` clean. Do not commit.

## Comments

Landed in `601bde6`. Process + records in `src/journal.ts`. `src/proxy.ts` re-exports for scripts. `src/cli.ts` parses flags and calls `startRun`. Inspect reads `journal.ts` only.

## Files

Own: `src/cli.ts`, `src/proxy.ts`, `src/journal.ts`, `src/inspect.ts`, `src/agent.ts` only to move `listRoleSessions` out (leave a re-export if ticket 05 has not started).

Do not own: `src/contract.ts`, `src/git.ts`, `src/run.ts`, Worktree env helpers, `runPi` body.
