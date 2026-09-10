# Worktree and branch are gone after MERGED

After the Status follow-up commit, the Orchestrator removes the Ticket Worktree and deletes the Ticket branch. They are a temporary execution environment. `worktrees/` in the Target is gitignored.

FAILED keeps the Worktree and branch so a human can inspect; retry is Status back to `READY`. Resume of that Worktree is ADR-0030.

Rejected: leaving merged branches around as the done mark; deleting FAILED worktrees immediately.
