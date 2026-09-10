# 04 Git contract

**What to build:** stamp `RUNNING` on Main, then create the Worktree from that HEAD. After the agent: dirty Worktree, no commits ahead of **current** Main, empty merge (HEAD unchanged), or merge still broken after integrating Main / Conflict Agent → `FAILED`. A merge that creates a commit on Main → `MERGED`, then Status follow-up commit on Main, then remove Worktree and branch.

On conflict: abort on Main; if Main integrates into the Worktree cleanly, `tryMerge` again while the lock is held. Conflict Agent only when that integrate conflicts. Main stays clean.

Leftover in-flight at Run start: branch already ancestor of Main → `MERGED` (Worktree removed); else `FAILED` (Worktree kept).

Merges onto Main are serial. Git via `execFile("git", args, { cwd })`; `ok` is exit 0.

**Blocked by:** 03

Status: MERGED

- [x] Serial Main merge lock (ADR-0012)
- [x] Status follow-up commit on Main; agent does not write Status (ADR-0016)
- [x] Empty merge is FAILED; compare to current Main, not pre-RUNNING SHA (ADR-0023)
- [x] Remove Worktree and branch after MERGED; keep on FAILED (ADR-0017)
- [x] Git CLI `execFile`; drop simple-git (ADR-0028)
- [x] Leftover in-flight rematch (CONTEXT Git contract)

## Comments

Landed across `22bc3c6`, `5189bda` (rematch / leftover), `4366886` (ADR-0028). Verdicts in `src/contract.ts`; raw git in `src/git.ts`.

Module alignment: `architecture/01`. Git CLI ticket: `architecture/06`.

Leftover: `ensureGitignoreLine` still takes the lock; ALS re-entry kept so `stamp` can nest.
