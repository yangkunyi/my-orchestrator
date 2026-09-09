# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` — never a single combined tickets file
- `Status:` near the top of each issue file: implementation Tickets use the Orchestrator lifecycle below; wayfinder tickets use `claimed`/`resolved`; incoming triage uses `triage-labels.md`
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## Implementation tickets (Orchestrator)

`/to-tickets` writes these files. The Orchestrator in this repository drains them from a Target.

- Skip files with `Type: research` / `prototype` / `grilling` / `task` (those belong to `/wayfinder`).
- Ticket id is `<feature-slug>/<NN>`. Same-Feature `Blocked by` may list `NN` alone; cross-Feature must use `<feature-slug>/<NN>`.
- `Blocked by` is declared at publish time (by `/to-tickets` or a human). The Orchestrator only reads the line; it does not infer dependencies from code.
- **Status** is the Orchestrator lifecycle, one value at a time:

| Status | Who writes it | Meaning |
| --- | --- | --- |
| `BLOCKED` | `/to-tickets` (has blockers) or Orchestrator | A Baseline Dependency is not `MERGED` |
| `READY` | `/to-tickets` (no blockers) or Orchestrator | All blockers `MERGED`; may start |
| `RUNNING` | Orchestrator | Implementation Agent is live |
| `MERGING` | Orchestrator | Merging the Ticket branch into Main |
| `CONFLICT` | Orchestrator | `git merge` left `MERGE_HEAD` |
| `RESOLVING` | Orchestrator | Conflict Agent is live |
| `MERGED` | Orchestrator, only after merge succeeds, in a follow-up Main commit | In Main; unblocks downstream; skip on the next run |
| `FAILED` | Orchestrator, follow-up Main commit | Git contract failed; dependents stay BLOCKED; the run continues |

- `/to-tickets` initial Status: `READY` if `Blocked by` is none, else `BLOCKED`.
- `/implement` and the Conflict Agent leave `Status:` unchanged.
- A Ticket is startable when Status is `READY`. Skip `MERGED` and `FAILED`. Treat `RUNNING` / `MERGING` / `CONFLICT` / `RESOLVING` as in-flight (do not start a second session).
- After a Ticket becomes `MERGED`, set each dependent still `BLOCKED` to `READY` if all its blockers are now `MERGED`.
- `FAILED` does not abort the run. Only Tickets that `Blocked by` this one stay BLOCKED. Other READY Tickets still start. A human may set Status back to `READY` to retry.

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` — the Notes / Decisions-so-far / Fog body.
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
