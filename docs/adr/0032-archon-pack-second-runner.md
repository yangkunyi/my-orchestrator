# Archon pack is a second runner, not the Orchestrator

The Ticket DAG and Git contract may also be run as an Archon workflow pack on a Target. That pack is not the Orchestrator and is not invoked from this CLI (ADR-0001, ADR-0031). Only one Status writer at a time: an Orchestrator Run or an Archon pack run. Mutual exclusion is convention, not a shared lock.

Source is `.archon/workflows/ticket-dag/` in this repository, copied to `~/.archon/workflows/` (not a symlink). The Target does not commit `.archon/`. Pack scripts are TypeScript with Archon `runtime: bun`. They reimplement the Git contract from CONTEXT; they do not import this repository's TypeScript.

One Archon run is the drain (`ticket-dag-drain`): `worktree.enabled: false` on the Target Main checkout. First node rematches leftovers (`always_run`) and writes `$ARTIFACTS_DIR/review-base`. Then a `loop_group` (hard cap 500 iterations) until pick is empty: each iteration takes at most `concurrency` startable Tickets (ADR-0034) and `include:` + `fan_out` (`join: all_done`) of two nodes per Ticket (implement, then conflict if implement stdout is `resolve`). After the loop, one bun review node on Main (ADR-0036). Git-contract FAILED is script exit 0 so Archon does not retry that node in the same drain; crash or kill is exit ≠ 0. Attempted ids this drain live in `$ARTIFACTS_DIR`, never `$STATE_DIR`. The execute include is not a public entry: its `ticket` input is required. No nested `archon workflow run`. No pack retry/recover/stop workflows.

Same local-Main Worktree rules, merge message (`orchestrator: merge ticket/…`), empty-merge, leftover rematch, and `uv sync --frozen` as this CLI. Archon `isolation: worktree` cannot be the Ticket Worktree. Parallel Tickets; merge onto Main stays serial under the pack's own lock (not the CLI's `proper-lockfile`). `orchestrator inspect` does not show pack drains. Pi sessions live under `$ARTIFACTS_DIR/sessions/<ticket-id>/`.

Agent runtime: ADR-0033. Config: ADR-0034. Drain-end review: ADR-0036 (supersedes ADR-0035). Module layout: ADR-0037.

Rejected: replacing this CLI with Archon; wrapping `orchestrator` as an Archon node; static YAML nodes, one per Ticket; importing `src/` or `dist/`; nested `archon workflow run` per Ticket; Python/uv pack scripts; spawning the Target's Archon project assistant.
