// This node body lives in the folder whose YAML declares `script: conflict`. The modules it uses stay
// in ticket-dag-drain/scripts/, where the pack keeps them: the deployed archon refuses a pack-level
// `.shared/` folder, and its loader never validates imports (ADR-0037).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defaultAgent, RunnerUnavailable, type AgentRunner, type TicketAgentOpts } from "../../ticket-dag-drain/scripts/agent.ts";
import { conflictTask } from "../../ticket-dag-drain/scripts/prompt.ts";
import { roleAgent } from "../../ticket-dag-drain/scripts/roles.ts";
import { syncWorktreeEnv } from "../../ticket-dag-drain/scripts/worktree-env.ts";
import { loadConfig, type PackConfig } from "../../ticket-dag-drain/scripts/config.ts";
import { runNode } from "../../ticket-dag-drain/scripts/node-entry.ts";
import { nodeLine } from "../../ticket-dag-drain/scripts/node-outcomes.ts";
import { failTicket, stamp, withMergeLock } from "../../ticket-dag-drain/scripts/main-writes.ts";
import { settleAfterConflict } from "../../ticket-dag-drain/scripts/settle.ts";
import { scanTickets } from "../../ticket-dag-drain/scripts/tickets.ts";

export async function conflictTicket(
  target: string,
  ticketId: string,
  opts: TicketAgentOpts,
): Promise<"merged" | "failed"> {
  const ticket = scanTickets(target).find((t) => t.id === ticketId);
  if (!ticket) throw new Error(`ticket not found: ${ticketId}`);
  const worktree = join(target, ticket.worktreeRel);
  if (!existsSync(worktree)) {
    // One FAILED stamp, its own transaction: nothing is held here.
    await withMergeLock(target, () => failTicket(target, ticket, `worktree missing: ${worktree}`));
    return "failed";
  }
  // RESOLVING is one Main write and the agent run below stays outside the lock, so this is the
  // whole transaction.
  await withMergeLock(target, () => stamp(target, ticket, "RESOLVING"));
  try {
    await syncWorktreeEnv(worktree);
  } catch (e) {
    // Same as the missing-Worktree path: its own transaction, one stamp.
    await withMergeLock(target, () =>
      failTicket(target, ticket, e instanceof Error ? e.message : String(e)),
    );
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
    // Same as the implement node: a runner that never started is not this Ticket's failure. The reason
    // is recorded on the Ticket here, and the error leaves so the node exits non-zero and the drain
    // stops (node-entry.ts: a Git-contract outcome exits 0, a throw does not).
    if (e instanceof RunnerUnavailable) {
      await withMergeLock(target, () => failTicket(target, ticket, e.message));
      throw e;
    }
    // The conflict turn threw where an outcome is expected: one FAILED stamp, its own transaction.
    await withMergeLock(target, () =>
      failTicket(target, ticket, e instanceof Error ? e.message : String(e)),
    );
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
