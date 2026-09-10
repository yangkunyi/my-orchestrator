# Spec: align modules with CONTEXT

Review: `/tmp/architecture-review-20260909T134644Z.html`

CONTEXT already names Git contract, Worktree, Run, Inspect, Implementation Agent, Drain. The code is eleven files. Each incident patched the nearest file.

This Feature puts those names on the modules. Not five more ADRs stacked on `runOne`.

Leave alone: `tickets.ts` scan / startable, `config.ts`, Status follow-up commit on Main (ADR-0016), serial merge policy (ADR-0012), Pi as runtime (ADR-0003), Main `.venv` on Run PATH (ADR-0026 dead / 0027), Inspect writing records (ADR-0021), extra gitignore wrappers.

Product design tickets: `.scratch/coding-orchestrator/` (spec + 01–08). Glossary `CONTEXT.md`. Decisions `docs/adr/` (through ADR-0028). This Feature is module alignment only.

DAG: 01 and 02 and 04 start together. 03 after 01 and 02. 05 after 02 and 04. 06 after 01.

## Landed

Human commits on this repo, not an Orchestrator drain.

- 01–05: `601bde6` Align modules with CONTEXT: Git contract, Worktree uv env, Run process
- 06: `4366886` Call git via execFile; drop simple-git (ADR-0028)

Leftover from 01: `ensureGitignoreLine` still takes `withMergeLock`; ALS re-entry on `withMergeLock` stayed so `stamp` can nest under the contract lock.
