# FAILED retry resumes the Worktree

First start stamps RUNNING then creates the Worktree from Main HEAD. After FAILED, Retry stamps READY and the next start reuses that Worktree and branch: integrate current Main first, keep uncommitted files, no `git reset --hard`. If the tree is missing but the branch exists, recreate the Worktree from that branch, not Main. If neither exists, create from Main HEAD. MERGED still removes the Worktree. Integrating Main into a dirty Worktree that conflicts uses the existing Conflict Agent, then the Implementation Agent continues on that tree.

This supersedes the "one Implementation Agent run" sentence in ADR-0005. Retry is still Status back to READY (ADR-0017); the Worktree is not deleted to start again.

Rejected: deleting the Worktree and branch then `worktree add` from Main on every start; `git reset --hard` on resume.
