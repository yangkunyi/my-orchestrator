import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  AGENT_WALL_MS,
  armSessionAbort,
  lastAssistantError,
  ticketSessionFile,
  type PackAgentOpts,
  type PackAgentResult,
} from "./agent.ts";
import { prependVenvBin } from "./begin.ts";

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

  const sessionFile = ticketSessionFile(opts.artifactsDir, opts.ticketId, opts.role);
  mkdirSync(dirname(sessionFile), { recursive: true });
  if (!existsSync(sessionFile)) writeFileSync(sessionFile, "");
  const sessionManager = SessionManager.open(sessionFile, dirname(sessionFile), opts.cwd);
  sessionManager.appendSessionInfo(`${opts.ticketId} ${opts.role}`);

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

  const { session } = await createAgentSession({
    cwd: opts.cwd,
    model,
    thinkingLevel: opts.thinkingLevel,
    modelRuntime,
    sessionManager,
    resourceLoader,
    ...(opts.tools ? { tools: opts.tools } : {}),
    ...(opts.useBash === false
      ? {}
      : {
          customTools: [
            createBashToolDefinition(opts.cwd, {
              spawnHook: (ctx) => ({
                ...ctx,
                env: { ...ctx.env, PATH: prependVenvBin(ctx.env.PATH, opts.cwd) },
              }),
            }),
          ],
        }),
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
      await session.prompt(opts.prompt);
    } catch (e) {
      const file = sessionManager.getSessionFile() ?? sessionFile;
      const msg = e instanceof Error ? e.message : String(e);
      return {
        sessionFile: file,
        lastError: lastAssistantError(file) ?? (aborted ? "agent aborted after wall clock" : msg),
      };
    }
    const file = sessionManager.getSessionFile() ?? sessionFile;
    return {
      sessionFile: file,
      lastError: lastAssistantError(file) ?? (aborted ? "agent aborted after wall clock" : undefined),
    };
  } finally {
    cancel();
    session.dispose();
  }
}
