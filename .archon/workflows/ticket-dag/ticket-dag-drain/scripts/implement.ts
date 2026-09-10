import { defaultAgent, type AgentRunner, type TicketAgentOpts } from "./agent.ts";
import { beginTicket } from "./begin.ts";
import { loadConfig, type PackConfig } from "./config.ts";
import { runNode } from "./node-entry.ts";
import { nodeLine, type SettleResult } from "./node-outcomes.ts";
import { implementTask } from "./prompt.ts";
import { roleAgent } from "./roles.ts";
import { fail, settleAfterAgent } from "./settle.ts";
import { scanTickets } from "./tickets.ts";

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
  const agent = roleAgent({
    role: "implement",
    args: { ticketId: ticket.id },
    cwd: begun.worktree,
    artifactsDir: opts.artifactsDir,
    config,
    prompt: implementTask(ticket.relPath),
  });
  console.error(`${ticket.id} session ${agent.sessionFile}`);
  try {
    const pi = await runAgent(agent.opts);
    return settleAfterAgent(target, ticket, begun.worktree, pi.lastError);
  } catch (e) {
    await fail(target, ticket, e instanceof Error ? e.message : String(e));
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
