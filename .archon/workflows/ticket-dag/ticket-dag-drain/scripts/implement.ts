import {
  defaultAgent,
  implementPrompt,
  reexecForProxy,
  ticketSessionFile,
  type AgentRunner,
  type TicketAgentOpts,
} from "./agent.ts";
import { beginTicket } from "./begin.ts";
import { loadConfig, type PackConfig } from "./config.ts";
import { fail, settleAfterAgent, type SettleResult } from "./settle.ts";
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
  console.error(`${ticket.id} session ${ticketSessionFile(opts.artifactsDir, ticket.id, "implement")}`);
  try {
    const pi = await runAgent({
      cwd: begun.worktree,
      artifactsDir: opts.artifactsDir,
      ticketId: ticket.id,
      role: "implement",
      model: config.model,
      thinkingLevel: config.thinkingLevel,
      prompt: implementPrompt(ticket.relPath),
    });
    return settleAfterAgent(target, ticket, begun.worktree, pi.lastError);
  } catch (e) {
    await fail(target, ticket, e instanceof Error ? e.message : String(e));
    return "failed";
  }
}

export async function runImplementCli(): Promise<void> {
  reexecForProxy();
  const ticketId = process.env.INPUTS_TICKET?.trim();
  if (!ticketId) throw new Error("INPUTS_TICKET is required");
  const artifactsDir = process.env.ARTIFACTS_DIR;
  if (!artifactsDir) throw new Error("ARTIFACTS_DIR is required");
  const target = process.cwd();
  const config = loadConfig(target, process.env.INPUTS_CONFIG);
  const result = await implementTicket(target, ticketId, { artifactsDir, config });
  process.stdout.write(`${result}\n`);
}

if (import.meta.main) {
  await runImplementCli();
}
