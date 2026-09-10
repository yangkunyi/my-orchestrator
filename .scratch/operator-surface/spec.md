# Spec: Operator surface and Git contract rematch

**Triage:** ready-for-agent

Thin scheduler stays this Orchestrator. Operator can retry, recover, stop, and inspect a Target without a second product and without judging diffs.

Glossary: `CONTEXT.md`. Decisions: ADR-0029, ADR-0030, ADR-0031 (also ADR-0001, ADR-0017, ADR-0021, ADR-0023).

## Problem Statement

A Ticket can already be in Main (merge commit exists) while Status is still MERGING or FAILED. Drain leftover rematch treats ancestry as MERGED, so a RUNNING Status commit on Main looks like success. Retry today deletes the Worktree and starts from Main, so agent commits that never merged empty-fail. There is no command to retry, recover leftovers, or stop a live Run. Inspect does not say why a Ticket FAILED, whether its Worktree is still there, or what can start next. Watching a Run means polling inspect by hand.

## Solution

Keep this Orchestrator. Do not host it on Archon.

One Git contract for complete and leftover rematch: Main has a `--no-ff` merge commit of that Ticket branch (`orchestrator: merge ticket/…`, second parent) → stamp MERGED and remove the Worktree. Mere ancestry is not enough. If that commit exists, do not create a Worktree or merge again.

FAILED without that commit: Retry stamps READY (no Run). Next start reuses the Worktree and branch, integrates current Main first, keeps dirty files. Missing tree with branch: recreate from the ticket branch, not Main. Neither exists: first-start from Main HEAD. Dirty at merge time is still FAILED. MERGED still removes the Worktree.

`orchestrator retry <target> <ticket-id>`, `recover <target>`, `stop <target>` are not Runs. Live Run: retry and recover refuse; Inspect stays read-only; stop SIGTERM then rematch (same function as recover). Inspect snapshot adds FAILED reason, leftover Worktree path, next startable Tickets. `inspect --follow` prints new events and exits when the Run has exited or the records are stale.

## User Stories

1. As an operator, I want leftover rematch to stamp MERGED only when Main already has that Ticket's merge commit, so a RUNNING Status commit on Main is not treated as done.

2. As an operator, I want completing a Ticket to be idempotent, so a merge commit already on Main is stamped MERGED and never merged again.

3. As an operator, I want drain start to use that same rematch, so Recover and the next drain do not disagree.

4. As an operator, I want a leftover in-flight Ticket without that merge commit stamped FAILED with its Worktree kept, so I can inspect the agent's commits.

5. As an operator, I want `orchestrator recover <target>` to rematch leftovers without starting a Run, so I can fix Status after a crash without draining new Tickets.

6. As an operator, I want recover refused while a Run is live, so two writers do not stamp Status at once.

7. As an operator, I want recover with no leftovers to exit success and change nothing.

8. As an operator, I want `orchestrator retry <target> <feature>/<NN>` on FAILED without a merge commit to stamp READY only, so the next drain continues that work.

9. As an operator, I want retry of FAILED whose merge commit is already on Main to stamp MERGED, so I do not empty-fail a Ticket that already landed (the 11 case).

10. As an operator, I want retry of a Ticket that is not FAILED to be refused, so READY/BLOCKED/MERGED/in-flight are not silently rewritten.

11. As an operator, I want retry refused while a Run is live.

12. As an operator, I want retry to take exactly one Ticket id, so the Orchestrator does not choose which FAILED tickets to revive.

13. As an operator, I want the next start after Retry to reuse the existing Worktree and branch, so unmerged agent commits are not deleted.

14. As an operator, I want that resume to integrate current Main first, so the agent works on the code state that includes later MERGED Tickets.

15. As an operator, I want uncommitted files kept on resume, with no `git reset --hard`, so a dirty FAILED tree is the same tree the agent sees next.

16. As an operator, I want resume that conflicts while integrating Main to use the existing Conflict Agent, then continue the Implementation Agent on that Worktree.

17. As an operator, I want a missing Worktree whose ticket branch still exists recreated from that branch, not from Main HEAD.

18. As an operator, I want first start (no tree, no branch) to keep creating the Worktree from Main HEAD after the RUNNING stamp.

19. As an operator, I want a dirty Worktree at merge time to stay FAILED, so resume does not weaken the Git contract.

20. As an operator, I want MERGED to still remove the Worktree and branch.

21. As an operator, I want empty merge (Main HEAD unchanged) to stay FAILED.

22. As an operator, I want `orchestrator stop <target>` to SIGTERM the live Run then rematch leftovers, so a stuck drain does not leave Status in-flight forever.

23. As an operator, I want stop with no live Run to exit non-zero and rematch nothing.

24. As an operator, I want stop not to `merge --abort` on Main, so an in-progress merge is not thrown away.

25. As an operator, I want rematch after stop to refuse the same way drain start refuses a dirty Main or MERGE_HEAD, so Main is not mixed with leftover stamps.

