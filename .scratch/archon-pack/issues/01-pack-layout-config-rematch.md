# 01 — Pack layout, config, leftover rematch

**What to build:** A copyable Archon pack folder in this repository (not a symlink; Target does not commit it). Pack bun scripts read `ticket-dag.yaml` or the Archon `config` input path (`model`, `thinkingLevel`, `concurrency`). Missing file: Pi default model, `thinkingLevel: high`, `concurrency: 4`. Invalid `thinkingLevel` or `concurrency` fails the drain. Extra keys ignored. Do not read `orchestrator.yaml`. Leftover rematch: Main already has that Ticket's `--no-ff` merge commit (`orchestrator: merge ticket/…`, second parent the Ticket branch) → stamp MERGED and remove the Worktree; in-flight with only ancestry → stamp FAILED and keep the Worktree. Tests on a temp Target, same shape as the existing leftover repros. No Pi session. No Archon engine.

**Blocked by:** None — can start immediately

Status: MERGING

- [ ] Pack source lives in this repository and is meant to be copied to the operator's global Archon workflows folder
- [ ] Config from `ticket-dag.yaml` or a `config` path input; missing file uses the three defaults; invalid `thinkingLevel` / `concurrency` fails the drain; extra keys ignored; `orchestrator.yaml` is not read
- [ ] Leftover with merge commit → MERGED, Worktree gone
- [ ] Leftover with only ancestry → FAILED, Worktree kept
- [ ] Scripts do not import this repository's TypeScript
- [ ] Temp-Target tests for config and rematch; no live Pi; no Archon engine
