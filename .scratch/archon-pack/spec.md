# Spec: Archon pack second runner

**Triage:** ready-for-agent

Same Ticket DAG and Git contract, as an Archon workflow pack a human starts on a Target. Not the Orchestrator. Not a Run. Not invoked from this CLI.

Glossary: `CONTEXT.md`. Decisions: ADR-0032, ADR-0033, ADR-0034, ADR-0035 (also ADR-0001, ADR-0023, ADR-0025, ADR-0027, ADR-0029, ADR-0030, ADR-0031).

## Problem Statement

The Orchestrator already drains Tickets on a Target. An operator who already runs Archon on that Target cannot run the same Ticket DAG and Git contract as an Archon workflow. Wrapping this CLI as Archon nodes was rejected. Archon `prompt:` nodes cannot pin cwd to a Ticket Worktree. Archon `isolation: worktree` cuts from `origin/<base>`, which is the wrong baseline.

## Solution

Ship an Archon pack in this repository. Copy it to the operator's global Archon workflows folder. On a Target, the operator runs `ticket-dag-drain`. Pack bun TypeScript scripts reimplement the Git contract (they do not import this repository). Each Ticket's Implementation Agent and Conflict Agent are Pi SDK sessions with cwd the Ticket Worktree. Config is `ticket-dag.yaml` on the Target, overridable by a path input. Inspect stays Archon's run records. Stop is `archon workflow cancel`. The next drain rematches leftovers and may start eligible FAILED Tickets.

## User Stories

1. As an operator, I want a second runner of the same Ticket DAG and Git contract as an Archon pack, so I can drain a Target from Archon without making this CLI an Archon host.

2. As an operator, I want the pack not to be the Orchestrator and not to be a Run, so Run records, Inspect, and `orchestrator` commands stay about this CLI.

3. As an operator, I want this CLI never to invoke the pack, so ADR-0001 still holds.

4. As an operator, I want pack source in this repository under the ticket-dag workflow pack folder, so the pack is versioned with the tool.

5. As an operator, I want to copy that folder to my global Archon workflows (copy, not symlink), so Archon can resolve `ticket-dag-drain` on any Target.

6. As an operator, I want the Target not to commit an Archon folder, so Targets do not carry the pack.

7. As an operator, I want pack scripts in TypeScript with Archon bun runtime, so git contract and Pi SDK share one language.

8. As an operator, I want those scripts not to import this repository's TypeScript, so the pack does not depend on building or PATH-installing `orchestrator`.

9. As an operator, I want the only public entry to be `ticket-dag-drain`, so I do not have a menu of pack workflows.

10. As an operator, I want the per-Ticket execute include not to be a supported public run, so a bare execute without a Ticket id fails.

11. As an operator, I want `ticket-dag-drain` to run on the Target Main checkout (`worktree.enabled: false`), so Archon does not create its own isolation worktree as the Ticket Worktree.

12. As an operator, I want Archon `isolation: worktree` never used as the Ticket Worktree, so the next Ticket still starts from local Main after merge, not from `origin/<base>`.

13. As an operator, I want no nested `archon workflow run` per Ticket, so one Archon run is the drain.

14. As an operator, I want the first drain node to rematch leftovers (`always_run`), so a cancelled previous drain does not leave in-flight Status forever.

15. As an operator, I want leftover rematch to stamp MERGED only when Main already has that Ticket's `--no-ff` merge commit (`orchestrator: merge ticket/…`, second parent the Ticket branch), so a RUNNING Status commit is not treated as done.

16. As an operator, I want leftover in-flight without that merge commit stamped FAILED with the Worktree kept, so agent commits remain inspectable.

17. As an operator, I want mere ancestry not to count as complete, matching ADR-0029.

18. As an operator, I want completing a Ticket to be idempotent: if that merge commit exists, stamp MERGED, do not create a Worktree or merge again.

19. As an operator, I want the drain then to loop until pick is empty, so newly unblocked READY Tickets start in later iterations of the same drain.

20. As an operator, I want that loop capped at 500 iterations, so a pick bug cannot run forever.

21. As an operator, I want each loop iteration to select at most `concurrency` startable Tickets, so I cap parallel Implementation Agents.

22. As an operator, I want those Tickets to run as an include fan-out that joins `all_done`, so one Ticket crash does not cancel siblings.

