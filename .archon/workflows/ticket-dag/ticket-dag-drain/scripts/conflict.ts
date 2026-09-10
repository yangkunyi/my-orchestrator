import { existsSync } from "node:fs";
import { join } from "node:path";
import { defaultAgent, type AgentRunner, type TicketAgentOpts } from "./agent.ts";
import { conflictTask } from "./prompt.ts";
import { roleAgent } from "./roles.ts";
import { syncWorktreeEnv } from "./worktree-env.ts";
import { loadConfig, type PackConfig } from "./config.ts";
import { runNode } from "./node-entry.ts";
import { fail, settleAfterConflict } from "./settle.ts";
import { stamp, withMergeLock } from "./main-writes.ts";
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
  const agent = roleAgent({
    role: "conflict",
    args: { ticketId: ticket.id },
    cwd: worktree,
    artifactsDir: opts.artifactsDir,
    config,
    prompt: conflictTask(ticket.relPath),
  });
  console.error(`${ticket.id} session ${agent.sessionFile}`);
  try {
    const pi = await runAgent(agent.opts);
    return settleAfterConflict(target, ticket, worktree, pi.lastError);
  } catch (e) {
    await fail(target, ticket, e instanceof Error ? e.message : String(e));
    return "failed";
  }
}

export async function runConflictCli(): Promise<void> {
  await runNode({
    ticket: true,
    artifacts: true,
    proxy: true,
    run: async ({ target, ticketId, artifactsDir, config }) =>
      `${await conflictTicket(target, ticketId, { artifactsDir, config })}\n`,
  });
}

if (import.meta.main) {
  await runConflictCli();
}
