# Ticket Status lands in a follow-up commit on Main

After a successful merge, the Orchestrator commits `Status: MERGED` on Main in a second commit. The merge commit contains only the implementation diff. `FAILED` is the same shape: a Main-only Status commit, no merge.

The Ticket branch is not used to record Status. `/implement` does not edit `Status:`.

Rejected: stuffing Status into the merge commit; letting the agent commit Status on the feature branch.
