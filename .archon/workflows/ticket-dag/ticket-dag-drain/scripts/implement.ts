import { beginTicket } from "./begin.ts";
import { settleAfterAgent, type SettleResult } from "./settle.ts";
import { scanTickets } from "./tickets.ts";

export async function implementTicket(target: string, ticketId: string): Promise<SettleResult> {
  const ticket = scanTickets(target).find((t) => t.id === ticketId);
  if (!ticket) throw new Error(`ticket not found: ${ticketId}`);
  const begun = await beginTicket(target, ticket);
  if (begun.outcome !== "ready") return begun.outcome;
  return settleAfterAgent(target, ticket, begun.worktree);
}

export async function runImplementCli(): Promise<void> {
  const ticketId = process.env.INPUTS_TICKET?.trim();
  if (!ticketId) throw new Error("INPUTS_TICKET is required");
  const result = await implementTicket(process.cwd(), ticketId);
  process.stdout.write(`${result}\n`);
}

if (import.meta.main) {
  await runImplementCli();
}
