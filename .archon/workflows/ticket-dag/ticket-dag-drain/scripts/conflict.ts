import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  conflictPrompt,
  defaultAgent,
  reexecForProxy,
  ticketSessionFile,
  type AgentRunner,
  type TicketAgentOpts,
} from "./agent.ts";
import { syncWorktreeEnv } from "./worktree-env.ts";
import { loadConfig, type PackConfig } from "./config.ts";
import { fail, settleAfterConflict } from "./settle.ts";
import { stamp, withMergeLock } from "./git.ts";
import { scanTickets } from "./tickets.ts";

export async function conflictTicket(
  target: string,
  ticketId: string,
  opts: TicketAgentOpts,
): Promise<"merged" | "failed"> {
  const ticket = scanTickets(target).find((t) => t.id === ticketId);
  if (!ticket) throw new Error(`ticket not found: ${ticketId}`);
  const worktree = join(target, ticket.worktreeRel);
  if (!existsSync(worktree)) {
    await fail(target, ticket, `worktree missing: ${worktree}`);
    return "failed";
  }
  await withMergeLock(target, async () => {
    await stamp(target, ticket, "RESOLVING");
  });
  try {
    await syncWorktreeEnv(worktree);
  } catch (e) {
    await fail(target, ticket, e instanceof Error ? e.message : String(e));
    return "failed";
  }
  const config: PackConfig = opts.config ?? loadConfig(target);
  const runAgent: AgentRunner = opts.runAgent ?? defaultAgent;
  console.error(`${ticket.id} session ${ticketSessionFile(opts.artifactsDir, ticket.id, "conflict")}`);
  try {
    const pi = await runAgent({
      cwd: worktree,
      artifactsDir: opts.artifactsDir,
      ticketId: ticket.id,
      role: "conflict",
      model: config.model,
      thinkingLevel: config.thinkingLevel,
      prompt: conflictPrompt(ticket.relPath),
    });
    return settleAfterConflict(target, ticket, worktree, pi.lastError);
  } catch (e) {
    await fail(target, ticket, e instanceof Error ? e.message : String(e));
    return "failed";
  }
}

export async function runConflictCli(): Promise<void> {
  reexecForProxy();
  const ticketId = process.env.INPUTS_TICKET?.trim();
  if (!ticketId) throw new Error("INPUTS_TICKET is required");
  const artifactsDir = process.env.ARTIFACTS_DIR;
  if (!artifactsDir) throw new Error("ARTIFACTS_DIR is required");
  const target = process.cwd();
  const config = loadConfig(target, process.env.INPUTS_CONFIG);
  const result = await conflictTicket(target, ticketId, { artifactsDir, config });
  process.stdout.write(`${result}\n`);
}

if (import.meta.main) {
  await runConflictCli();
}
