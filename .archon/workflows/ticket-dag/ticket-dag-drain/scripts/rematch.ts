import { addAttempted } from "./attempted.ts";
import { completeTicket, failTicket, hasTicketMergeCommit, withMergeLock } from "./main-writes.ts";
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
        // The one FAILED writer, so the reason is recorded too - this used to be a bare stamp.
        await failTicket(target, ticket, "leftover in flight and Main has no merge commit of its branch");
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
