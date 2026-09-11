/**
 * The skeleton both ticket nodes run around their own step: find the Ticket, take the node's step,
 * build the role's agent opts (the session key, persona and wall clock come from roles.ts), run the
 * turn, report the session the runner returned, and map the throw - a runner that could not start
 * records the reason on the Ticket and rethrows so the node exits non-zero and the drain stops
 * (ADR-0051), while any other throw is this Ticket's FAILED (ADR-0042, ADR-0049). The Script-node
 * entry is the skeleton's too, because both nodes spell the same flags.
 *
 * implement and conflict were two copies of that protocol, differing only in the step before the
 * turn. The reason this module exists is where the policy is written, not how many lines it saves:
 * the error policy above is one rule about every ticket node, and a third node would have been a
 * third copy of it.
 *
 * This file is a library, not a node: it carries no `import.meta.main` block, because every entry
 * script in a workflow folder has to be a node declared in that folder's YAML (yaml-contract-repro).
 * It sits in scripts/ beside the two node bodies it serves, importing the pack the same way they do -
 * the deployed archon refuses a pack-level `.shared/` folder and never validates imports (ADR-0037).
 */
import {
  defaultAgent,
  RunnerUnavailable,
  type AgentRunner,
  type TicketAgentOpts,
} from "../../ticket-dag-drain/scripts/agent.ts";
import { loadConfig, type PackConfig } from "../../ticket-dag-drain/scripts/config.ts";
import { failTicket, withMergeLock } from "../../ticket-dag-drain/scripts/main-writes.ts";
import { runNode } from "../../ticket-dag-drain/scripts/node-entry.ts";
import { nodeLine, type SettleResult } from "../../ticket-dag-drain/scripts/node-outcomes.ts";
import { roleAgent, type RoleShape } from "../../ticket-dag-drain/scripts/roles.ts";
import { scanTickets, type Ticket } from "../../ticket-dag-drain/scripts/tickets.ts";

/** The roles a ticket node runs: each is one node that takes a Ticket id and drives one turn. */
export type TicketRole = "implement" | "conflict";

/**
 * What a node's own step leaves behind: an outcome to stop at, with no agent spent (implement's begin
 * may fail or ask for the Conflict Agent, conflict's Worktree check or env sync may fail), or the
 * shape of the turn and what settles it afterwards. The `settle` closure holds the Worktree the node
 * resolved, so the skeleton never guesses where a turn ran.
 */
export type TicketTurn<R extends TicketRole> =
  | { stop: SettleResult }
  | {
      cwd: string;
      args: RoleShape[R];
      prompt: string;
      settle: (lastError?: string) => Promise<SettleResult>;
    };

/**
 * One ticket node: the role it runs, and the step only it knows. The step is handed the Ticket the
 * skeleton found, and everything around its decision - the role's opts, the turn, the error policy,
 * the CLI - is not a node's business.
 */
export type TicketNode<R extends TicketRole> = {
  role: R;
  step: (target: string, ticket: Ticket) => TicketTurn<R> | Promise<TicketTurn<R>>;
};

/** Run one ticket node end to end: the lookup, the turn, the session report and the error mapping. */
export async function runTicketNode<R extends TicketRole>(
  node: TicketNode<R>,
  target: string,
  ticketId: string,
  opts: TicketAgentOpts,
): Promise<SettleResult> {
  const ticket = scanTickets(target).find((t) => t.id === ticketId);
  if (!ticket) throw new Error(`ticket not found: ${ticketId}`);
  const step = await node.step(target, ticket);
  if ("stop" in step) return step.stop;
  const config: PackConfig = opts.config ?? loadConfig(target);
  const runAgent: AgentRunner = opts.runAgent ?? defaultAgent;
  const agentOpts = roleAgent({
    role: node.role,
    args: step.args,
    cwd: step.cwd,
    artifactsDir: opts.artifactsDir,
    config,
    prompt: step.prompt,
  });
  try {
    const turn = await runAgent(agentOpts);
    // Where a turn's session lives is the runner's to know: dsh names its log only once it has run, so
    // the node reports the path that came back rather than a formula of its own.
    console.error(`${ticket.id} session ${turn.sessionFile}`);
    return step.settle(turn.lastError);
  } catch (e) {
    // The runner never started, so this Ticket's work did not fail - a Ticket no agent saw must not be
    // recorded as one whose work did. The attempt is over, so the reason goes on the Ticket where
    // every other reason goes, and the error is rethrown: the node exits non-zero and Archon stops the
    // drain here instead of marking the whole startable backlog FAILED (node-entry.ts).
    if (e instanceof RunnerUnavailable) {
      await withMergeLock(target, () => failTicket(target, ticket, e.message));
      throw e;
    }
    // The turn threw where a returned outcome is expected: one FAILED stamp, its own transaction.
    await withMergeLock(target, () =>
      failTicket(target, ticket, e instanceof Error ? e.message : String(e)),
    );
    return "failed";
  }
}

/** The node's Script-node entry: the env in, one outcome token out. Every ticket node ends this way. */
export function ticketNodeCli<R extends TicketRole>(node: TicketNode<R>): () => Promise<void> {
  return async () => {
    await runNode({
      ticket: true,
      artifacts: true,
      proxy: true,
      run: async ({ target, ticketId, artifactsDir, config }) =>
        nodeLine(await runTicketNode(node, target, ticketId, { artifactsDir, config })),
    });
  };
}
