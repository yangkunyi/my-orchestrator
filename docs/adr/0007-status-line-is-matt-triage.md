# Ticket Status is matt triage, not Orchestrator lifecycle

Superseded by ADR-0010.

Kept Status as triage-only (`ready-for-agent`) so matt skills would not desync. That left no durable "done" mark after deleting the branch, so the next run could repeat the Ticket.

Rejected at the time: writing RUNNING/MERGED onto `Status:`.
