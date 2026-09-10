import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  AGENT_WALL_MS,
  armSessionAbort,
  packAnswer,
  type AgentRole,
  type PackAgentOpts,
  type PackAgentResult,
} from "./agent.ts";
import { readPiSession, roleSessionFile } from "./session-log.ts";
import { composeMessage } from "./prompt.ts";
import { prependVenvBin } from "./worktree-env.ts";

/**
 * Pi enforces a role's read-only contract structurally - these are the only tools mounted - and the
 * same contract is instruction-only for dsh (one bash tool, no sandbox; see dsh-agent.ts). The pack
 * never asks a node to run without bash, so Pi always mounts it.
 */
export const PI_READ_ONLY_TOOLS = ["read", "grep", "find", "ls", "bash"];

/** The tools Pi mounts for a role: the read-only allowlist for the drain-end readers, else its default. */
export function piTools(role: AgentRole): string[] | undefined {
  return role === "review" || role === "summary" ? PI_READ_ONLY_TOOLS : undefined;
}

/**
 * Pi's report for one finished turn: the answer is Pi's own session jsonl's last assistant text, and
 * `lastError` is what the harness said when the turn did not finish cleanly. This is the whole of
 * Pi's answer extraction, so it is the one part of this adapter a repro can drive without a session.
 */
export function piTurn(sessionFile: string, lastError: string | undefined): PackAgentResult {
  const turn = readPiSession(sessionFile);
  return { sessionFile, answer: packAnswer(turn.text), lastError: turn.error ?? lastError };
}

export async function runPackPi(opts: PackAgentOpts): Promise<PackAgentResult> {
  const {
    createAgentSession,
    createBashToolDefinition,
    DefaultResourceLoader,
    getAgentDir,
    ModelRuntime,
    resolveCliModel,
    SessionManager,
  } = await import("@earendil-works/pi-coding-agent");

  const sessionFile = roleSessionFile(opts.artifactsDir, opts.sessionKey, opts.role);
  mkdirSync(dirname(sessionFile), { recursive: true });
  if (!existsSync(sessionFile)) writeFileSync(sessionFile, "");
  const sessionManager = SessionManager.open(sessionFile, dirname(sessionFile), opts.cwd);
  sessionManager.appendSessionInfo(`${opts.sessionKey} ${opts.role}`);

  const modelRuntime = await ModelRuntime.create();
  let model = undefined;
  if (opts.model) {
    const resolved = resolveCliModel({
      cliModel: opts.model,
      cliThinking: opts.thinkingLevel,
      modelRuntime,
    });
    if (resolved.error || !resolved.model) {
      throw new Error(resolved.error ?? `unknown model ${opts.model}`);
    }
    model = resolved.model;
  }

  const resourceLoader = new DefaultResourceLoader({
    cwd: opts.cwd,
    agentDir: getAgentDir(),
  });
  await resourceLoader.reload();

  const tools = piTools(opts.role);
  const { session } = await createAgentSession({
    cwd: opts.cwd,
    model,
    thinkingLevel: opts.thinkingLevel,
    modelRuntime,
    sessionManager,
    resourceLoader,
    ...(tools ? { tools } : {}),
    customTools: [
      createBashToolDefinition(opts.cwd, {
        spawnHook: (ctx) => ({
          ...ctx,
          env: { ...ctx.env, PATH: prependVenvBin(ctx.env.PATH, opts.cwd) },
        }),
      }),
    ],
  });

  let aborted = false;
  const cancel = armSessionAbort(
    {
      abort: async () => {
        aborted = true;
        await session.abort();
      },
    },
    opts.wallMs ?? AGENT_WALL_MS,
  );
  try {
    try {
      await session.prompt(composeMessage(opts.persona, opts.prompt));
    } catch (e) {
      const file = sessionManager.getSessionFile() ?? sessionFile;
      const msg = e instanceof Error ? e.message : String(e);
      return piTurn(file, aborted ? "agent aborted after wall clock" : msg);
    }
    return piTurn(
      sessionManager.getSessionFile() ?? sessionFile,
      aborted ? "agent aborted after wall clock" : undefined,
    );
  } finally {
    cancel();
    session.dispose();
  }
}
