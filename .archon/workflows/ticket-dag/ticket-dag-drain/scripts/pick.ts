import { addAttempted, readAttempted } from "./attempted.ts";
import { hasTicketMergeCommit, stamp, withMergeLock } from "./main-writes.ts";
import { runNode } from "./node-entry.ts";
import { nodeLine } from "./node-outcomes.ts";
import { blockersMerged, byId, scanTickets, type Ticket } from "./tickets.ts";

export type PickOpts = {
  concurrency: number;
  artifactsDir: string;
};

function isStartableStatus(status: Ticket["status"]): boolean {
  return status === "READY" || status === "FAILED";
}

export async function pickStartable(target: string, opts: PickOpts): Promise<Ticket[]> {
  const { concurrency, artifactsDir } = opts;
  return withMergeLock(target, async () => {
    const attempted = readAttempted(artifactsDir);
    const current = scanTickets(target);
    const curMap = byId(current);
    for (const t of current) {
      if (t.status === "BLOCKED" && blockersMerged(t, curMap)) {
        await stamp(target, t, "READY");
      }
    }
    const tickets = scanTickets(target);
    const map = byId(tickets);
    const picked: Ticket[] = [];
    for (const t of tickets) {
      if (picked.length >= Math.max(0, concurrency)) break;
      if (!isStartableStatus(t.status)) continue;
      if (!blockersMerged(t, map)) continue;
      if (attempted.has(t.id)) continue;
      if (await hasTicketMergeCommit(target, t.branch)) continue;
      picked.push(t);
    }
    addAttempted(
      artifactsDir,
      picked.map((t) => t.id),
    );
    return picked;
  });
}

if (import.meta.main) {
  await runNode({
    artifacts: true,
    run: async ({ target, artifactsDir, config }) => {
      const picked = await pickStartable(target, { concurrency: config.concurrency, artifactsDir });
      return nodeLine(JSON.stringify(picked.map((t) => t.id)));
    },
  });
}
