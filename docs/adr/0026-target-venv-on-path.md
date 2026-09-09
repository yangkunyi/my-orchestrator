# Target `.venv/bin` is on the Run PATH

The Run process prepends `{target}/.venv/bin` to `PATH` when that directory exists. Worktrees share the Target interpreter. They do not copy or symlink `.venv`.

Tests import the Worktree package via the Target repo's pytest `pythonpath = ["."]` (relative to the Worktree cwd). Not `pip install -e` of Main into the venv. Not `PYTHONPATH` of one Worktree on the Run process — concurrency would mix trees.

Rejected: conda env as Worktree isolation; symlink `.venv` into the Worktree; wrapping bash just to export `PYTHONPATH`.

Superseded by [ADR-0027](0027-per-worktree-uv-sync.md).

