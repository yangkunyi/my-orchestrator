# Persist Pi sessions under the Run directory

Implementation Agent and Conflict Agent conversations are written next to the Run journal: `.scratch/orchestrator/runs/<id>/sessions/<ticket-id>/<role>.jsonl` (`implement` or `conflict`). The path is gitignored with the rest of the Run. Inspect lists those files. Diagnosis of empty agent work uses the file, not an in-memory session.

`SessionManager.open` on that path (SDK on-disk factory). In-memory sessions are not used.

Supersedes ADR-0021’s reject of persisting Pi transcripts.

Rejected: dumping a homemade transcript; storing sessions in the tool repo or under `~/.pi/agent/sessions` keyed by worktree cwd.
