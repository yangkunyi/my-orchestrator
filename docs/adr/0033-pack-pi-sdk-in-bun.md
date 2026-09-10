# Pack agents are Pi SDK inside bun scripts

The Archon pack's Implementation Agent and Conflict Agent are in-process `@earendil-works/pi-coding-agent` sessions (`createAgentSession`, cwd the Ticket Worktree) inside pack bun scripts. Pi only. The pack does not read the Target's Archon project assistant. It does not spawn `pi -p` or Claude. It does not import this repository's `src/agent.ts`.

`DefaultResourceLoader` discovers `~/.pi/agent` extensions (needed for `subagent` / `runs.all`). No TUI: tools run without approval. Wall clock is 2 hours including nested review children, then `session.abort()`. Archon node `timeout` is 7500000ms so abort can stamp FAILED and exit 0. The process sets `NODE_USE_ENV_PROXY=1`; it does not copy an `httpProxy` URL (ADR-0025 is the CLI Run).

Archon `script:` is bun or uv. The Pi SDK is an npm package. One language (bun TypeScript) avoids a Python git layer calling a Node helper. Python pack scripts (earlier ADR-0032) are reversed.

Rejected: Archon `prompt:` / `command:` as the Ticket agent (cwd is Main); spawning the `pi` CLI; Claude Agent SDK; Python calling a Node helper; `pi --mode rpc`; selecting `ticket-implementer` as the main session (Pi SDK has no agent-profile flag).
