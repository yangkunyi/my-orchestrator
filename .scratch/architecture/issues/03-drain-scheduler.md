# 03 Drain is only the scheduler

**What to build:** `run.ts` only opens the Target, recovers leftovers via Git contract, promotes READY, and runs up to `concurrency`. One Ticket execution function takes READY to MERGED or FAILED (Worktree + agent + Git contract). `prepareTarget` runs once, at Run start, not from both `cli.ts` and `run`.

**Blocked by:** 01, 02

Status: BLOCKED

- [ ] `runOne` / Ticket execution is not a stack of ADR lines in the drain loop. Drain does not call `uv sync` or Pi itself.
- [ ] `prepareTarget` is not invoked from `cli.ts` if `run` already calls it (or the reverse: exactly one call per process start).
- [ ] `recoverLeftovers` imported from Git contract, not `status.ts`.
- [ ] `scripts/drain-repro.mjs` still passes with injected `work` that only stamps MERGED.
- [ ] Do not change Git contract verdicts, Worktree env rules, Run detach, or Pi session layout.
- [ ] `npx tsc` clean. Do not commit.

## Files

Own: `src/run.ts`, `src/cli.ts` only to drop duplicate `prepareTarget` if it is still there.

Do not own: `src/contract.ts`, `src/git.ts`, `src/agent.ts`, `src/proxy.ts`, `src/journal.ts`, `src/inspect.ts`.
