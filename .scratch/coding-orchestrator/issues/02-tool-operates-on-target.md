# 02 Tool operates on a Target

**What to build:** Orchestrator source lives here. It schedules a Target git repo given as a required path. Tickets and Worktrees live in the Target. Merge only to that Target's local Main; do not push origin. Worktrees are created from that local HEAD. Merge and Status commits use the Target's `user.name` / `user.email`. Refuse to start if Main is dirty.

**Blocked by:** 01

Status: MERGED

- [x] Target is a required path argument (ADR-0002)
- [x] Merge only to local Main; no origin push (ADR-0004)
- [x] Dirty Main refuses to start (ADR-0013)
- [x] Git identity from the Target (ADR-0020)

## Comments

Landed in `22bc3c6`. ADR-0002, ADR-0004, ADR-0013, ADR-0020.

Rejected: this repo as the only scheduled tree; copying the scheduler into every project; inferring Target from cwd; stashing a dirty Main; pushing Main so the next Worktree can start from `origin/main`.