23. As an operator, I want startable to mean Status READY or FAILED, every blocker MERGED, Main has no merge commit of that Ticket branch, and this drain has not already attempted that id.

24. As an operator, I want a Ticket this drain just stamped FAILED not started again in this drain.

25. As an operator, I want the next drain to start eligible FAILED Tickets again, so there is no pack retry command.

26. As an operator, I want FAILED whose merge commit is already on Main stamped MERGED with no agent.

27. As an operator, I want BLOCKED Tickets whose blockers are all MERGED stamped READY under the merge lock before pick, so they can start.

28. As an operator, I want dependents of FAILED to stay BLOCKED, and other startable Tickets to keep running.

29. As an operator, I want first start (READY, no tree, no branch) to stamp RUNNING then create the Worktree from Main HEAD.

30. As an operator, I want FAILED resume to stamp RUNNING, reuse the Worktree and branch, integrate current Main first, and keep uncommitted files (no `git reset --hard`).

31. As an operator, I want a missing Worktree whose ticket branch still exists recreated from that branch, not from Main HEAD.

32. As an operator, I want neither tree nor branch treated as first start from Main HEAD.

33. As an operator, I want resume integrate conflict to run the Conflict Agent (Main stays clean), then continue that Ticket's settle path.

34. As an operator, I want dirty Worktree after the agent to be FAILED, Worktree kept.

35. As an operator, I want no new commits on the ticket branch vs current Main to be FAILED.

36. As an operator, I want empty merge (Main HEAD unchanged) to be FAILED.

37. As an operator, I want merge still broken after the Conflict Agent to be FAILED.

38. As an operator, I want a merge that creates a commit on Main to be MERGED and the Worktree removed.

39. As an operator, I want that merge commit message to be `orchestrator: merge ticket/…` (`--no-ff`, second parent), so CLI rematch and pack rematch agree.

40. As an operator, I want merge onto Main serial under the pack's own lock, even when several Tickets run in parallel.

41. As an operator, I want that lock not to be the CLI's lock file, so the two runners stay separate programs (exclusion is convention).

42. As an operator, I want each Ticket to be two script nodes: implement, then conflict only if implement stdout is `resolve`.

43. As an operator, I want those two agents to be independent sessions, not parent/child.

44. As an operator, I want implement stdout to be exactly one token `merged`, `failed`, or `resolve`, so Archon `when:` can branch.

45. As an operator, I want logs on stderr, so stdout stays the token.

46. As an operator, I want git-contract FAILED to be script exit 0, so Archon does not retry that node in the same drain.

47. As an operator, I want crash or kill to be exit ≠ 0, so Archon resume can re-drive that node.

48. As an operator, I want this drain's attempted ids stored in the Archon artifacts directory, never the Archon state directory.

49. As an operator, I want Implementation Agent and Conflict Agent started with the Pi SDK (`createAgentSession`) and cwd the Ticket Worktree, so tools see that tree.

50. As an operator, I want the pack not to spawn `pi -p` and not to use Claude, so one runtime.

51. As an operator, I want the pack not to read the Target's Archon project assistant setting.

52. As an operator, I want the pack not to use Archon `prompt:` or `command:` as the Ticket agent, so cwd is not Main.

53. As an operator, I want no TUI permission prompts (SDK in-process), so unattended drain can run.

54. As an operator, I want a 2 hour wall clock including nested review children, then `session.abort()`, so a stuck agent becomes FAILED.

55. As an operator, I want the Archon script node timeout longer than 2 hours (7500000ms), so abort can stamp FAILED and exit 0 before Archon kills the process.

56. As an operator, I want `NODE_USE_ENV_PROXY=1` on the SDK process, so Pi fetch honors `HTTP_PROXY` already in the Archon environment.

57. As an operator, I want the pack not to copy `httpProxy` from `orchestrator.yaml` or `ticket-dag.yaml`.

58. As an operator, I want Pi sessions under the Archon artifacts directory as `sessions/<ticket-id>/implement.jsonl` and `conflict.jsonl`, so they are not nested subagent jsonl and not Orchestrator Run records.

59. As an operator, I want default config at Target `.scratch/ticket-dag.yaml` with keys `model`, `thinkingLevel`, `concurrency`.

60. As an operator, I want the pack not to read `.scratch/orchestrator.yaml`.

61. As an operator, I want `archon workflow run ticket-dag-drain --input config=<path>` to use another YAML file, relative to Target Main or absolute.

