# An included workflow declares a terminal node, and the drain's fan-out fails on a throw

A composed fan-out instance is joined on its terminal state, and an instance whose last node was skipped counts as "stopped without a terminal state" — which fails the drain's fan-out node whatever the join value says (measured on a two-instance probe: both `all_done` and `all_success` fail that shape). In the real drain this was a live bug: implement returns `merged` for a Ticket that merged cleanly, so the `when:` on conflict skips it, the execute instance ends on a skipped node, and the whole drain was reported failed with review and summary skipped — while the Ticket itself was correctly MERGED. It was found by running a real drain end to end, not by reading the YAML, and it predates this round.

The fix is `returns: implement` in `ticket-dag-execute.yaml`: the node that always runs and prints the Ticket's outcome token (`merged` / `failed` / `resolve`), with conflict refining it when it runs. Nothing reads `$execute.output`, so the rest of the pack is unaffected.

Its other half is the drain's `join: all_success` (ADR-0051). A Ticket's own outcome is exit 0, so `all_success` passes normal FAILED, merged and resolve results; only a thrown error — a runner that cannot start, or a pack bug — fails an instance and stops the run. Under `all_done` such a failure is an `archon_failed` marker and the run still reports success.

Both are pinned by the YAML contract test: the join value, and that `returns:` names a declared node with no `when:` of its own (a node that can be skipped is not a terminal state).

Rejected: `join: all_done` (a thrown error becomes a marker and a broken config is reported as success); a checker node that reads the batch output and exits non-zero (it would encode archon's marker shape in the pack, and the join already distinguishes); `returns: conflict` (it is behind a `when:`); adding a third always-run node whose only job is to be terminal (the existing always-run node already carries the outcome token).
