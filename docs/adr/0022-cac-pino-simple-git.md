# cac, pino, simple-git; homemade detach / tickets / scheduler

CLI parsing is `cac`. Run events are `pino` JSON lines in the Run dir (`events.log`); inspect formats them for humans. Git invocations go through `simple-git`. `--detach` stays Node `spawn({detached:true})` — that is the platform mechanism; `daemonize-process` is the same spawn and loses parent-side pid. Ticket `**Status:**` lines stay regex. The scheduling loop stays in this repo: DAG rebuilt from `.scratch` each cycle, a node finishes at git MERGED, not at promise resolve (`p-graph` / `p-queue` do not fit).

Rejected: `daemonize-process`, `commander`, `pino-pretty`, `winston`, `execa`, `gray-matter`, `remark`, `p-queue`, `p-graph`, pm2, systemd as the Run inspector.
