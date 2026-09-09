# Thin scheduler, not Archon

The Orchestrator is a small program in this repo. It is not Archon and not an Archon workflow pack.

Archon child worktrees start from `origin/<base>`, while merge-one only updates local Main — so a patched Archon DAG would still start the next Worktree from the wrong commit. We also want a first-class concurrency cap and to pick the agent ourselves. Those three together beat wrapping Archon.

Rejected: Path A (keep Archon, push Main or bypass child isolation).
