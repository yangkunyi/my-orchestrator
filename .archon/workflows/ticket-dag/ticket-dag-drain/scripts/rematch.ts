import { addAttempted } from "./attempted.ts";
import { withMergeLock } from "./main-writes.ts";
import { runNode } from "./node-entry.ts";
import { writeReviewBase } from "./review-artifacts.ts";
import { leftoverInFlight, scanTickets } from "./tickets.ts";
import { recoverLeftover } from "./transitions.ts";

export async function rematchLeftovers(target: string, artifactsDir?: string): Promise<void> {
  await withMergeLock(target, async () => {
    const failedIds: string[] = [];
    for (const ticket of leftoverInFlight(scanTickets(target))) {
      // recoverLeftover is transitions.ts's verb: MERGED iff Main has the merge commit, else FAILED
      // with the reason recorded. The left-behind branch and Worktree stay for the next drain.
      if ((await recoverLeftover(target, ticket)) === "failed") failedIds.push(ticket.id);
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
