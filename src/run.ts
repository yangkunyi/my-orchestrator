import type { Config } from "./config.js";
import {
  conflictPrompt,
  implementPrompt,
  runPi,
  ticketSessionFile,
} from "./agent.js";
import { beginTicket, fail, recoverLeftovers, settleAfterAgent, settleAfterConflict } from "./contract.js";
import {
  assertCleanMain,
  ensureRunsIgnored,
  ensureVenvIgnored,
  ensureWorktreesIgnored,
  withMergeLock,
} from "./git.js";
import type { Journal } from "./journal.js";
import { stamp } from "./status.js";
import {
  blockersMerged,
  scanTickets,
  startable,
  byId,
  type Ticket,
} from "./tickets.js";
import { syncWorktreeEnv } from "./worktree.js";

/** One Ticket: READY → MERGED or FAILED. Drain only calls this (or an injected `work`). */
export async function executeTicket(
  target: string,
  ticket: Ticket,
  config: Config,
  journal: Journal,
): Promise<void> {
  const wt = await beginTicket(target, ticket, journal);
  try {
    await syncWorktreeEnv(wt);
    journal.log(`${ticket.id} session ${ticketSessionFile(journal.dir, ticket.id, "implement")}`);
    const pi = await runPi({
      cwd: wt,
      runDir: journal.dir,
      ticketId: ticket.id,
      role: "implement",
      model: config.model,
      thinkingLevel: config.thinkingLevel,
      prompt: implementPrompt(ticket.relPath),
    });
    const first = await settleAfterAgent(target, ticket, wt, journal, pi.lastError);
    if (first === "merged" || first === "failed") return;
    if (first === "resolve") {
      await withMergeLock(target, async () => {
        await stamp(target, ticket, "RESOLVING", journal);
      });
      await syncWorktreeEnv(wt);
      journal.log(`${ticket.id} session ${ticketSessionFile(journal.dir, ticket.id, "conflict")}`);
      await runPi({
        cwd: wt,
        runDir: journal.dir,
        ticketId: ticket.id,
        role: "conflict",
        model: config.model,
        thinkingLevel: config.thinkingLevel,
        prompt: conflictPrompt(ticket.relPath),
      });
      await settleAfterConflict(target, ticket, wt, journal);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await fail(target, ticket, msg, journal);
    } catch (e) {
      journal.log(`${ticket.id} FAILED and could not write Status: ${e instanceof Error ? e.message : e}`);
    }
  }
}

export async function prepareTarget(target: string): Promise<void> {
  await assertCleanMain(target);
  await ensureWorktreesIgnored(target);
  await ensureRunsIgnored(target);
  await ensureVenvIgnored(target);
}

async function promoteReadyAndSelect(
  target: string,
  journal: Journal,
  pendingIds: { has(id: string): boolean },
  slots: number,
): Promise<Ticket[]> {
  return withMergeLock(target, async () => {
    const current = scanTickets(target);
    const curMap = byId(current);
    for (const t of current) {
      if (t.status === "BLOCKED" && blockersMerged(t, curMap) && !pendingIds.has(t.id)) {
        await stamp(target, t, "READY", journal);
      }
    }
    const tickets = scanTickets(target);
    journal.snapshot(tickets);
    const fresh = byId(tickets);
    return [...fresh.values()]
      .filter((t) => startable(t, fresh) && !pendingIds.has(t.id))
      .slice(0, Math.max(0, slots));
  });
}

export async function run(
  target: string,
  config: Config,
  journal: Journal,
  work: (
    target: string,
    ticket: Ticket,
    config: Config,
    journal: Journal,
  ) => Promise<void> = executeTicket,
): Promise<void> {
  await prepareTarget(target);
  journal.log(
    `proxy NODE_USE_ENV_PROXY=${process.env.NODE_USE_ENV_PROXY ?? ""} HTTPS_PROXY=${process.env.HTTPS_PROXY ?? process.env.https_proxy ?? ""}`,
  );
  journal.snapshot(scanTickets(target));

  await recoverLeftovers(target, journal);

  const pending = new Map<string, Promise<void>>();

  while (true) {
    const batch = await promoteReadyAndSelect(
      target,
      journal,
      pending,
      config.concurrency - pending.size,
    );

    if (batch.length === 0 && pending.size === 0) {
      const left = scanTickets(target).filter(
        (t) => t.status === "BLOCKED" || t.status === "FAILED" || t.status === "READY",
      );
      if (left.length) {
        journal.log(`done; remaining: ${left.map((t) => `${t.id}:${t.status}`).join(", ")}`);
      } else {
        journal.log("done");
      }
      return;
    }

    for (const t of batch) {
      journal.log(`start ${t.id}`);
      const p = work(target, t, config, journal).finally(() => {
        pending.delete(t.id);
      });
      pending.set(t.id, p);
    }

    if (pending.size > 0) {
      await Promise.race([...pending.values()]);
    }
  }
}
