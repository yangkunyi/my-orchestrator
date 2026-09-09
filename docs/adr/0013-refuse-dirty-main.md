# Refuse to start if Target Main is dirty

Before creating any Worktree, the Orchestrator checks the Target's Main checkout. Uncommitted changes → exit. Merge and Ticket Status writes happen on Main; a dirty tree would mix those with unrelated edits.

Rejected: stashing; running anyway and hoping merge still works.
