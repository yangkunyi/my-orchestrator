// This node body lives in the folder whose YAML declares `script: implement`, beside the skeleton it
// shares with the conflict node (ticket-node.ts). The pack's shared modules stay in
// ticket-dag-drain/scripts/, where the pack keeps them: the deployed archon refuses a pack-level
// `.shared/` folder, and its loader never validates imports (ADR-0037).
import type { TicketAgentOpts } from "../../ticket-dag-drain/scripts/agent.ts";
import type { SettleResult } from "../../ticket-dag-drain/scripts/node-outcomes.ts";
import { implementTask, readTddSkill } from "../../ticket-dag-drain/scripts/prompt.ts";
import { beginTicket, settleAfterAgent } from "../../ticket-dag-drain/scripts/transitions.ts";
import { runTicketNode, ticketNodeCli, type TicketNode } from "./ticket-node.ts";

export type { TicketAgentOpts };

/**
 * The implement node's own step: begin the Ticket, then hand the turn its Worktree, the implement
 * role's arguments (the Ticket and the tdd skill the machine has) and the settle that merges the
 * branch. beginTicket owns the RUNNING stamp, the Worktree and its environment (transitions.ts).
 */
const IMPLEMENT_NODE: TicketNode<"implement"> = {
  role: "implement",
  step: async (target, ticket) => {
    const begun = await beginTicket(target, ticket);
    if (begun.outcome !== "ready") return { stop: begun.outcome };
    return {
      cwd: begun.worktree,
      // The one machine fact an implement persona rests on, read where this call is composed. Read for
      // both runners: the persona is the same value either way, so it must not depend on which runner
      // happens to need the skill. Where the tree lives is prompt.ts's to say; that it is read here, and
      // not inside the role table, is this node's (roles.ts).
      args: { ticketId: ticket.id, skill: readTddSkill() },
      prompt: implementTask(ticket.relPath),
      settle: (lastError) => settleAfterAgent(target, ticket, begun.worktree, lastError),
    };
  },
};

export async function implementTicket(
  target: string,
  ticketId: string,
  opts: TicketAgentOpts,
): Promise<SettleResult> {
  return runTicketNode(IMPLEMENT_NODE, target, ticketId, opts);
}

export const runImplementCli = ticketNodeCli(IMPLEMENT_NODE);

if (import.meta.main) {
  await runImplementCli();
}
