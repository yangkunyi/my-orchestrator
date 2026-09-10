# Pack drain-end review is a read-only bun node

After leftover rematch, pack bun writes `$ARTIFACTS_DIR/review-base` = Main HEAD. After the drain `loop_group`, one bun node on Target Main: the script pastes `git diff <base>...HEAD` into `createAgentSession` with tools allowlist `read`, `grep`, `find`, `ls` (no bash). Model and `thinkingLevel` come from `ticket-dag.yaml`. Prompt: bugs, missing tests, and cross-file impact on this diff; no Spec axis; no `/code-review`, spawn, or repo writes. Bun writes `$ARTIFACTS_DIR/review.md` from the last assistant text. Empty diff skips the session. Git-diff failure or a Pi throw still write `review.md`. Node exit 0. Pack does not parse the report; settle stays the Git contract. Review wall clock is 30 minutes; Archon node timeout is 2000000ms.

Implement prompt is the short implement SKILL body plus leave `Status:` unchanged. Keep `/tdd`. Drop `Once done, use /code-review`. No two-axis fanout. Conflict prompt has no review. No `pi-subagents` / `diff-reviewer` preflight. Pack does not ship `diff-reviewer.md` and does not copy tdd/code-review trees.

This is pack-only. The Orchestrator still uses `/skill:implement` without stuffing review into the prompt (ADR-0003).

Supersedes ADR-0035.

Rejected: per-ticket two-axis in implement; unattended `/code-review`; one Spec agent on a mixed multi-ticket diff; failing the drain on findings; installing pr-review, CodeRabbit, Copilot review, Bugbot, Greptile, Qodo, earendil pi-review, or the Anthropic `/code-review` plugin.
