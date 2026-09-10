// ponytail: execute's implement/conflict re-export drain's bodies because the installed archon
// (v0.10.1) rejects a pack-level shared folder: "Invalid packaged workflow directory: '<pack>/.shared'".
// A pack subdirectory must be a workflow holding exactly one YAML, and dot-prefixed names are refused,
// so the migration to <pack>/.shared/ is parked on branch
// pi-subagents/c5-shared-layout-38b9764-8290-s0-t0 @ commit c3c877e - cherry-pick it once the deployed
// archon supports that layout (the archon-cli authoring docs already describe it).
import { runConflictCli } from "../../ticket-dag-drain/scripts/conflict.ts";

await runConflictCli();
