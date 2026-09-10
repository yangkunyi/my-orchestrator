import { addAttempted } from "./attempted.ts";
import { loadConfig } from "./config.ts";
import { hasTicketMergeCommit, removeWorktreeAndBranch, stamp, withMergeLock } from "./git.ts";
import { leftoverInFlight, scanTickets } from "./tickets.ts";

export async function rematchLeftovers(target: string, artifactsDir?: string): Promise<void> {
  await withMergeLock(target, async () => {
    const failedIds: string[] = [];
    for (const ticket of leftoverInFlight(scanTickets(target))) {
      if (await hasTicketMergeCommit(target, ticket.branch)) {
        await stamp(target, ticket, "MERGED");
        await removeWorktreeAndBranch(target, ticket);
      } else {
        await stamp(target, ticket, "FAILED");
        failedIds.push(ticket.id);
      }
    }
    if (artifactsDir) addAttempted(artifactsDir, failedIds);
  });
}

if (import.meta.main) {
  const target = process.cwd();
  const artifactsDir = process.env.ARTIFACTS_DIR;
  if (!artifactsDir) throw new Error("ARTIFACTS_DIR is required");
  loadConfig(target, process.env.INPUTS_CONFIG);
  await rematchLeftovers(target, artifactsDir);
}
