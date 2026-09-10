import { STATUSES } from "./ticket-line.ts";

/** The Status vocabulary as the prompts spell it. */
const STATUS_VALUES = STATUSES.map((s) => `\`${s}\``).join(" / ");

const IMPLEMENT_SKILL = `Implement the work described by the user in the spec or tickets.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Commit your work to the current branch.

Leave the ticket file's \`Status:\` line unchanged (${STATUS_VALUES}). Those values are owned by \`/to-tickets\` and the Orchestrator, not by implement.`;

const CONFLICT_SKILL = `1. **See the current state** of the merge/rebase. Check git history, and the conflicting files.

2. **Find the primary sources** for each conflict. Understand deeply why each change was made, and what the original intent was. Read the commit messages, check the PRs, check original issues/tickets.

3. **Resolve each hunk.** Preserve both intents where possible. Where incompatible, pick the one matching the merge's stated goal and note the trade-off. Do **not** invent new behaviour. Always resolve; never \`--abort\`.

4. Discover the project's **automated checks** and run them — typically typecheck, then tests, then format. Fix anything the merge broke.

5. **Finish the merge/rebase.** Stage everything and commit. If rebasing, continue the rebase process until all commits are rebased.

Leave the ticket file's \`Status:\` line unchanged (${STATUS_VALUES}). Those values are owned by \`/to-tickets\` and the Orchestrator, not by conflict resolution.`;

export function implementPrompt(ticketRelPath: string): string {
  return `${IMPLEMENT_SKILL}\n\n${ticketRelPath}\nThis ticket is not done. Implement the acceptance criteria in this worktree and commit the product-code changes on the current branch before exiting. Leave the ticket Status line unchanged.\n`;
}

export function conflictPrompt(ticketRelPath: string): string {
  return `${CONFLICT_SKILL}\n\n${ticketRelPath}\n`;
}
