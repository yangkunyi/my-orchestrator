/**
 * The path beginTicket used to live at. transitions.ts owns the Ticket's transitions now; implement.ts
 * and node-outcomes-repro.ts still import this path and are outside this round's footprint. Delete this
 * shim when they import transitions.ts.
 */
export { beginTicket, type BeginResult } from "./transitions.ts";
