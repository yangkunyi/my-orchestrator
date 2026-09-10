# 06 Run, Inspect, and config

**What to build:** one Orchestrator process is a Run with an id. Records at Target `.scratch/orchestrator/runs/<id>/` (gitignored): events (pino JSON), DAG snapshot (inspect copy), pid, meta, role jsonl.

`--detach` spawns a child, prints the id, exits. One live Run per Target.

`orchestrator inspect <target> [id]` reads records only. No id: live Run if one exists, else the list. Role listing is `implement.jsonl` / `conflict.jsonl` only.

Config: Target `.scratch/orchestrator.yaml`. CLI `--model` / `--thinking-level` / `--concurrency` override the file. `httpProxy` is YAML-only. Defaults: Pi's model, `thinkingLevel: high`, `concurrency: 4`, no `httpProxy`.

Run process starts with `NODE_USE_ENV_PROXY=1`. `httpProxy` copied into `HTTP_PROXY` / `HTTPS_PROXY`.

CLI parsing is `cac`. Detach is Node `spawn({ detached: true })`.

**Blocked by:** 02

Status: MERGED

- [x] YAML + CLI overrides; `httpProxy` YAML-only (ADR-0015)
- [x] Run records, detach, inspect (ADR-0021)
- [x] `cac` + pino; homemade detach (ADR-0022)
- [x] Pi fetch uses env proxy (ADR-0025)
- [x] Inspect does not write records; does not import the Pi SDK

## Comments

Landed in `22bc3c6`; proxy ADR-0025 later. Records in `src/journal.ts`; inspect in `src/inspect.ts`; flags in `src/cli.ts`; YAML in `src/config.ts`.

Module alignment: `architecture/04`.

Rejected: records in the tool repo; a second stored DAG the scheduler reads; `daemonize-process`; wrapping the `pi` CLI just to get its dispatcher.
