# Operator actions are not Runs; stay this program

`orchestrator retry`, `recover`, and `stop` stamp Status and rematch leftovers. They are not Runs. While a Run is live: retry and recover refuse; Inspect stays read-only; stop sends SIGTERM to the live Run then rematches leftovers (same function as recover). Retry takes one Ticket id; recover rematches all leftovers; stop ends the whole Run.

Hosting the Git contract as Archon script nodes with `--no-worktree` was considered again. Archon isolation still cuts child worktrees from `origin/<base>` and does not merge to local Main, so the Git contract would still be ours plus two recovery stories. UI, Slack, and approval gates are out of the first operator spec.

Rejected: retry as a drain; wrapping Archon as the YAML host (ADR-0001 still holds).
