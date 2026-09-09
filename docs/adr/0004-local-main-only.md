# Merge only to local Main

The Orchestrator merges into the Target's local Main and does not push to origin. Worktrees are created from that local HEAD.

Rejected: pushing Main so the next Worktree can start from `origin/main` (the Archon workaround this tool exists to avoid).
