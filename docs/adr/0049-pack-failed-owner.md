# One owner writes FAILED and records why

`failTicket(target, ticket, reason)` in `main-writes.ts` is the single FAILED writer: it asserts the caller's lock (ADR-0042), prints the reason and stamps the Status. Every site uses it — begin's failed integration and env sync (each opening its own transaction after the begin lock is released), implement's and conflict's catch (their own transaction), settle's merge and conflict outcomes (inside the transaction they already run in), and rematch's leftover rule, where a leftover in flight with no merge commit on Main now says why instead of stamping silently.

It replaces three shapes that each lost something: settle's `fail()`, which recorded a reason but lived in a module no workflow reaches (`script: settle` is declared nowhere); begin's two inline stamps, which recorded nothing; and a `BeginResult.reason` field no caller read. The `import.meta.main` block in `settle.ts` went with them — it was a node entry for a node that does not exist, and its two guards (ticket not found, worktree missing) are dead in production because the nodes that reach it resolve the ticket and check the worktree first.

The one failure path that already recorded a reason keeps its wording: `FAILED: no credentials` is what the drain promised, and the test that pinned that line now pins the owner instead of a call site.

Rejected: a second FAILED writer next to settle's library; recording to stderr without the Status (the Status is the contract); keeping the dead node entry and its CLI-only guards; keeping `BeginResult.reason` for a caller that does not exist; a bare stamp in rematch (the leftover rule is a failure with a cause, so it says so).
