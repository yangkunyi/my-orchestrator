# The mounted bash tool is one factory, and its environment is asserted by a real spawn

ADR-0050 left a residual: `spawnHook: piSpawnHook(opts.env)` could not be read back out of the tool definition the SDK builds, so replacing that hook with `(ctx) => ctx` — losing the Worktree's `.venv` from PATH — was caught by no test. Everything on either side of the call was asserted behaviourally; the call itself was left to review.

The session now mounts `piBashTool(sdk, {cwd, env})`, the one exported factory building `defineTool(createBashToolDefinition(cwd, {spawnHook: piSpawnHook(env)}))`, and `pi-sdk-repro.ts` drives that mounted definition: it executes `printf '%s\n' "$PWD" "$PATH"` through the tool the session would mount and asserts the child's cwd and a PATH leading with the Worktree's `.venv`. What Pi hands bash is now the spawned command's own output instead of a function's return value, and the no-op mutation fails with the PATH that came out of the spawn.

This closes ADR-0050's residual; its rule — the environment travels on the seam, applied by each adapter to its own base — is unchanged, and the call site is pinned by a test that mounts the tool, not by one that rebuilds it.

Rejected: leaving the call site to review (the residual was found by a review and survived two rounds); asserting the built definition's shape (the hook is closed over inside the SDK's definition, which is what made it unassertable); a test composing its own tool call (it would assert the test's composition rather than the session's mount).
