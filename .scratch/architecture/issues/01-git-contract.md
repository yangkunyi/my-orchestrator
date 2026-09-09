# 01 Git contract owns the verdict and the Main-write lock

**What to build:** One Git contract module owns begin, post-agent verdict, rematch while the lock is held, leftover recovery, MERGED vs FAILED, and Worktree keep/remove. `git.ts` stays raw git and does not decide Status. Git write helpers assume the caller already holds the lock; drop nested `withMergeLock` plus AsyncLocalStorage re-entry. `status.ts` shrinks to Status stamp only.

**Blocked by:** None

Status: READY

- [ ] `recoverLeftovers` lives in the Git contract module, not `status.ts`. `status.ts` may re-export for one cycle so `run.ts` can stay untouched (ticket 03 deletes the re-export).
- [ ] `settleAfterAgent` and `settleAfterConflict` share one ok / empty / fail / remove path. No copied block.
- [ ] `tryMerge` still reports `"ok" | "conflict" | "failed" | "empty"` as git facts. Status is decided only in the contract.
- [ ] Git helpers that write Main (`commitFiles`, `tryMerge`, `createWorktree`, `removeWorktreeAndBranch`, `ensureGitignoreLine`) do not take the lock themselves. `withMergeLock` is held at contract / scheduler / stamp.
- [ ] `hasCommitsAhead` vs current Main and `tryMerge` `"empty"` both stay (ADR-0023). They are one named step inside the contract, not two unrelated callers.
- [ ] Existing `scripts/empty-merge-repro.mjs` and `scripts/leftover-merged-repro.mjs` still pass. Add the smallest check that leftover whose branch is not in Main becomes FAILED and keeps the Worktree.
- [ ] Do not edit `run.ts` except if a re-export forces an import path — prefer no `run.ts` change.
- [ ] Do not invent Worktree env, Run process, or Pi adapter work (tickets 02 / 04 / 05).
- [ ] `npx tsc` clean. Do not commit.

## Files

Own: `src/contract.ts`, `src/status.ts`, `src/git.ts` (lock ownership only), `scripts/empty-merge-repro.mjs`, `scripts/leftover-merged-repro.mjs`.

Do not own: `src/run.ts`, `src/agent.ts`, `src/cli.ts`, `src/proxy.ts`, `src/journal.ts`, `src/inspect.ts`.
