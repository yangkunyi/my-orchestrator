/**
 * A path kept for the importers outside this round's footprint: tickets.ts now owns the Status
 * vocabulary, its format and the classification (one owner for the Ticket's record). prompt.ts reads
 * STATUSES from here and tests/target.ts reads parseStatus/Status; whenever they are repointed, this
 * file goes.
 */
export {
  STATUSES,
  type Status,
  parseStatus,
  statusLine,
  statusMessage,
  mergeMessage,
} from "./tickets.ts";