62. As an operator, I want omitting `--input config` to use `.scratch/ticket-dag.yaml`.

63. As an operator, I want a missing config file to mean Pi's default model, `thinkingLevel: high`, `concurrency: 4`.

64. As an operator, I want an invalid `thinkingLevel` to fail the drain.

65. As an operator, I want `concurrency` that is not an integer ≥ 1 to fail the drain.

66. As an operator, I want extra YAML keys ignored.

67. As an operator, I want the implement prompt to be the short implement SKILL body plus leave `Status:` unchanged plus the two-axis blocking review recipe, not a `/skill:` name.

68. As an operator, I want `Once done, use /code-review` dropped, so unattended review does not ask for a fixed point.

69. As an operator, I want the pack not to copy the `tdd` or `code-review` skill trees.

70. As an operator, I want one implement text for Pi: after implement/test/commit, spawn two isolated read-only review children in parallel (Standards and Spec), wait for both, aggregate under `## Standards` and `## Spec`.

71. As an operator, I want that fanout to be `subagent({ async: false, workflowScript: runs.all([...]) })` with `agent: "diff-reviewer"`, children running `git` themselves.

72. As an operator, I want the pack not to ship `diff-reviewer.md`.

73. As an operator, I want preflight before the implement session: `pi-subagents` loaded and an agent named `diff-reviewer` present; if either is missing, stamp FAILED and do not start the agent.

74. As an operator, I want the pack not to parse review reports; settle stays the Git contract.

75. As an operator, I want the conflict prompt to be the short resolving-merge-conflicts SKILL body plus leave `Status:` unchanged, with no two-axis review.

76. As an operator, I want neither agent to change the Ticket `Status:` line.

77. As an operator, I want `uv sync --frozen` after Worktree create and before every agent session when `pyproject.toml` is present; fail that command → Ticket FAILED, Worktree kept.

78. As an operator, I want `orchestrator inspect` not to show pack drains.

79. As an operator, I want pack progress visible in Archon run records.

80. As an operator, I want `archon workflow cancel` to end the drain, without rematching Ticket Status in that cancel.

81. As an operator, I want the next `ticket-dag-drain` to rematch leftovers and start eligible FAILED.

82. As an operator, I want no pack retry, recover, or stop workflow.

83. As an operator, I want only one Status writer at a time on a Target (CLI Run or pack drain), by convention, so two writers do not stamp Status together.

84. As an operator, I want merge still only to local Main, with no origin push.

85. As an operator, I want the pack still not to read diffs or judge code quality except for the inlined review inside the Implementation Agent session.

86. As an operator, I want pick order to follow a scan of current `.scratch/` Ticket files, same as this CLI's start batch (first N startable).

87. As an operator, I want a live CLI Run and a pack drain on the same Target to remain my problem, not a detected lock.

## Implementation Decisions

- One new Archon pack in this repository. Copy to the operator's global Archon workflows folder. Target does not commit it.

- Pack scripts: TypeScript, Archon bun runtime. Reimplement the Git contract from CONTEXT. Do not import this repository. Do not wrap the `orchestrator` binary as nodes.

- Public workflow: `ticket-dag-drain` only. Drain YAML: `worktree.enabled: false`. Rematch node `always_run`. Then `loop_group` until pick empty, `max_iterations` 500. Each iteration: pick at most `concurrency` startable Tickets; `include:` fan-out, `join: all_done`. Execute include requires a Ticket id.

- Per Ticket: two bun script nodes. Implement: begin (or resume) Worktree, `uv sync --frozen` when needed, preflight, Pi SDK session, settleAfterAgent. Stdout one token `merged` / `failed` / `resolve`. Conflict node only when stdout is `resolve`. Git-contract FAILED → process exit 0. Crash/kill → exit ≠ 0. Attempted ids this drain: Archon artifacts directory.

- startable: READY or FAILED, blockers MERGED, no merge commit of that branch on Main, not attempted this drain. This drain does not start a Ticket it just FAILED. Next drain may.

- Complete/rematch: Main has `--no-ff` merge commit whose message is `orchestrator: merge <ticket.branch>` and whose second parent is a commit of that branch. Ancestry alone is not complete. If complete: stamp MERGED, remove Worktree, no agent.

- Resume Worktree: reuse tree and branch; integrate current Main; keep dirty files. Missing tree, branch exists: recreate from the branch. Neither: from Main HEAD. Dirty at merge time still FAILED. MERGED still removes the Worktree.

