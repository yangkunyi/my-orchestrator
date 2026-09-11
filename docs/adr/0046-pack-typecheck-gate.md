# The pack has a dev-only typecheck gate

`tsconfig.pack.json` at the repository root typechecks the pack: `include` is `.archon/workflows/ticket-dag/**/*.ts` plus `pack-globals.d.ts`, with `strict`, `noUncheckedIndexedAccess`, `noEmit`, `allowImportingTsExtensions` and `types: []`. The command is `node_modules/.bin/tsc -p tsconfig.pack.json`, and it must stay at zero errors. `pack-globals.d.ts` declares only what bun has and tsc does not (`import.meta.dir`, `import.meta.main`); installing a bun type package would be a new dependency for two members.

Both files live in the repository and never inside the pack folder, because that folder is copied to `~/.archon/workflows/` and must carry nothing the runtime cannot use. The gate is therefore dev-only: the deployed copy cannot be typechecked by design, and the pack's other gate remains the repro scripts.

The pack was wrong, not the SDK's types. The injected bash tool goes through the SDK's own `defineTool`, because `customTools?: ToolDefinition[]` widens params to `unknown` and `defineTool` exists for exactly that case. One wrapper, no cast, and the spawn hook is untouched.

It earned its keep the day it landed: a YAML contract test written in a worktree that predated the gate failed it with TS2352 within minutes of being merged, and the same gate found a stale caller in a dsh test file.

Rejected: installing bun's types (a dependency for two members); putting the globals inside the pack (the deployed copy would carry them); casting the tool definition (the SDK already has the right shape); adding the pack to the root `tsconfig.json` (it includes `src` only, and the pack is not part of the CLI's build).
