# YAML config plus CLI overrides

Model, thinking level, concurrency, and optional HTTP proxy live in a YAML file on the Target, with CLI flags overriding the file (except `httpProxy`, which is YAML-only). Missing keys fall back to: Pi's default model, `thinkingLevel: high`, `concurrency: 4`, no `httpProxy` (inherit the parent env).

Pi SDK fields: `model` and `thinkingLevel` (`off` | `minimal` | `low` | `medium` | `high` | `xhigh` | `max`).

`httpProxy` is an HTTP proxy URL copied into the Run process env. See ADR-0025.

File path: Target `.scratch/orchestrator.yaml`.

The Archon pack does not read this file. It uses `.scratch/ticket-dag.yaml` (ADR-0034).

Rejected: CLI-only; hardcoding Pi's interactive default with no flags.
