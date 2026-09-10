# 07 — Two-axis review + preflight

**What to build:** The implement prompt is one Pi text: after implement/test/commit, spawn two isolated read-only review children in parallel (Standards and Spec), wait for both, aggregate under `## Standards` and `## Spec`. Mapping: `subagent({ async: false, workflowScript: runs.all([...]) })` with `agent: "diff-reviewer"`; children run `git` themselves. Drop `Once done, use /code-review`. Do not copy tdd/code-review skill trees. Do not ship `diff-reviewer.md`. Conflict prompt has no two-axis review. Before the implement session: `pi-subagents` must be loaded and `diff-reviewer` must exist; if either is missing, stamp FAILED and do not start the agent. Pack does not parse review reports; settle stays the Git contract.

**Blocked by:** 06

**Status:** BLOCKED

- [ ] Implement text includes the blocking two-axis fanout and drops `use /code-review`
- [ ] Conflict text has no two-axis review
- [ ] Pack does not ship `diff-reviewer`; does not copy tdd/code-review trees
- [ ] Missing `pi-subagents` or `diff-reviewer` → FAILED before the agent starts
- [ ] Pack does not parse review output; settle is still the Git contract
- [ ] Preflight covered by a fake agent dir test; no live Pi
