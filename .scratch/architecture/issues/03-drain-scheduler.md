# 03 Drain is only the scheduler

**What to build:** `run.ts` only opens the Target, recovers leftovers via Git contract, promotes READY, and runs up to `concurrency`. One Ticket execution function takes READY to MERGED or FAILED (Worktree + agent + Git contract). `prepareTarget` runs once, at Run start, not from both `cli.ts` and `run`.

**Blocked by:** 01, 02

Status: MERGED

- [x] `runOne` / Ticket execution is not a stack of ADR lines in the drain loop. Drain does not call `uv sync` or Pi itself.
- [x] `prepareTarget` is not invoked from `cli.ts` if `run` already calls it (or the reverse: exactly one call per process start).
- [x] `recoverLeftovers` imported from Git contract, not `status.ts`.
- [x] `scripts/drain-repro.mjs` still passes with injected `work` that only stamps MERGED.
- [x] Do not change Git contract verdicts, Worktree env rules, Run detach, or Pi session layout.
- [x] `npx tsc` clean. Do not commit.

## Comments

Landed in `601bde6`. `src/run.ts`: `executeTicket` is READY → MERGED or FAILED. `prepareTarget` once at `run` start. `recoverLeftovers` from `contract.ts`.

## Files

Own: `src/run.ts`, `src/cli.ts` only to drop duplicate `prepareTarget` if it is still there.

Do not own: `src/contract.ts`, `src/git.ts`, `src/agent.ts`, `src/proxy.ts`, `src/journal.ts`, `src/inspect.ts`.
