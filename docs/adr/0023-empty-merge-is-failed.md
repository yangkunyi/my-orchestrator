# Empty merge is FAILED

`hasCommitsAhead` compares the ticket branch to **current Main**, not Main from before the RUNNING Status commit.

Worktree is created after `Status: RUNNING` is committed on Main, so that commit is already on the ticket branch. Counting it as agent work, then `git merge --no-ff` of an ancestor ("Already up to date"), used to stamp MERGED with no implementation.

`tryMerge` is FAILED if Main HEAD does not move.

Rejected: treating "already up to date" as a successful merge; comparing against a SHA captured before the RUNNING stamp.
