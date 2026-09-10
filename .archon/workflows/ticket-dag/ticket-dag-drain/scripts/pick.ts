import { loadConfig } from "./config.ts";
import { addAttempted, readAttempted } from "./attempted.ts";
import { hasTicketMergeCommit, stamp, withMergeLock } from "./git.ts";
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
  const target = process.cwd();
  const artifactsDir = process.env.ARTIFACTS_DIR;
  if (!artifactsDir) throw new Error("ARTIFACTS_DIR is required");
  const config = loadConfig(target, process.env.INPUTS_CONFIG);
  const picked = await pickStartable(target, { concurrency: config.concurrency, artifactsDir });
  process.stdout.write(JSON.stringify(picked.map((t) => t.id)));
}
