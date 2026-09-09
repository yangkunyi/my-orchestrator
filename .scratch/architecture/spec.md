# Spec: align modules with CONTEXT

Review: `/tmp/architecture-review-20260909T134644Z.html`

CONTEXT already names Git contract, Worktree, Run, Inspect, Implementation Agent, Drain. The code is eleven files. Each incident patched the nearest file.

This Feature puts those names on the modules. Not five more ADRs stacked on `runOne`.

Leave alone: `tickets.ts` scan / startable, `config.ts`, Status follow-up commit on Main (ADR-0016), serial merge policy (ADR-0012), Pi as runtime (ADR-0003), Main `.venv` on Run PATH (ADR-0026 dead / 0027), Inspect writing records (ADR-0021), extra gitignore wrappers.

DAG: 01 and 02 and 04 start together. 03 after 01 and 02. 05 after 02 and 04.
