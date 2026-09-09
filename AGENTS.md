## Agent skills

### Orchestrator

`orchestrator <target> [--detach]` drains implementation Tickets from the Target `.scratch/`. DAG is rebuilt from those files each cycle. Each process is a Run with an id under Target `.scratch/orchestrator/runs/<id>/`. `orchestrator inspect <target> [id]` shows the live Run or a past Run. See `docs/adr/`.

### Issue tracker

Issues live as local markdown under `.scratch/<feature>/`. Implementation Ticket `Status:` is the Orchestrator lifecycle. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five roles: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
