import { addAttempted } from "./attempted.ts";
import { completeTicket, hasTicketMergeCommit, stamp, withMergeLock } from "./main-writes.ts";
import { runNode } from "./node-entry.ts";
import { writeReviewBase } from "./review-artifacts.ts";
import { leftoverInFlight, scanTickets } from "./tickets.ts";

export async function rematchLeftovers(target: string, artifactsDir?: string): Promise<void> {
  await withMergeLock(target, async () => {
    const failedIds: string[] = [];
    for (const ticket of leftoverInFlight(scanTickets(target))) {
      if (await hasTicketMergeCommit(target, ticket.branch)) {
        await completeTicket(target, ticket);
      } else {
        await stamp(target, ticket, "FAILED");
        failedIds.push(ticket.id);
      }
    }
    if (artifactsDir) addAttempted(artifactsDir, failedIds);
    if (artifactsDir) await writeReviewBase(target, artifactsDir);
  });
}

if (import.meta.main) {
  await runNode({
    artifacts: true,
    run: ({ target, artifactsDir }) => rematchLeftovers(target, artifactsDir),
  });
}
