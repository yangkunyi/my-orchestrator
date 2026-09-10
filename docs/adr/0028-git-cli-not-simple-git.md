# Git CLI via `execFile`, not simple-git

Git runs as `execFile("git", args, { cwd })`. `ok` is exit code 0. simple-git 3.36.0 treated a merge conflict as success: git exits 1 with `CONFLICT` on stdout and empty stderr, and simple-git only fails when `exitCode && stdErr.length`. `tryMerge` then saw HEAD unchanged and returned `"empty"`, leaving `MERGE_HEAD` on Main.

Supersedes the git sentence in ADR-0022.

Rejected: keep simple-git and special-case merge; `execa`.
