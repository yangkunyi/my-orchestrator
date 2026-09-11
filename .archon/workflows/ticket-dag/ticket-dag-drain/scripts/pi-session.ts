import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  AGENT_WALL_MS,
  armSessionAbort,
  packAnswer,
  RunnerUnavailable,
  type AgentRole,
  type PackAgentOpts,
  type PackAgentResult,
} from "./agent.ts";
import { composeMessage } from "./prompt.ts";
import { sessionSpawnEnv } from "./worktree-env.ts";

/**
 * Pi's session file: where this pack tells Pi to keep one role's session, and how Pi's own jsonl
 * reads back. The reader below knows Pi's row shape and lives with the runner that writes it - dsh
 * keeps its log where its harness does and reports that path instead. The session file is
 * diagnostics; the answer travels on PackAgentResult.answer.
 */

/** Where one role's session for one session key lives: artifacts/sessions/<key>/<role>.jsonl. */
export function roleSessionFile(artifactsDir: string, sessionKey: string, role: AgentRole): string {
  return join(artifactsDir, "sessions", sessionKey, `${role}.jsonl`);
}

/**
 * A part counts only when its own type is "text": a text key alone is not evidence. dsh's reasoning
 * parts do carry one (that is how thinking once leaked into a report), and this reader must apply the
 * same rule as dsh's answerText even though Pi's own parts happen to obey it - measured over 344 real
 * Pi session files, every part carrying a text key had type "text".
 */
function contentText(content: unknown): string | undefined {
  if (typeof content === "string" && content.trim()) return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") parts.push(part);
    else if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
      const text = (part as { text: unknown }).text;
      if (typeof text === "string" && text) parts.push(text);
    }
  }
  const joined = parts.join("").trim();
  return joined.length > 0 ? joined : undefined;
}

type Row = {
  type?: unknown;
  message?: { role?: unknown; content?: unknown; errorMessage?: unknown };
};

/**
 * One pass over Pi's session jsonl: the last assistant text Pi wrote and the last errorMessage. Both
 * are values, not throws: a missing or half-written file reads as absence.
 */
export function readPiSession(sessionFile: string): { text: string | undefined; error: string | undefined } {
  if (!existsSync(sessionFile)) return { text: undefined, error: undefined };
  let text: string | undefined;
  let error: string | undefined;
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    if (!line) continue;
    let row: Row | null;
    try {
      row = JSON.parse(line) as Row | null;
    } catch {
      continue; /* skip bad line */
    }
    // ponytail: optional chaining, not a try/catch - a JSON line that is not an object must skip,
    // the way the old per-reader try/catch did.
    const type = row?.type;
    const msg = row?.message;
    if (typeof msg?.errorMessage === "string" && msg.errorMessage.length > 0) error = msg.errorMessage;
    if (type && type !== "message") continue;
    if (msg?.role !== "assistant") continue;
    const found = contentText(msg.content);
    if (found) text = found;
  }
  return { text, error };
}

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
