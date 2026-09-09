# Run records, detach, inspect

Each Orchestrator process is a Run with an id printed at start. Records live on the Target at `.scratch/orchestrator/runs/<id>/` and that path is gitignored so they do not dirty Main.

`orchestrator <target> --detach` spawns a child, writes its pid, prints the id, and exits. A Target may have at most one live Run; a second start is refused.

`orchestrator inspect <target>` shows the live Run (DAG snapshot, events, pid). `orchestrator inspect <target> <id>` shows that Run. The DAG snapshot is rewritten each scheduling cycle from the current Ticket files; it is an inspect copy, not the scheduling source (ADR-0018). Event lines are pino JSON (ADR-0022).

Rejected: records in the tool repo; a second stored DAG that the scheduler reads.

Pi session files: superseded by ADR-0024. They live under the Run directory.
