# 06 — Pi SDK agents

**What to build:** Implementation Agent and Conflict Agent are Pi SDK sessions (`createAgentSession`) with cwd the Ticket Worktree. Pi only. Do not spawn `pi -p`, do not use Claude, do not read the Target's Archon project assistant, do not use Archon `prompt:` as the Ticket agent. Inline the short implement and resolving-merge-conflicts SKILL bodies plus leave `Status:` unchanged (review fanout is ticket 07). No TUI. Wall clock 2 hours then abort. Archon node timeout 7500000ms so abort can stamp FAILED and exit 0. Set `NODE_USE_ENV_PROXY=1`. Sessions under artifacts `sessions/<ticket-id>/implement.jsonl` and `conflict.jsonl`. Automated tests still do not start a live Pi session.

**Blocked by:** 05

**Status:** BLOCKED

- [ ] Both roles use the Pi SDK with cwd the Ticket Worktree
- [ ] Prompts are inlined SKILL bodies plus leave Status unchanged; no `/skill:` names
- [ ] 2 hour abort; Archon timeout longer so FAILED can exit 0
- [ ] `NODE_USE_ENV_PROXY=1`; no `httpProxy` copied from YAML
- [ ] Session files under the artifacts directory, not Orchestrator Run records
- [ ] No live Pi in automated tests
