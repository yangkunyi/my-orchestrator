# 07 — Drain-end read-only review node

**What to build:** After leftover rematch, bun writes `$ARTIFACTS_DIR/review-base` = Main HEAD. After the drain loop, one bun review node on Target Main: paste `git diff <base>...HEAD` into `createAgentSession` with tools `read`/`grep`/`find`/`ls` only (no bash). Model and thinkingLevel from `ticket-dag.yaml`. Prompt: bugs, missing tests, cross-file impact on this diff; no Spec axis; no `/code-review`, spawn, or repo writes. Bun writes `$ARTIFACTS_DIR/review.md` from the last assistant text. Empty diff skips the session. Git-diff fail or Pi throw still write `review.md`. Node exit 0. Pack does not parse the report; settle stays the Git contract. Implement drops `Once done, use /code-review` and has no two-axis fanout; keep `/tdd`. Conflict has no review. No `pi-subagents`/`diff-reviewer` preflight. Do not ship `diff-reviewer.md`. Do not copy tdd/code-review trees.

**Blocked by:** 06

Status: MERGED

- [ ] Rematch writes `review-base`; drain YAML has a review node after the loop
- [ ] Review session is read-only (`read`/`grep`/`find`/`ls`, no bash); bun pastes the diff
- [ ] Empty diff skips the session; bun writes `review.md`; node exit 0
- [ ] Implement has no `/code-review` and no two-axis fanout; conflict has no review
- [ ] Pack does not ship `diff-reviewer`; no preflight; settle is still the Git contract
- [ ] Fake-agent tests; no live Pi
