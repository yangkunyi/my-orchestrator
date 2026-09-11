# Pi's session log belongs to Pi's adapter, and the seam names no runner

`roleSessionFile` (the path formula) and `readPiSession` (the jsonl reader) live in `pi-session.ts`; `session-log.ts` is deleted. The seam (`agent.ts`) statically imports `config.ts` and nothing else: a runner's name appears only inside `defaultAgent`'s dynamic import, and a repro reads `agent.ts` as text and fails if a static import of `pi-session` or `dsh-agent` ever comes back. The answer channel is the runner's own reported turn (ADR-0040), so nothing outside Pi reads Pi's log.

The module said "cross-runner" but only Pi's jsonl could be read, and the seam imported it for one reason: `noopAgent`, a double with no production caller, computed a Pi-shaped session path. That made the seam the single place in the pack where a non-Pi path reached Pi's log, which `review-repro` already forbade for `report-node.ts`. The double now reports `sessionFile: ""` — it starts nothing, so it has no session — and `readPiSession("")` is safe because the reader checks existence first (measured).

The two byte-identical 17-line recording turn doubles in `review-repro.ts` and `summary-repro.ts` became `tests/target.ts`'s `recordingAgent(answer, log)`, which both repros now use; a fixture owns what two repros copied and no production module owns what one adapter needs.

Rejected: keeping `session-log.ts` as a shared module with a dsh reader it never had; letting the seam spell a session path for a test double; a `"(none)"` sentinel instead of the empty string as "no session"; reading the answer back out of Pi's log when the runner already hands it over (ADR-0040); making the double report the session key so the log line stays pretty.
