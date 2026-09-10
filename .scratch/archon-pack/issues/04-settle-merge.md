# 04 — Settle merge

**What to build:** After the agent: dirty Worktree, no commits on the ticket branch that current Main does not have, or empty merge (HEAD unchanged) → FAILED, Worktree kept. A merge that creates a commit on Main (`orchestrator: merge ticket/…`, `--no-ff`, second parent the Ticket branch) → MERGED, Worktree removed. On conflict: abort on Main; stdout token `resolve` so the conflict node can run. Merge onto Main is serial under the pack's own lock (not the CLI lock). Git-contract FAILED is process exit 0. Stdout is exactly one token: `merged`, `failed`, or `resolve`. Logs on stderr.

**Blocked by:** 03

Status: RUNNING

- [ ] Empty merge and dirty / no-new-commit are FAILED, Worktree kept
- [ ] Successful merge commit uses the same message as the CLI so rematch agrees
- [ ] Conflict aborts Main and stdout is `resolve`
- [ ] Pack lock serializes Main writes; not the CLI lock file
- [ ] Git-contract FAILED → exit 0; stdout one token `merged` / `failed` / `resolve`
- [ ] Temp-Target tests matching empty-merge and merge-conflict repros; no live Pi
