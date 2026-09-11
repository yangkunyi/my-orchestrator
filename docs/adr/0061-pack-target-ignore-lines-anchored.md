# The Target's ignore lines are anchored

The pack commits two lines into the Target's `.gitignore`: `worktrees/` and `.venv/`. Unanchored, git matches them at any depth, so a Target with real sources under `src/worktrees/` — or a `.venv` below a package — has them ignored, and `worktreeDirty`, a `git status --porcelain` read, calls a Worktree holding such a file clean. Measured: `git check-ignore -v src/worktrees/x` answers `.gitignore:1:worktrees/` before the change and nothing after it; the alias list already accepted `/worktrees/`, so only the written line was wrong.

Both runners write into that file and both accept each other's spelling as satisfied — the pack writes `/worktrees/` and accepts `worktrees`/`worktrees/`, the CLI writes `worktrees/` and accepts `worktrees`/`/worktrees/` — so a Target prepared by either is left alone by the other and no Target is rewritten on every drain. A Target that already carries the unanchored line keeps its wider ignore: re-anchoring it means rewriting a committed line the Target's owner may also be editing, and the widening matters only for a Target that keeps sources in a directory of that name.

Both runners create the directory at the Target root (`<target>/worktrees/<feature>-<n>`), which is the only path the anchored line has to cover. `settle-repro.ts` pins the fresh Target's anchored lines, that a nested `src/worktrees/real.ts` makes the Worktree dirty, and that a legacy Target is left as it was; the unanchored mutation fails on the first of them.

Rejected: rewriting existing unanchored lines (one commit per Target per drain, and a diff in a file the Target owns); also ignoring `.scratch/worktrees/` (nothing creates it); not writing the lines at all (every Target would show the pack's own directory as untracked).
