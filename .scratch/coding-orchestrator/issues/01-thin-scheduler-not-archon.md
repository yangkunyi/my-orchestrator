# 01 Thin scheduler, not Archon

**What to build:** a small TypeScript program in this repository, binary name `orchestrator`. Not Archon, not an Archon workflow pack, no Python wrapper that spawns Node. Concurrency cap and agent choice are first-class here because Archon child worktrees start from `origin/<base>` while merge-one only updates local Main.

**Blocked by:** None

Status: MERGED

- [x] CLI name is `orchestrator` (ADR-0019)
- [x] TypeScript in-process with the Pi SDK (ADR-0006)
- [x] Not Path A (keep Archon, push Main or bypass child isolation) (ADR-0001)

## Comments

Landed in `22bc3c6`. ADR-0001, ADR-0006, ADR-0019.
