# DAG is rebuilt from `.scratch` every cycle

The Orchestrator does not store a DAG. Each scheduling cycle scans the Target's `.scratch/*/issues/*.md`, takes implementation Tickets as nodes, and `Blocked by` lines as edges. Status on those files is node state.

A Ticket may start when every listed blocker is `MERGED` and its own Status is not in-flight or terminal. `BLOCKED` with all blockers `MERGED` is startable; the Orchestrator writes `READY` then `RUNNING`.

Rejected: a static `tickets.yaml`; a DAG file the Orchestrator appends to.
