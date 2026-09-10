import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { STATUSES } from "./ticket-line.ts";
import type { Runner } from "./config.ts";

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

export function implementTask(ticketRelPath: string): string {
  return `${ticketRelPath}\nThis ticket is not done. Implement the acceptance criteria in this worktree and commit the product-code changes on the current branch before exiting. Leave the ticket Status line unchanged.\n`;
}

export function conflictTask(ticketRelPath: string): string {
  return `${ticketRelPath}\n`;
}

// ponytail: the tdd skill body, inline. This is the fallback for a machine with no pi skill tree;
// where one exists, tddPersona() reads the skill itself and this copy is never used. Only the loader
// metadata was dropped (pi scans it to decide when to offer the skill; dsh has no scanner), and the
// pointer into the codebase-design tree is dropped on purpose: designing module interfaces belongs to
// ticket writing, not to a node that executes a ticket, and it is dead prose for a runner with no
// skill loader. Not inlined: ~/.pi/agent/skills/tdd/{tests,mocking}.md, tdd/agents/openai.yaml
// (pi subagents). Re-copy by hand if the skill changes.
const TDD_SKILL = `The tdd skill, in full:

# Test-Driven Development

TDD is the red → green loop. This is the reference that makes that loop produce tests worth keeping: what a good test is, where tests go, the anti-patterns, and the rules of the loop. Every section applies on every cycle — consult them before and during the loop, not after.

When exploring the codebase, read \`CONTEXT.md\` (if it exists) so test names and interface vocabulary match the project's domain language, and respect ADRs in the area you're touching.

## What a good test is

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't. A good test reads like a specification — "user can checkout with valid cart" tells you exactly what capability exists — and survives refactors because it doesn't care about internal structure.

Examples and mocking guidelines live with the pi skills, if this machine has them: read \`~/.pi/agent/skills/tdd/tests.md\` or \`~/.pi/agent/skills/tdd/mocking.md\` with bash when the test needs either.

## Seams — where tests go

A **seam** is the public boundary you test at: the interface where you observe behavior without reaching inside. Tests live at seams, never against internals.

**Test only at pre-agreed seams.** Before writing any test, write down the seams under test and confirm them. No test is written at an unconfirmed seam. You can't test everything — agreeing the seams up front is how testing effort lands on the critical paths and complex logic instead of every edge case.

Ask: "What's the public interface, and which seams should we test?"

## Anti-patterns

- **Implementation-coupled** — mocks internal collaborators, tests private methods, or verifies through a side channel (querying the database instead of using the interface). The tell: the test breaks when you refactor but behavior hasn't changed.
- **Tautological** — the assertion recomputes the expected value the way the code does (\`expect(add(a, b)).toBe(a + b)\`, a snapshot derived by hand the same way, a constant asserted equal to itself), so it passes by construction and can never disagree with the code. Expected values must come from an independent source of truth — a known-good literal, a worked example, the spec.
- **Horizontal slicing** — writing all tests first, then all implementation. Bulk tests verify _imagined_ behavior: you test the _shape_ of things rather than user-facing behavior, the tests go insensitive to real changes, and you commit to test structure before understanding the implementation. Work in **vertical slices** instead — one test → one implementation → repeat, each test a **tracer bullet** that responds to what the last cycle taught you.

## Rules of the loop

- **Red before green.** Write the failing test first, then only enough code to pass it. Don't anticipate future tests or add speculative features.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Refactoring is not part of the loop.** It belongs to the review stage, not the red → green implementation cycle.`;

/** Where the tdd skill lives: the same tree pi's own loader reads. */
const TDD_DIR = join(homedir(), ".pi", "agent", "skills", "tdd");

/**
 * The dsh implement persona carries the tdd skill's own body, read at run time from the tree pi's
 * loader uses, so the two runners cannot disagree about the skill and nothing is re-copied by hand.
 * Pi needs none of this: its session prompt advertises the skill catalog and its read tool opens the
 * file. The inlined TDD_SKILL is the fallback for a machine with no pi skill tree.
 */
