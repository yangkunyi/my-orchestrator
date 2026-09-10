# Pack inlines two-axis blocking review in the implement prompt

The Archon pack inlines the short `implement` and `resolving-merge-conflicts` SKILL bodies (plus: leave `Status:` unchanged). It does not invoke `/skill:` names and does not copy the `tdd` / `code-review` skill trees.

The implement text is one file for Pi: after implement/test/commit, spawn two isolated read-only review children in parallel (Standards and Spec), wait for both, aggregate under `## Standards` and `## Spec`. Pi mapping: `subagent({ async: false, workflowScript: runs.all([...]) })` with `agent: "diff-reviewer"`. Children run `git` themselves. Drop `Once done, use /code-review` (that skill asks for a fixed point; unattended `-p` would stall or skip). Conflict text has no two-axis review.

The pack does not ship `diff-reviewer.md`. Before the implement session: `pi-subagents` must be loaded and an agent named `diff-reviewer` must exist. If either is missing, stamp FAILED and do not start the agent. The pack does not parse review reports; settle is still the Git contract.

This is pack-only. The Orchestrator still uses `/skill:implement` without stuffing review into the prompt (ADR-0003).

Rejected: two implement texts; Claude Agent-tool mapping in the same file; parent pasting the diff so children need no bash; bundling `diff-reviewer` in the pack; YAML review nodes; treating a missing reviewer as MERGED if git looks fine.
