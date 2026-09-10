# 02 — Startable pick

**What to build:** Each drain cycle scans current Ticket files. BLOCKED whose blockers are all MERGED is stamped READY under the merge lock. Pick at most `concurrency` startable Tickets: Status READY or FAILED, every blocker MERGED, Main has no merge commit of that Ticket branch, this drain has not already attempted that id. A Ticket this drain just stamped FAILED is not picked again. Attempted ids live in the Archon artifacts directory, not the state directory. Next drain may start eligible FAILED.

**Blocked by:** 01

Status: MERGING

- [ ] BLOCKED with all blockers MERGED is stamped READY before pick
- [ ] startable is READY or FAILED, blockers MERGED, no merge commit, not attempted this drain
- [ ] Pick size honors `concurrency` from config
- [ ] Just-FAILED in this drain is excluded from later picks in the same drain
- [ ] Attempted ids are in the artifacts directory
- [ ] Temp-Target tests; no live Pi
