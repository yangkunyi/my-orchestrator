# FAILED only blocks dependents

When a Ticket becomes FAILED, Tickets that list it in `Blocked by` stay BLOCKED. The Orchestrator does not stop the run. Independent READY Tickets still start, up to concurrency.

Rejected: aborting the whole workflow on the first FAILED Ticket; auto-retrying FAILED.