26. As an operator, I want Inspect of a Run to show FAILED reason, leftover Worktree path, and next startable Tickets, so I do not grep events and ticket files by hand.

27. As an operator, I want `orchestrator inspect <target> [id] --follow` to print new events until the Run has exited or the records are stale, so I can watch a detached drain.

28. As an operator, I want Inspect to stay read-only while a Run is live, so follow does not stamp Status.

29. As an operator, I want Inspect with no id to keep showing the live Run if there is one, otherwise the list of Runs.

30. As an operator, I want a second drain still refused while a Run is live.

31. As an operator, I want the Orchestrator still not to read diffs or judge code quality.

32. As an operator, I want merge still only to local Main, with no origin push.

33. As an operator, I want colors, TUI, notifications, and default `--detach` left unchanged.

34. As an operator, I want this work to stay this program, not an Archon workflow pack or Archon `--no-worktree` script host.

35. As an operator, I want Worktrunk / `agent-worktree` not introduced as the git engine.

36. As an operator, I want `uv sync --frozen` still before every agent session on resume, including Conflict Agent after a resume integrate.

37. As an operator, I want dependents still BLOCKED on FAILED, and other READY Tickets still able to run.

38. As an operator, I want next startable on Inspect to mean Status READY with every blocker MERGED, computed from current Ticket files.

## Implementation Decisions

- One seam: the Git contract. Drain start leftover rematch, Recover, Stop-after-SIGTERM, and Retry's "already complete" check share one complete/rematch function. CLI commands are thin callers. Inspect only reads.

- Complete means: Main has a merge commit whose message is `orchestrator: merge <ticket.branch>` and whose second parent is a commit of that Ticket branch. Do not use ancestry of the ticket branch vs HEAD.

- If complete: stamp MERGED, remove Worktree and branch, do not merge again, do not start an Implementation Agent.

- Leftover in-flight without that commit: stamp FAILED, keep Worktree.

- Retry: one id. Live Run → refuse. Not FAILED → refuse. FAILED and complete → stamp MERGED. FAILED and not complete → stamp READY, no Run.

- Recover: all leftover in-flight, same rematch. Live Run → refuse. Not a Run.

- Stop: SIGTERM the live Run pid from Run records; wait until that process is gone; then Recover. No live Run → non-zero. Do not `merge --abort`. If Main is dirty or MERGE_HEAD is present, rematch exits non-zero the same way a drain refuses dirty Main.

- First start: stamp RUNNING, create Worktree from Main HEAD (unchanged). Resume: stamp RUNNING, reuse Worktree/branch; integrate current Main; keep dirty files. Tree missing, branch exists: `worktree add` from that branch. Neither exists: from Main HEAD. Integrate conflict → existing Conflict Agent, then Implementation Agent on that tree.

- Inspect: add FAILED reason (from Journal events), leftover Worktree path if the directory exists, next startable Ticket ids from a read of current Ticket files. `--follow` tails new event lines; exit when Run exited or pid stale.

- Command names: `orchestrator retry <target> <id>`, `orchestrator recover <target>`, `orchestrator stop <target>`, `orchestrator inspect <target> [id] --follow`. cac subcommands. No new dependency.

- Do not change: serial merge lock, empty-merge FAILED, dirty-after-agent FAILED, Pi in-process, one live Run, local Main only, mechanical scheduler.

## Testing Decisions

- Test external behaviour on a temp Target: Status line, merge commits on Main, Worktree directory present or gone, CLI exit code and stdout. Do not test private helpers.

- Git contract: leftover with merge commit → MERGED and Worktree gone; leftover with only ancestry (RUNNING stamp, no merge commit) → FAILED and Worktree kept; empty merge still FAILED; resume keeps dirty files and ticket-branch commits; resume with branch and no tree recreates from the branch; retry of FAILED-with-merge-commit stamps MERGED and does not start a Worktree.

- Operator: retry/recover while a live Run (pid alive) refuse; retry of READY refuse; recover with no leftovers success; stop with no live Run non-zero; Inspect text includes FAILED reason, Worktree path, next startable; `--follow` exits after records show exited/stale.

- Prior art: the existing leftover MERGED/FAILED repros (change the MERGED case to require a merge commit, and add an ancestry-only case that must stay FAILED), empty-merge repro, inspect text repro, drain repro, merge-conflict repro.

## Out of Scope

- Archon, n8n, Worktrunk, `agent-worktree`, Beads, Gas Town
- Colors, TUI, desktop notifications, making `--detach` the default
- Auto-retry, retry-all, recover of a single id, stop of one Ticket
- Origin push, judging diffs, review as an Orchestrator stage
- Changing Target YAML beyond what already exists
- Rewriting 11's Status on endo_label from this spec (operator Recover after this ships)

## Further Notes

Code today still rematches leftovers with ancestry and deletes the Worktree on every start. That is the old implementation. This spec is the contract.

Historical product write-up: `.scratch/coding-orchestrator/spec.md`. Module names: `.scratch/architecture/spec.md`.
