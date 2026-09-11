// This node body lives in the folder whose YAML declares `script: conflict`, beside the skeleton it
// shares with the implement node (ticket-node.ts). The pack's shared modules stay in
// ticket-dag-drain/scripts/, where the pack keeps them: the deployed archon refuses a pack-level
// `.shared/` folder, and its loader never validates imports (ADR-0037).
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { TicketAgentOpts } from "../../ticket-dag-drain/scripts/agent.ts";
import type { SettleResult } from "../../ticket-dag-drain/scripts/node-outcomes.ts";
import { failTicket, withMergeLock } from "../../ticket-dag-drain/scripts/main-writes.ts";
import { conflictTask } from "../../ticket-dag-drain/scripts/prompt.ts";
import { markResolving, settleAfterConflict } from "../../ticket-dag-drain/scripts/transitions.ts";
import { syncWorktreeEnv } from "../../ticket-dag-drain/scripts/worktree-env.ts";
import { runTicketNode, ticketNodeCli, type TicketNode } from "./ticket-node.ts";

/**
 * The conflict node's own step: the Worktree must exist, the Ticket goes RESOLVING (one Main write,
 * and the turn stays outside the lock), the Worktree environment is re-synced, and only then does the
 * turn run - settling by re-merging the branch onto Main.
 */
const CONFLICT_NODE: TicketNode<"conflict"> = {
  role: "conflict",
  step: async (target, ticket) => {
    const worktree = join(target, ticket.worktreeRel);
    if (!existsSync(worktree)) {
      // One FAILED stamp, its own transaction: nothing is held here.
      await withMergeLock(target, () => failTicket(target, ticket, `worktree missing: ${worktree}`));
      return { stop: "failed" };
    }
    await markResolving(target, ticket);
    try {
      await syncWorktreeEnv(worktree);
    } catch (e) {
      // Same as the missing-Worktree path: its own transaction, one stamp.
      await withMergeLock(target, () =>
        failTicket(target, ticket, e instanceof Error ? e.message : String(e)),
      );
      return { stop: "failed" };
    }
    return {
      cwd: worktree,
      args: { ticketId: ticket.id },
      prompt: conflictTask(ticket.relPath),
      settle: (lastError) => settleAfterConflict(target, ticket, worktree, lastError),
    };
  },
};

export async function conflictTicket(
  target: string,
  ticketId: string,
  opts: TicketAgentOpts,
): Promise<SettleResult> {
  return runTicketNode(CONFLICT_NODE, target, ticketId, opts);
}

const runConflictCli = ticketNodeCli(CONFLICT_NODE);

if (import.meta.main) {
  await runConflictCli();
}
