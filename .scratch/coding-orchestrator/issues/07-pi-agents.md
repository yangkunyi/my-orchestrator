# 07 Implementation Agent and Conflict Agent

**What to build:** both agents are in-process `@earendil-works/pi-coding-agent` sessions (`createAgentSession`), cwd = the Ticket Worktree. `model` and `thinkingLevel` from Target YAML, overridden by CLI.

Implementation prompt: `/skill:implement` plus the Ticket path. Implement criteria, commit product code, leave Status unchanged.

Conflict prompt: `/skill:resolving-merge-conflicts` plus the Ticket path. Resolve the current conflict, commit, exit. Do not declare MERGED. Do not re-run implement.

Sessions persist at `.scratch/orchestrator/runs/<id>/sessions/<ticket-id>/<role>.jsonl` via `SessionManager.open`. Inspect lists those files. Git contract may read `lastAssistantError` for a FAILED reason.

Worktree env is already prepared before `runPi`. `runPi` does not call `uv sync`.

**Blocked by:** 05, 06

Status: MERGED

- [x] Pi SDK in-process; not Archon `provider: pi`, not `pi` CLI, not Codex, not `grok -p` (ADR-0003)
- [x] Prompts are `/skill:implement` and `/skill:resolving-merge-conflicts` (Pi expansion)
- [x] Sessions under the Run dir (ADR-0024)
- [x] Neither prompt tells the agent to change Status

## Comments

Landed in `22bc3c6`; session persist ADR-0024. Adapter in `src/agent.ts`.

Module alignment: `architecture/05`.
