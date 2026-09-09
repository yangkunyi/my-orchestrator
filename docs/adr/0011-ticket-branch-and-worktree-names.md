# Ticket branch and Worktree names

In the Target, a Ticket's branch is `ticket/<feature>/<NN>-<slug>` and its Worktree path is `worktrees/<feature>-<NN>-<slug>`. The id in the name is the Ticket id, so git and the Ticket file match without a side table.

Rejected: reuse Feature folder names as the only git name; let the agent pick the branch.
