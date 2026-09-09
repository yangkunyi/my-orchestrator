import { readFileSync, writeFileSync } from "node:fs";
import type { Journal } from "./journal.js";
import {
  commitFiles,
  isAncestor,
  removeWorktreeAndBranch,
  withMergeLock,
} from "./git.js";
import {
  leftoverInFlight,
  scanTickets,
  type Status,
  type Ticket,
} from "./tickets.js";

function setStatusInFile(absPath: string, status: Status): void {
  const body = readFileSync(absPath, "utf8");
  const next = /^(?:\*\*)?Status\s*:(?:\*\*)?\s*.+$/im.test(body)
    ? body.replace(/^(?:\*\*)?Status\s*:(?:\*\*)?\s*.+$/im, `Status: ${status}`)
    : `${body.trimEnd()}\n\nStatus: ${status}\n`;
  writeFileSync(absPath, next);
}

export async function stamp(
  target: string,
  ticket: Ticket,
  status: Status,
  journal: Journal,
): Promise<void> {
  setStatusInFile(ticket.absPath, status);
  await commitFiles(target, [ticket.relPath], `orchestrator: ${ticket.id} Status ${status}`);
  ticket.status = status;
  journal.log(`${ticket.id} Status ${status}`);
  journal.snapshot(scanTickets(target));
}

export async function recoverLeftovers(target: string, journal: Journal): Promise<void> {
  await withMergeLock(target, async () => {
    for (const ticket of leftoverInFlight(scanTickets(target))) {
      const oldStatus = ticket.status;
      if (await isAncestor(target, ticket.branch, "HEAD")) {
        journal.log(`${ticket.id} leftover in-flight (${oldStatus}) → MERGED`);
        await stamp(target, ticket, "MERGED", journal);
        await removeWorktreeAndBranch(target, ticket);
      } else {
        journal.log(`${ticket.id} leftover in-flight (${oldStatus}) → FAILED`);
        await stamp(target, ticket, "FAILED", journal);
      }
    }
  });
}
