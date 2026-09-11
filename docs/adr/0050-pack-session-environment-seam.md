# The session environment travels on the seam

`PackAgentOpts.env` is required: a transform `(base: ProcessEnv) => ProcessEnv`, the environment that belongs with `cwd`, applied by each adapter to its own base — Pi's spawn hook and dsh's child env. `roles.ts` supplies it from the call's cwd through `sessionEnv`, which puts the Worktree's `.venv/bin` first and returns the base untouched when there is no `.venv/bin`, so the drain-end readers (whose cwd is the Target) are unaffected.

Before this the fact was adapter-local: `prependVenvBin` had exactly one caller, the Pi bash tool, so `runner: dsh` ran a Worktree session without its `.venv` on PATH — contradicting the CONTEXT rule that a Ticket session's bash uses this Worktree's `.venv`. This is ADR-0040's rule (an option must not be one only a single adapter honours) applied to the environment.

It is a transform rather than a resolved env so that Pi keeps its spawn context's other keys and dsh keeps its `DSH_*` variables. `prependVenvBin` is gone: one concept, one implementation, two callers.

The residual recorded here — `spawnHook: piSpawnHook(opts.env)` could not be read back out of the tool definition the SDK builds, so a `(ctx) => ctx` no-op was caught by no test — is closed by ADR-0060: the session mounts the tool through one factory and a repro drives that definition, asserting the environment a real spawn sees.

Rejected: each adapter composing PATH on its own (the drift this removes); a resolved env value on the seam (every adapter would have to merge its own base back in); the no-op guard living in the adapters rather than in the one function that owns the rule.
