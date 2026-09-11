// This node body lives in the folder whose YAML declares `script: implement`. The modules it uses stay
// in ticket-dag-drain/scripts/, where the pack keeps them: the deployed archon refuses a pack-level
// `.shared/` folder, and its loader never validates imports (ADR-0037).
import { defaultAgent, RunnerUnavailable, type AgentRunner, type TicketAgentOpts } from "../../ticket-dag-drain/scripts/agent.ts";
import { beginTicket } from "../../ticket-dag-drain/scripts/begin.ts";
import { loadConfig, type PackConfig } from "../../ticket-dag-drain/scripts/config.ts";
import { failTicket, withMergeLock } from "../../ticket-dag-drain/scripts/main-writes.ts";
import { runNode } from "../../ticket-dag-drain/scripts/node-entry.ts";
import { nodeLine, type SettleResult } from "../../ticket-dag-drain/scripts/node-outcomes.ts";
import { implementTask, readTddSkill } from "../../ticket-dag-drain/scripts/prompt.ts";
import { roleAgent } from "../../ticket-dag-drain/scripts/roles.ts";
import { settleAfterAgent } from "../../ticket-dag-drain/scripts/settle.ts";
import { scanTickets } from "../../ticket-dag-drain/scripts/tickets.ts";

export type { TicketAgentOpts };

export async function implementTicket(
  target: string,
  ticketId: string,
  opts: TicketAgentOpts,
): Promise<SettleResult> {
  const ticket = scanTickets(target).find((t) => t.id === ticketId);
  if (!ticket) throw new Error(`ticket not found: ${ticketId}`);
  const begun = await beginTicket(target, ticket);
  if (begun.outcome !== "ready") return begun.outcome;
  const config: PackConfig = opts.config ?? loadConfig(target);
  const runAgent: AgentRunner = opts.runAgent ?? defaultAgent;
  const agentOpts = roleAgent({
    role: "implement",
    // The one machine fact an implement persona rests on, read where this call is composed. Read for
    // both runners: the persona is the same value either way, so it must not depend on which runner
    // happens to need the skill. Where the tree lives is prompt.ts's to say; that it is read here, and
    // not inside the role table, is this node's (roles.ts).
    args: { ticketId: ticket.id, skill: readTddSkill() },
    cwd: begun.worktree,
    artifactsDir: opts.artifactsDir,
    config,
    prompt: implementTask(ticket.relPath),
  });
  try {
    const turn = await runAgent(agentOpts);
    // Where a turn's session lives is the runner's to know: dsh names its log only once it has run, so
    // the node reports the path that came back rather than a formula of its own.
    console.error(`${ticket.id} session ${turn.sessionFile}`);
    return settleAfterAgent(target, ticket, begun.worktree, turn.lastError);
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

export async function runImplementCli(): Promise<void> {
  await runNode({
    ticket: true,
    artifacts: true,
    proxy: true,
    run: async ({ target, ticketId, artifactsDir, config }) =>
      nodeLine(await implementTicket(target, ticketId, { artifactsDir, config })),
  });
}

if (import.meta.main) {
  await runImplementCli();
}
