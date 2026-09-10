import { AGENT_WALL_MS, type AgentRole, type PackAgentOpts } from "./agent.ts";
import type { PackConfig, Runner } from "./config.ts";
import { personaFor, readTddSkill } from "./prompt.ts";
import { roleSessionFile } from "./session-log.ts";

/** The drain-end readers share one clock: review and summary read the same range and report on it. */
export const REVIEW_WALL_MS = 30 * 60 * 1000;

/** Bash is in there so a reader can fetch git history; the contract, not the allowlist, is read-only. */
export const REVIEW_TOOLS = ["read", "grep", "find", "ls", "bash"];

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
 * Everything that must agree about one role: the session key it writes under, the persona it runs
 * under, the tool allowlist, whether bash is needed, and how long it may run. A node states its role
 * and its own arguments; nothing else about the role is spelled at the call site.
 */
type RoleSpec<A> = {
  sessionKey: (args: A) => string;
  persona: (runner: Runner | undefined, args: A) => string;
  /** undefined leaves the runner's own default: every tool, bash included. */
  tools: string[] | undefined;
  /** undefined leaves the runner's own default: bash is in. */
  useBash: boolean | undefined;
  wallMs: number;
};

export const ROLES: { [K in AgentRole]: RoleSpec<RoleShape[K]> } = {
  implement: {
    sessionKey: (args) => args.ticketId,
    // The one ambient fact an implement node rests on lives here: the table reads the tdd tree its
    // machine carries - once, where the role's persona is composed - and hands it to the builder.
    persona: (runner) => personaFor("implement", runner, { skill: readTddSkill() }),
    tools: undefined,
    useBash: undefined,
    wallMs: AGENT_WALL_MS,
  },
  conflict: {
    sessionKey: (args) => args.ticketId,
    persona: (runner) => personaFor("conflict", runner),
    tools: undefined,
    useBash: undefined,
    wallMs: AGENT_WALL_MS,
  },
  review: {
    sessionKey: (args) => `drain-review-${args.axisIndex + 1}`,
    persona: (runner, args) => personaFor("review", runner, args),
    tools: REVIEW_TOOLS,
    useBash: true,
    wallMs: REVIEW_WALL_MS,
  },
  summary: {
    sessionKey: () => "drain-summary",
    persona: (runner, args) => personaFor("summary", runner, args),
    tools: REVIEW_TOOLS,
    useBash: true,
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

export type RoleAgent = {
  opts: PackAgentOpts;
  /** Where the runner keeps this role's session: artifacts/sessions/<session key>/<role>.jsonl. */
  sessionFile: string;
};

/** The agent opts for a node's role, with the config the runner needs folded in. */
export function roleAgent<R extends AgentRole>(call: RoleCall<R>): RoleAgent {
  const spec = ROLES[call.role];
  const sessionKey = spec.sessionKey(call.args);
  return {
    sessionFile: roleSessionFile(call.artifactsDir, sessionKey, call.role),
    opts: {
      cwd: call.cwd,
      artifactsDir: call.artifactsDir,
      sessionKey,
      role: call.role,
      model: call.config.model,
      thinkingLevel: call.config.thinkingLevel,
      runner: call.config.runner,
      persona: spec.persona(call.config.runner, call.args),
      prompt: call.prompt,
      tools: spec.tools,
      useBash: spec.useBash,
      wallMs: spec.wallMs,
    },
  };
}
