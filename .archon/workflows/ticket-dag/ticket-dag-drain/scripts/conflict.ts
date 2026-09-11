import { existsSync } from "node:fs";
import { join } from "node:path";
import { defaultAgent, type AgentRunner, type TicketAgentOpts } from "./agent.ts";
import { conflictTask } from "./prompt.ts";
import { roleAgent } from "./roles.ts";
import { syncWorktreeEnv } from "./worktree-env.ts";
import { loadConfig, type PackConfig } from "./config.ts";
import { runNode } from "./node-entry.ts";
import { nodeLine } from "./node-outcomes.ts";
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
  // RESOLVING is one Main write and the agent run below stays outside the lock, so this is the
  // whole transaction.
  await withMergeLock(target, () => stamp(target, ticket, "RESOLVING"));
  try {
    await syncWorktreeEnv(worktree);
  } catch (e) {
    await fail(target, ticket, e instanceof Error ? e.message : String(e));
    return "failed";
  }
  const config: PackConfig = opts.config ?? loadConfig(target);
  const runAgent: AgentRunner = opts.runAgent ?? defaultAgent;
  const agentOpts = roleAgent({
    role: "conflict",
    args: { ticketId: ticket.id },
    cwd: worktree,
    artifactsDir: opts.artifactsDir,
    config,
    prompt: conflictTask(ticket.relPath),
  });
  try {
    const turn = await runAgent(agentOpts);
    // Same as the implement node: the runner reports where its session lives, the node says so.
    console.error(`${ticket.id} session ${turn.sessionFile}`);
    return settleAfterConflict(target, ticket, worktree, turn.lastError);
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
      nodeLine(await conflictTicket(target, ticketId, { artifactsDir, config })),
  });
}

if (import.meta.main) {
  await runConflictCli();
}
