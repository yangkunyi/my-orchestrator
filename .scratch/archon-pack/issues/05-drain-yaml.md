# 05 — Drain YAML

**What to build:** Public entry `ticket-dag-drain` only. Live checkout (`worktree.enabled: false`). First node rematches leftovers (`always_run`). Then a loop (hard cap 500) until pick is empty: each iteration takes at most `concurrency` startable Tickets and fans out an include of two script nodes (implement, then conflict if implement stdout is `resolve`). Fan-out joins `all_done` so one Ticket crash does not cancel siblings. The execute include requires a Ticket id (bare run is unsupported). No nested `archon workflow run`. No pack retry/recover/stop. Implement node is begin + settle without Pi yet, so an empty ticket branch FAILED-exits 0 and the loop can finish.

**Blocked by:** 04

Status: READY

- [ ] Only public workflow name is `ticket-dag-drain`
- [ ] Rematch then loop until pick empty; `max_iterations` 500; pick honors `concurrency`
- [ ] Per Ticket: implement node, then conflict node only when stdout is `resolve`
- [ ] Fan-out `join: all_done`; execute include requires Ticket id
- [ ] No nested `archon workflow run`; no pack retry/recover/stop workflows
- [ ] Drain can complete git-contract FAILED paths without a Pi session
