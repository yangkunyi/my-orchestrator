# 04 Run owns the process and the records

**What to build:** One Run module: Pi-fetch env (`NODE_USE_ENV_PROXY` + optional `httpProxy`), foreground reexec vs `--detach` spawn, pid liveness, record dir. Inspect reads meta, DAG, events, and role jsonl from that dir. `cli.ts` only parses flags. Role-session listing leaves `agent.ts` so Inspect does not load the Pi SDK.

**Blocked by:** None

Status: READY

- [ ] `childEnv` / `spawnDetachedRun` / `reexecForProxy` live next to Run records (same module or `journal.ts` + thin `proxy` kept only if it still earns the deletion test). Duplicate `NODE_USE_ENV_PROXY` checks (cli gate + reexec guard) collapse to one.
- [ ] Inspect does not import `agent.ts`. Role jsonl listing (`implement.jsonl` / `conflict.jsonl` only) lives with Run records.
- [ ] `inspect.ts` does not duplicate `readMeta`. Use the Journal/Run reader.
- [ ] `scripts/http-proxy-repro.mjs` and `scripts/inspect-repro.mjs` still pass. `scripts/session-error.mjs` listing check still passes if it imported `listRoleSessions` — update the import.
- [ ] Do not change Git contract, Worktree env, drain loop, or `runPi` prompts.
- [ ] `npx tsc` clean. Do not commit.

## Files

Own: `src/cli.ts`, `src/proxy.ts`, `src/journal.ts`, `src/inspect.ts`, `src/agent.ts` only to move `listRoleSessions` out (leave a re-export if ticket 05 has not started).

Do not own: `src/contract.ts`, `src/git.ts`, `src/run.ts`, Worktree env helpers, `runPi` body.
