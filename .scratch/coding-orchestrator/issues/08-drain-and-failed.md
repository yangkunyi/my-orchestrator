# 08 Drain loop and FAILED

**What to build:** one Run drains implementation Tickets on a Target. `prepareTarget` once (clean Main, gitignore). Recover leftovers. Loop: stamp BLOCKED→READY when blockers are MERGED; run up to `concurrency` READY Tickets; each Ticket is one execution function (Worktree + agent + Git contract) to MERGED or FAILED.

FAILED does not stop the Run. Tickets that list the FAILED Ticket in `Blocked by` stay BLOCKED. Other READY Tickets still start. No auto-retry. A human may set Status back to `READY`; the next Run recreates the Worktree from current Main HEAD.

**Blocked by:** 04, 07

Status: MERGED

- [x] Drain is the scheduler only; it does not judge code (ADR-0001, CONTEXT Orchestrator)
- [x] FAILED blocks dependents only (ADR-0014)
- [x] Leftover recovery at Run start (CONTEXT Status stamp)
- [x] `executeTicket` is READY → MERGED or FAILED (`src/run.ts`)

## Comments

Landed in `22bc3c6`; drain deepen `5189bda`; module split `601bde6`. Loop in `src/run.ts`.

Module alignment: `architecture/03`.

Rejected: abort the whole Run on first FAILED; auto-retry.
