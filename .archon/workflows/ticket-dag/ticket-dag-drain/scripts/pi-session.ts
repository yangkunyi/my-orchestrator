import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  AGENT_WALL_MS,
  armSessionAbort,
  packAnswer,
  RunnerUnavailable,
  type AgentRole,
  type PackAgentOpts,
  type PackAgentResult,
} from "./agent.ts";
import { readPiSession, roleSessionFile } from "./session-log.ts";
import { composeMessage } from "./prompt.ts";
import { sessionSpawnEnv } from "./worktree-env.ts";

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

/** The spawn context Pi's bash tool hands a hook, written out so this module needs no SDK type. */
type SpawnContext = { command: string; cwd: string; env: NodeJS.ProcessEnv };

/**
 * The spawn hook Pi's bash tool is created with: the seam's environment (a Worktree's `.venv` first on
 * PATH) applied to the context the SDK hands it. Exported, like piTools and piTurn, because the SDK
 * captures a spawnHook inside the tool definition where no repro can reach it - this returned value is
 * what actually reaches bash, so a repro can drive it with no session and no credentials.
 */
export function piSpawnHook(env: PackAgentOpts["env"]): (ctx: SpawnContext) => SpawnContext {
  return (ctx) => sessionSpawnEnv(env, ctx);
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
  const pi = await startPiSession(opts).catch((e: unknown) => {
    // Everything before the first turn is "cannot start": the SDK, the session file, the model, the
    // tools. The caller has to hear it as such, or it blames the Ticket for a runner nobody configured.
    throw new RunnerUnavailable(
      `the pi runner could not start: ${e instanceof Error ? e.message : String(e)}`,
    );
  });
  try {
    try {
      await pi.session.prompt(composeMessage(opts.persona, opts.prompt));
    } catch (e) {
      const file = pi.sessionManager.getSessionFile() ?? pi.sessionFile;
      const msg = e instanceof Error ? e.message : String(e);
      return piTurn(file, pi.aborted() ? "agent aborted after wall clock" : msg);
    }
    return piTurn(
      pi.sessionManager.getSessionFile() ?? pi.sessionFile,
      pi.aborted() ? "agent aborted after wall clock" : undefined,
    );
  } finally {
    pi.cancel();
    pi.session.dispose();
  }
}

/**
 * Everything the Pi runner needs before a turn runs: the SDK, the session file, the model, the mounted
 * tools, the wall clock. One function because a throw anywhere in here means the same thing to a
 * Ticket - the runner could not start (RunnerUnavailable, agent.ts) - and nothing here is a turn.
 */
async function startPiSession(opts: PackAgentOpts) {
  const {
    createAgentSession,
    createBashToolDefinition,
    DefaultResourceLoader,
    defineTool,
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
    // defineTool is the SDK's own wrapper for this array: customTools is typed ToolDefinition[], so
    // contextual typing widens the bash tool's params to unknown, which a concrete definition is not
    // assignable to (strictFunctionTypes, on its render callback). Without the wrapper the pack does
    // not typecheck - see tsconfig.pack.json.
    customTools: [
      defineTool(
        createBashToolDefinition(opts.cwd, {
          spawnHook: piSpawnHook(opts.env),
        }),
      ),
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
  return { session, sessionManager, sessionFile, cancel, aborted: () => aborted };
}