function tddPersona(): string {
  try {
    const body = readFileSync(join(TDD_DIR, "SKILL.md"), "utf8")
      .replace(/^---\n[\s\S]*?\n---\n/, "")
      .split("\n\n")
      .filter((para) => !para.includes("codebase-design"))
      .join("\n\n")
      .trim();
    if (!body) return TDD_SKILL;
    return `The tdd skill, in full, from ${TDD_DIR}. Its siblings tests.md and mocking.md live in that directory: read either with bash when the test needs it.\n\n${body}`;
  } catch {
    return TDD_SKILL;
  }
}

/** The skill body a persona-taking runner puts in its system prompt. */
export function personaFor(role: "implement" | "conflict", runner: Runner | undefined): string {
  if (role === "conflict") return CONFLICT_SKILL;
  return runner === "dsh" ? `${IMPLEMENT_SKILL}\n\n${tddPersona()}` : IMPLEMENT_SKILL;
}

/** The three axes the drain-end review fans out on: one reviewer each, one report. */
export const REVIEW_AXES = [
  "Bugs and incorrect assumptions in the diff",
  "Missing tests for changed behavior",
  "Cross-file breakage (callers, contracts, tickets interacting)",
] as const;

const BASE_READ_COMMANDS =
  "`git log`, `git diff`, `git show`, `cat`, `rg` and your file tools";

/**
 * The review contract, one text for every runner. Reviewers are handed the range and the tools, not
 * a pasted diff: they fetch what they need themselves. Pi's review session is read-only by
 * instruction too - it gets bash so it can read git history, which is worth more than the allowlist
 * that used to make writing impossible.
 */
export function reviewPersona(base: string, axis: string): string {
  return `You are a read-only reviewer of git range ${base}...HEAD on this repository.

Inspect that range yourself, read-only: ${BASE_READ_COMMANDS} are yours. Never write: no edits, no commits, no output redirection into files, no mutating git commands. Do not spawn agents or invoke /code-review or /tdd.

Report only issues in added or modified lines, plus the impact of those changes on other files.

Your axis: ${axis}. Other reviewers cover the other axes - do not report them.

Do not check ticket acceptance criteria. Do not produce a Standards-vs-Spec pair.

If nothing material on your axis, say so briefly. Markdown. Under 800 words.`;
}

/** The handover: which range, and the commit menu to orient with. The diff itself is not pasted. */
export function reviewTask(base: string, head: string, log: string): string {
  return `Review the range ${base}...HEAD (HEAD = ${head}) in this repository.\n\nCommits in that range:\n${log || "(none)"}\n`;
}

/**
 * The drain-end summary: one agent merges the three reviews for the human. It ranks and dedupes, it
 * does not review - a fourth opinion on the same diff is not what the axis split bought.
 */
export function summaryPersona(base: string): string {
  return `You are summarizing three independent read-only reviews of git range ${base}...HEAD on this repository, for the human who owns this drain.

You may read the range yourself, read-only: ${BASE_READ_COMMANDS} are yours. Never write: no edits, no commits, no output redirection into files, no mutating git commands. Do not spawn agents or invoke /code-review or /tdd.

Merge the three reviews into one report:
1. Open with what the range does, in two sentences.
2. Then the findings that survive: drop duplicates, rank by severity, and keep each to a line or two with file and line.
3. Then the disagreements, where the reviewers contradict each other - say so and give your call.
4. Name anything you dropped or demoted, and why. Nothing disappears silently.
5. Where a section is an error rather than a review, say so in one line.

Do not add findings of your own that no reviewer raised - you rank and merge, you do not review.
Markdown. Under 600 words.`;
}

/** The summary's input: the range, the commit menu, and the reviews to merge. */
export function summaryTask(base: string, head: string, log: string, reviewMd: string): string {
  return `Git range ${base}...HEAD (HEAD = ${head}).\n\nCommits in that range:\n${log || "(none)"}\n\nThe three reviews (review.md):\n${reviewMd}`;
}

/** How a runner that carries everything in one message sees a persona plus its task. */
export function composeMessage(persona: string, task: string): string {
  return `${persona}\n\n${task}`;
}
