/**
 * The path the settle route used to live at. transitions.ts owns the Ticket's transitions now;
 * implement.ts and conflict.ts still import this path and are moved by another card this round. Delete
 * this shim when they import transitions.ts.
 */
export { settleAfterAgent, settleAfterConflict } from "./transitions.ts";
