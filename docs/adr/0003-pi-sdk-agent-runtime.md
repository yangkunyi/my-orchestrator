# Pi SDK is the agent runtime

Implementation Agent and Conflict Agent are in-process `@earendil-works/pi-coding-agent` sessions (`createAgentSession`), with cwd set to the Ticket's Worktree. `model` and `thinkingLevel` come from Target `.scratch/orchestrator.yaml`, overridden by CLI.

The Implementation Agent prompt is `/skill:implement` plus the Ticket path. The Conflict Agent prompt is `/skill:resolving-merge-conflicts` plus the Ticket path. Pi only expands skills as `/skill:name` (not Grok's `/implement`). Neither prompt tells the agent to change Status. Git checks after exit are the contract.

Rejected: Archon `provider: pi`, Codex, `grok -p`, wrapping the `pi` CLI, stuffing review/verify policy into the prompt, and running `implement` inside conflict resolution.

The Archon pack is a different runner (ADR-0032). Its agent spawn is ADR-0033; its drain-end review is ADR-0036, not this ADR.
