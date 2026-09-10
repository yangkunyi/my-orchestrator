# 03 Ticket file is the DAG node

**What to build:** the scheduled unit is one implementation issue file, not a Feature directory. Path `.scratch/<feature>/issues/<NN>-<slug>.md`. Id `<feature>/<NN>`. Skip files with wayfinder `Type:` (`research` / `prototype` / `grilling` / `task`). Missing `Type:` means implementation.

`Blocked by` is declared, not inferred. Same-Feature may use `NN`; cross-Feature must use `<feature>/<NN>`.

One `Status:` line is the Orchestrator state machine: `BLOCKED` → `READY` → `RUNNING` → `MERGING` → (`CONFLICT` → `RESOLVING` → `MERGING`) → `MERGED` | `FAILED`. `/to-tickets` writes `BLOCKED` or `READY`. The Orchestrator writes every later value. `/implement` does not change Status.

No stored DAG. Each cycle scans current `.scratch` files. Startable = Status `READY` and every blocker `MERGED`. `BLOCKED` with all blockers `MERGED` is stamped `READY` under the start-batch lock.

**Blocked by:** 02

Status: MERGED

- [x] Ticket file is the node; Feature is grouping only (ADR-0005)
- [x] Cross-Feature `Blocked by` (ADR-0008)
- [x] Wayfinder `Type:` skipped (ADR-0009)
- [x] Status machine on the Ticket file (ADR-0010; ADR-0007 superseded)
- [x] DAG rebuilt from `.scratch` each cycle (ADR-0018)
- [x] Branch `ticket/<feature>/<NN>-<slug>`; Worktree `worktrees/<feature>-<NN>-<slug>` (ADR-0011)

## Comments

Landed in `22bc3c6`; Status machine ADR-0010. Scan in `src/tickets.ts`.

Rejected: one execution per Feature folder; sidecar `Merged:`; `resolved` as the done mark; `ready-for-agent` on implementation Tickets; a static `tickets.yaml`.
