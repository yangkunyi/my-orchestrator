# Leftover rematch looks for a merge commit

A leftover in-flight Ticket is MERGED only if Main already has a `--no-ff` merge commit of that Ticket branch (`orchestrator: merge ticket/…`, second parent). Ancestry is not enough: the RUNNING Status commit is already on Main, so treating the ticket branch as an ancestor would stamp MERGED with no implementation.

Completing a Ticket is idempotent: if that merge commit exists, stamp MERGED and do not create a Worktree or merge again. Drain start, Recover, Stop, and Retry use this same check.

Rejected: leftover MERGED on ancestry alone; leftover always FAILED even when the merge commit exists; treating "Already up to date" as MERGED (ADR-0023).
