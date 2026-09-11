import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
 * PATH) applied to the context the SDK hands it. Exported, like piTools and piTurn, because the value
 * is what bash's child really gets, so a repro can drive it with no session and no credentials;
 * piBashTool is the factory that mounts it.
 */
export function piSpawnHook(env: PackAgentOpts["env"]): (ctx: SpawnContext) => SpawnContext {
  return (ctx) => sessionSpawnEnv(env, ctx);
}

/**
 * The one bash tool this pack mounts: Pi's own bash definition with this node's spawn hook attached.
 * Exported because the tool definition is the last link of that chain and the only one nothing can read
 * back: the SDK keeps the hook inside the definition it builds, so a repro builds the same definition
 * through this factory, runs one bounded command through it, and asserts the environment the child
 * really saw (tests/pi-sdk-repro.ts).
 *
 * defineTool is the SDK's own wrapper for this array entry: customTools is typed ToolDefinition[], so
 * contextual typing widens the bash tool's params to unknown, which a concrete definition is not
 * assignable to (strictFunctionTypes, on its render callback). Without the wrapper the pack does not
 * typecheck - see tsconfig.pack.json. The return type is left to the SDK for the same reason: the
 * wrapper is what carries the concrete bash definition's parameter type.
 */
export function piBashTool(sdk: PiSdkModule, opts: Pick<PackAgentOpts, "cwd" | "env">) {
  return sdk.defineTool(sdk.createBashToolDefinition(opts.cwd, { spawnHook: piSpawnHook(opts.env) }));
}

/**
 * The Pi SDK package this adapter loads. A dev checkout reaches it by its bare name; an archon run
 * executes this pack from a workspace copy with no node_modules at all, so the adapter resolves it
 * deliberately (piSdkCandidates) instead of assuming the machine has one to offer.
 */
const PI_SDK_PACKAGE = "@earendil-works/pi-coding-agent";

/**
 * What the ladder loads, and the shape each path-based candidate is read as. This reference is
 * type-only (erased before the pack ever runs): the runtime specifiers are the candidates below.
 */
type PiSdkModule = typeof import("@earendil-works/pi-coding-agent");

/**
 * Bun's globals, read off globalThis: the pack runs under bun and tsc checks it without bun's types
 * (pack-globals.d.ts declares only import.meta). Under any other runtime the ladder just finds less.
 */
const bunGlobals = globalThis as {
  Bun?: {
    which?: (command: string) => string | null;
    resolveSync?: (specifier: string, from: string) => string;
  };
};

/**
 * How the ladder reads this machine. Injectable because the machine a repro happens to run on is not
 * the point of the ladder: "no pi on PATH" and "an executable with no global install" are cases a test
 * has to be able to name.
 */
type PiSdkLookup = {
  env: NodeJS.ProcessEnv;
  execPath: string;
  whichPi: () => string | null;
};

function lookupFrom(overrides: Partial<PiSdkLookup> = {}): PiSdkLookup {
  return {
    env: overrides.env ?? process.env,
    execPath: overrides.execPath ?? process.execPath,
    whichPi: overrides.whichPi ?? (() => bunGlobals.Bun?.which?.("pi") ?? null),
  };
}

/**
 * The file to import for one Pi SDK location: a package directory (the usual case) or an entry file
 * itself. Bun resolves it through the package's own manifest, so this never spells an entry path the
 * package could move; a location with no manifest is handed to the import to report.
 */
function piSdkEntry(path: string): string {
  const abs = resolve(path);
  try {
    return bunGlobals.Bun?.resolveSync?.(abs, dirname(abs)) ?? abs;
  } catch {
    return abs;
  }
}

/** The SDK package directory inside one `node_modules`, when it is really installed there. */
function installedPiSdk(nodeModules: string): string[] {
  const dir = join(nodeModules, PI_SDK_PACKAGE);
  return existsSync(join(dir, "package.json")) ? [dir] : [];
}

/** Every `node_modules` above a path, nearest first: the order a bare specifier would search them. */
function nodeModulesAbove(path: string): string[] {
  const found: string[] = [];
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    const nodeModules = join(dir, "node_modules");
    if (existsSync(nodeModules)) found.push(nodeModules);
    if (dirname(dir) === dir) break;
  }
  return found;
}

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path; /* gone between the PATH lookup and this call */
  }
}

/**
 * The Pi SDK package directories this machine derives, most likely first: the install tree the `pi` CLI
 * itself lives in (following the symlink a CLI is usually installed as, then walking up the node_modules
 * chain a bare specifier would), then this process's own install root - the `../lib/node_modules` a
 * global node install uses.
 */
function derivedPiSdkDirs(lookup: PiSdkLookup): string[] {
  const dirs: string[] = [];
  const cli = lookup.whichPi();
  if (cli) {
    for (const nodeModules of nodeModulesAbove(realpathOrSelf(cli))) dirs.push(...installedPiSdk(nodeModules));
  }
  dirs.push(...installedPiSdk(join(dirname(lookup.execPath), "..", "lib", "node_modules")));
  return [...new Set(dirs)];
}

/**
 * Every specifier the ladder imports, in order. `PI_SDK_PATH` is the operator's word: when it is set it
 * is the whole ladder, because a path that does not load is the problem to report, not a hint to
 * ignore. Otherwise the bare name first - the dev checkout, the one specifier only the import itself
 * can settle - and then the package directories this machine derives.
 */
export function piSdkCandidates(overrides: Partial<PiSdkLookup> = {}): string[] {
  const lookup = lookupFrom(overrides);
  const override = lookup.env.PI_SDK_PATH?.trim();
  if (override) return [piSdkEntry(override)];
  return [PI_SDK_PACKAGE, ...derivedPiSdkDirs(lookup).map(piSdkEntry)];
}

/**
 * The Pi SDK, from the first candidate in the ladder that loads. A failure here is RunnerUnavailable,
 * never a turn: this runner never started (agent.ts), so no Ticket is blamed for it. The message names
 * PI_SDK_PATH because that is the one fix an operator has where the bare name cannot resolve.
 */
export async function loadPiSdk(overrides: Partial<PiSdkLookup> = {}): Promise<PiSdkModule> {
  const tried: string[] = [];
  for (const candidate of piSdkCandidates(overrides)) {
    try {
      return (await import(candidate)) as PiSdkModule;
    } catch (e) {
      tried.push(`${candidate} (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  throw new RunnerUnavailable(
    `cannot reach the Pi SDK ${PI_SDK_PACKAGE}: tried ${tried.join("; ")}. ` +
      `An Archon run executes this pack from a workspace copy with no node_modules, so set PI_SDK_PATH ` +
      `to the installed package directory - the one \`npm root -g\` names underneath.`,
  );
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
  const pi = await loadPiSdk();
  const { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, resolveCliModel, SessionManager } = pi;

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
    customTools: [piBashTool(pi, opts)],
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
