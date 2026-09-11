import { AGENT_WALL_MS, type AgentRole, type PackAgentOpts } from "./agent.ts";
import type { PackConfig, Runner } from "./config.ts";
import { personaFor, readTddSkill } from "./prompt.ts";
import { sessionEnv } from "./worktree-env.ts";

/** The drain-end readers share one clock: review and summary read the same range and report on it. */
export const REVIEW_WALL_MS = 30 * 60 * 1000;

/**
 * What a role needs beyond the runner. The ticket nodes key their session on a Ticket; the drain-end
 * readers key theirs on the range they read, so no caller has to hand a review axis a Ticket id.
 */
export type RoleShape = {
  implement: { ticketId: string };
  conflict: { ticketId: string };
  review: { axisIndex: number; base: string; axis: string };
  summary: { base: string };
};

/**
 * Everything that must agree about one role and is the same for both runners: the session key it
 * writes under, the persona it runs under, and how long it may run. A node states its role and its
 * own arguments; nothing else about the role is spelled at the call site.
 *
 * What a role may do to the working tree is part of its persona contract, and a runner enforces it as
 * far as it can: Pi mounts the drain-end readers' read-only tool allowlist (pi-session.ts), dsh has
 * one bash tool and no sandbox and can only state the contract (dsh-agent.ts). The seam carries no
 * option for that, because a caller cannot pass one that only one runner honours.
 *
 * A role does not know where its session lives either: each runner keeps it where its harness does
 * and reports the path on PackAgentResult.sessionFile.
 */
type RoleSpec<A> = {
  sessionKey: (args: A) => string;
  persona: (runner: Runner | undefined, args: A) => string;
  wallMs: number;
};

export const ROLES: { [K in AgentRole]: RoleSpec<RoleShape[K]> } = {
  implement: {
    sessionKey: (args) => args.ticketId,
    // The one ambient fact an implement node rests on lives here: the table reads the tdd tree its
    // machine carries - once, where the role's persona is composed - and hands it to the builder.
    persona: (runner) => personaFor("implement", runner, { skill: readTddSkill() }),
    wallMs: AGENT_WALL_MS,
  },
  conflict: {
    sessionKey: (args) => args.ticketId,
    persona: (runner) => personaFor("conflict", runner),
    wallMs: AGENT_WALL_MS,
  },
  review: {
    sessionKey: (args) => `drain-review-${args.axisIndex + 1}`,
    persona: (runner, args) => personaFor("review", runner, args),
    wallMs: REVIEW_WALL_MS,
  },
  summary: {
    sessionKey: () => "drain-summary",
    persona: (runner, args) => personaFor("summary", runner, args),
    wallMs: REVIEW_WALL_MS,
  },
};

/** One node's call: which role, the role's own arguments, where it runs, and what it is asked to do. */
export type RoleCall<R extends AgentRole> = {
  role: R;
  args: RoleShape[R];
  cwd: string;
  artifactsDir: string;
  config: PackConfig;
  prompt: string;
};

/** The agent opts for a node's role, with the config the runner needs folded in. */
export function roleAgent<R extends AgentRole>(call: RoleCall<R>): PackAgentOpts {
  const spec = ROLES[call.role];
  const sessionKey = spec.sessionKey(call.args);
  return {
    cwd: call.cwd,
    artifactsDir: call.artifactsDir,
    sessionKey,
    // The Worktree rule travels with the cwd it belongs to, not with an adapter's memory of it.
    env: (base) => sessionEnv(call.cwd, base),
    role: call.role,
    model: call.config.model,
    thinkingLevel: call.config.thinkingLevel,
    runner: call.config.runner,
    persona: spec.persona(call.config.runner, call.args),
    prompt: call.prompt,
    wallMs: spec.wallMs,
  };
}
