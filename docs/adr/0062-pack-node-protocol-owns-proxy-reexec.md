# The Script-node protocol owns the proxy re-exec

`proxy.ts` held fifteen lines: `proxyEnv` (the base environment plus `NODE_USE_ENV_PROXY=1`, never inventing `httpProxy`) and `reexecForProxy` (re-exec this node under that environment unless the flag is already set, then leave with the child's status). Its only production caller was `node-entry.ts` — the module that already owns what every Script node does: read `INPUTS_*`, run the handler, write one stdout token, choose the exit code — and `NodeOpts.proxy` names the rule there. The re-exec is part of that protocol, not a module of its own.

Both functions now live in `node-entry.ts` and `proxy.ts` is gone. The re-exec takes its spawn and exit as optional parameters, so `agent-repro.ts` asserts the argv, the environment it would run under and the exit code it would leave with, without spawning a second full node for a one-line question.

Rejected: keeping the module (one caller and an existing owner); leaving the call unasserted (the rule had no test at all, and the re-exec is skipped whenever `NODE_USE_ENV_PROXY` is already set, which is what the test harness does); proving it by really re-execing a node (a full second node for the same question).
