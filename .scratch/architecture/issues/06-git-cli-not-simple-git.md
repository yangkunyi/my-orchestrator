# 06 Git CLI via execFile, not simple-git

**What to build:** Git invocations go through `execFile("git", args, { cwd })`. `ok` is process exit 0. Drop `simple-git`. `tryMerge` on a conflict must return `"conflict"` and abort so Main has no `MERGE_HEAD` — not `"empty"`.

**Blocked by:** 01.

Status: MERGED

- [x] `src/git.ts` calls `execFile("git", …)`. No `simple-git` dependency.
- [x] `ok` is exit 0. Conflict (exit 1, `CONFLICT` on stdout, empty stderr) is not treated as success.
- [x] `scripts/merge-conflict-repro.mjs` returns `"conflict"` with `MERGE_HEAD` gone after abort.
- [x] ADR-0028 written; ADR-0022 git sentence points at 0028.

## Files

Own: `src/git.ts`, `docs/adr/0028-git-cli-not-simple-git.md`, `docs/adr/0022-cac-pino-simple-git.md` (git sentence), `package.json`, `scripts/merge-conflict-repro.mjs`.

Do not own: contract verdicts, drain loop, Worktree env.

## Comments

Landed in `4366886`. simple-git 3.36.0 treated merge conflict as success (`exitCode && stdErr.length`); `tryMerge` then returned `"empty"` and left `MERGE_HEAD`. That broke endo_label 11/17 on Run `20260909T143255Z-c810`.
