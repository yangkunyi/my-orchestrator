import { fail } from "./settle.ts";
import { scanTickets } from "./tickets.ts";

export async function conflictTicket(target: string, ticketId: string): Promise<"failed"> {
  const ticket = scanTickets(target).find((t) => t.id === ticketId);
  if (!ticket) throw new Error(`ticket not found: ${ticketId}`);
  await fail(target, ticket, "merge still broken after conflict");
  return "failed";
}

export async function runConflictCli(): Promise<void> {
  const ticketId = process.env.INPUTS_TICKET?.trim();
  if (!ticketId) throw new Error("INPUTS_TICKET is required");
  const result = await conflictTicket(process.cwd(), ticketId);
  process.stdout.write(`${result}\n`);
}

if (import.meta.main) {
  await runConflictCli();
}
