# This repo is the tool

Orchestrator source lives here. It schedules a Target git repo given as a required path argument. Tickets and Worktrees live in the Target, not in this repository.

Rejected: using this repo as the only scheduled tree; copying the scheduler into every project; inferring Target from cwd.
