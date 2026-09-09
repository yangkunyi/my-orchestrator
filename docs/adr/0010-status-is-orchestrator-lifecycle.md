# Implementation Ticket Status is the Orchestrator state machine

One `Status:` line on the Ticket file holds `BLOCKED` → `READY` → `RUNNING` → `MERGING` → (`CONFLICT` → `RESOLVING` → `MERGING`) → `MERGED` | `FAILED`.

`/to-tickets` writes `BLOCKED` or `READY`. The Orchestrator writes every later value, and writes `MERGED` only after `git merge` into Main succeeds. `/implement` and the Conflict Agent leave Status alone.

Global `/to-tickets` writes this Status machine and allows cross-Feature `Blocked by` (`<feature-slug>/<NN>`). Wayfinder tickets still use `claimed` / `resolved`. Triage's five roles stay on incoming issues, not on implementation Tickets.

Rejected: a sidecar `Merged:` field; `resolved` as the done mark (wayfinder word); git-only after deleting the branch; keeping local `/to-tickets` on `ready-for-agent`.
