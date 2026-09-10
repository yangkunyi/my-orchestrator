/**
 * The Script-node vocabulary the workflows compare. A handler returns one token and node-entry.ts
 * writes it verbatim, so the token is the whole byte contract: the token, no other whitespace, and
 * exactly one trailing newline (nodeLine). The runner strips that one newline before a `when:` or
 * `until_bash` reads the output, which is why the YAMLs compare the bare token.
 */

/** Needs the Conflict Agent. begin and settle emit it; ticket-dag-execute.yaml matches it. */
export const RESOLVE = "resolve";

/** beginTicket's outcome: implement may start, the Ticket failed, or it needs the Conflict Agent. */
export type BeginOutcome = "ready" | "failed" | typeof RESOLVE;

/** Settling a Ticket branch onto Main: the merge landed, failed, or it needs the Conflict Agent. */
export type SettleResult = "merged" | "failed" | typeof RESOLVE;

/** What pick prints with nothing startable; ticket-dag-drain.yaml ends its drain loop on this. */
export const EMPTY_PICK = "[]";

/** The token convention: a handler returns the token plus one newline, and node-entry writes it. */
export function nodeLine(token: string): string {
  return `${token}\n`;
}