- Merge onto Main serial under the pack's own lock, not the CLI lock. Parallel Tickets up to `concurrency`.

- Agents: Pi SDK `createAgentSession`, cwd the Ticket Worktree. Pi only. No Archon `prompt:`/`command:` as the Ticket agent. No `pi` CLI spawn. No Claude. No TUI. Wall clock 2 hours then abort. Archon node timeout 7500000ms. `NODE_USE_ENV_PROXY=1`. No `httpProxy` from YAML. Sessions under artifacts `sessions/<ticket-id>/`.

- Config: Target `ticket-dag.yaml` keys `model`, `thinkingLevel`, `concurrency`. Archon `inputs.config` default that path. `--input config=` selects another file. Missing file: Pi default model, `thinkingLevel: high`, `concurrency: 4`. Invalid `thinkingLevel` or `concurrency` fails the drain. Extra keys ignored. Do not read `orchestrator.yaml`.

- Prompts: inline short implement and resolving-merge-conflicts SKILL bodies plus leave `Status:` unchanged. Implement also has two-axis blocking review (`subagent` + `async: false` + `runs.all`, `agent: "diff-reviewer"`, children run git). Drop `use /code-review`. Do not copy tdd/code-review trees. Conflict has no two-axis review. Pack does not ship `diff-reviewer`. Preflight: `pi-subagents` and `diff-reviewer` or stamp FAILED without starting the agent. Pack does not parse review output.

- Inspect is Archon records. `orchestrator inspect` does not see pack. Cancel: `archon workflow cancel`. No pack retry/recover/stop. Next drain rematches.

- CLI recover/stop remain deferred (ADR-0031). This spec does not change Orchestrator TypeScript.

## Testing Decisions

- One seam: the pack's Git contract, config loader, and review preflight as bun-callable functions. Drive them with a temp Target (init git, Ticket files, branches, Worktrees). Assert Status line, merge commit message and parents, Worktree present or gone, stdout token, process exit code. Do not boot Archon. Do not start a live Pi session. Do not import this repository's scheduler.

- Git contract cases (match existing CLI repros): leftover with merge commit → MERGED, Worktree gone; leftover with only ancestry → FAILED, Worktree kept; empty merge → FAILED; dirty after agent → FAILED; resume keeps dirty files and ticket-branch commits; missing tree with branch recreates from the branch; FAILED with merge commit already on Main → MERGED, no Worktree create; a Ticket just FAILED is not in the next pick of the same attempted set; pick size honors `concurrency`.

- Config: missing file → defaults; `--input` path equivalent (function argument) reads that file; invalid `thinkingLevel` / `concurrency` throws or fails the drain entry; extra keys ignored; `orchestrator.yaml` is not read.

- Preflight: fake agent dir without `diff-reviewer` → FAILED, no session; with `diff-reviewer` → preflight passes (do not run Pi).

- Archon YAML is not unit-tested here. Operator copies the pack and may run `archon validate` by hand.

- Prior art: leftover MERGED/FAILED repros, empty-merge repro, merge-conflict repro, drain repro. Same shape: temp repo, git CLI, exit 0/1. Pack tests live next to the pack scripts, not as Orchestrator CLI tests.

## Out of Scope

- Changing this CLI's Git contract implementation, Run records, Inspect, or `orchestrator.yaml`
- `orchestrator recover` / `stop` (still deferred)
- Wrapping `orchestrator` as Archon nodes
- Replacing the Orchestrator with the pack
- Python pack scripts, spawning `pi -p`, Claude, Archon `prompt:` as the Ticket agent
- Shipping `diff-reviewer` or copying tdd/code-review skill trees
- Target committing `.archon/`
- `httpProxy` on `ticket-dag.yaml`
- Pack retry/recover/stop workflows
- Origin push, colors, TUI, notifications
- Live Pi or live Archon engine in automated tests
- Worktrunk / `agent-worktree`
- Detecting a live CLI Run from the pack (convention only)

## Further Notes

The pack is not written yet. CONTEXT and ADR-0032–0035 are the contract. This spec is the work to author the pack.

Operator-surface (`.scratch/operator-surface/spec.md`) is the CLI rematch/resume/inspect work. Do not mix those tickets with this Feature.

Historical product: `.scratch/coding-orchestrator/spec.md`. Module names: `.scratch/architecture/spec.md`.
