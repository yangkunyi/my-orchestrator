# Operator actions are not Runs; stay this program

There is no retry command. The next drain starts eligible FAILED Tickets (no merge commit, not attempted this drain). `orchestrator recover` and `stop` (CLI) rematch leftovers and are not Runs. While a Run is live: recover refuses; Inspect stays read-only; stop sends SIGTERM to the live Run then rematches leftovers (same function as recover). Recover rematches all leftovers and starts no Ticket. Stop ends the whole Run.

The Archon pack has no recover/stop workflow: `archon workflow cancel` ends the drain run; leftover rematch is the next `ticket-dag-drain`'s first node (and that drain will also start eligible FAILED).

Hosting this CLI as Archon script nodes was considered again and rejected (ADR-0001 still holds). The pack is a second runner, not this program (ADR-0032).

Rejected: `orchestrator retry`; a pack retry workflow; wrapping Archon as the YAML host of this CLI.
