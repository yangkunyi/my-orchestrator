/**
 * The dsh runner: the same AgentRunner seam, spent on DeepSeek Harness in its minimal profile
 * instead of an in-process Pi session.
 *
 * `dsh --profile sdk-minimal` is a newline-delimited JSON-RPC server on stdio: `initialize`,
 * `session/prompt`, `session.event` / `session.status` notifications, `shutdown`. The minimal tree
 * carries the persona as the whole system prompt and one persistent bash tool, so the skill body
 * travels as DSH_SYSTEM_PROMPT and the ticket task as the first message.
 *
 * Only implement and conflict use this runner; the review node keeps its read-only Pi session.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { AGENT_WALL_MS, type PackAgentOpts, type PackAgentResult } from "./agent.ts";
import type { ThinkingLevel } from "./config.ts";

const PROFILE = "sdk-minimal";
const PROVIDER = "deepseek-official";
const DEFAULT_MODEL = "deepseek-flash";
/** dsh's deepseek llm plugin knows exactly four efforts; Pi's seven levels fold onto them. */
const EFFORT: Record<ThinkingLevel, string> = {
  off: "off",
  minimal: "low",
  low: "low",
  medium: "high",
  high: "high",
  xhigh: "high",
  max: "max",
};
const DEFAULT_DSH_HOME = join(homedir(), ".dsh-pack");
const INIT_TIMEOUT_MS = 60_000;
const PROMPT_TIMEOUT_MS = 60_000;
const SHUTDOWN_GRACE_MS = 2_000;

type Frame = {
  id?: string;
  method?: string;
  params?: {
    sessionId?: string;
    status?: string;
    event?: {
      type?: string;
      data?: { reason?: { kind?: string }; message?: { content?: unknown } };
    };
  };
  result?: unknown;
  error?: { code?: number; message?: string };
};

/**
 * The message a turn ends with. The harness emits reasoning parts too and they also carry `text`, so
 * only type "text" parts count: anything else would leak thinking into the node's product.
 */
function answerText(content: unknown): string | undefined {
  if (typeof content === "string") return content.trim() ? content : undefined;
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .filter((part): part is { type?: unknown; text?: unknown } => Boolean(part) && typeof part === "object")
    .filter((part) => part.type === "text" && typeof part.text === "string" && part.text.length > 0)
    .map((part) => part.text as string);
  const joined = parts.join("").trim();
  return joined.length > 0 ? joined : undefined;
}

type Credentials = { baseUrl: string; apiKey: string; model: string | undefined };

/**
 * Endpoint, key and default model for the dsh runtime: the environment first, then the file the Pi
 * runner's model runtime reads, so both runners resolve the same gateway.
 * ponytail: the provider entry is named, not searched - lift it into config when a Target needs another.
 */
function credentials(): Credentials {
  const baseUrl = process.env.DEEPSEEK_BASE_URL?.trim();
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (baseUrl && apiKey) return { baseUrl, apiKey, model: undefined };
  const file = join(homedir(), ".pi", "agent", "models.json");
  const packy = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as { providers?: Record<string, unknown> }).providers?.packy
    : undefined;
  const p = packy as { baseUrl?: unknown; apiKey?: unknown; models?: { id?: unknown }[] } | undefined;
  const models = Array.isArray(p?.models) ? p.models.map((m) => m?.id).filter((id): id is string => typeof id === "string") : [];
  if (typeof p?.baseUrl === "string" && typeof p.apiKey === "string") {
    return { baseUrl: p.baseUrl, apiKey: p.apiKey, model: models[0] };
  }
  throw new Error(
    "the dsh runner needs DEEPSEEK_BASE_URL + DEEPSEEK_API_KEY, or a providers.packy entry in ~/.pi/agent/models.json",
  );
}

/** One dsh process, spoken to over stdio. */
class DshRuntime {
  readonly sessionId: string;
  private readonly child: ChildProcess;
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly stderr: string[] = [];
  private seq = 0;
  private sawTurn = false;
  private idle: { resolve: () => void; reject: (e: Error) => void } | undefined;
  private ended: string | undefined;
  private said: string | undefined;
  private closed = false;

  constructor(
    private readonly cwd: string,
    env: NodeJS.ProcessEnv,
    private readonly model: string,
    private readonly effort: string,
  ) {
    this.sessionId = `session-${crypto.randomUUID().replace(/-/g, "")}`;
    this.child = spawn(process.env.DSH_BIN?.trim() || "dsh", ["--profile", PROFILE], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    createInterface({ input: this.child.stdout! }).on("line", (line) => this.onLine(line));
    createInterface({ input: this.child.stderr! }).on("line", (line) => {
      this.stderr.push(line);
    });
    this.child.on("error", (e) => this.fail(new Error(`dsh spawn failed: ${e.message}`)));
    this.child.on("exit", (code, signal) => {
      if (!this.closed) this.fail(new Error(`dsh exited (code=${code}, signal=${signal})${this.diagnostics()}`));
    });
  }

  private diagnostics(): string {
    return this.stderr.length ? `: ${this.stderr.slice(-3).join(" | ")}` : "";
  }

  private fail(e: Error): void {
    for (const [, waiter] of this.pending) waiter.reject(e);
    this.pending.clear();
    this.idle?.reject(e);
  }

  private onLine(line: string): void {
    let frame: Frame;
    try {
      frame = JSON.parse(line) as Frame;
    } catch {
      return; // stdout carries frames only, but never trust a pipe
    }
    if (frame.method === undefined) {
      if (frame.id === undefined) return;
      const waiter = this.pending.get(frame.id);
      if (!waiter) return;
      this.pending.delete(frame.id);
      if (frame.error) waiter.reject(new Error(`dsh error ${frame.error.code ?? ""} ${frame.error.message ?? ""}`.trim()));
      else waiter.resolve(frame.result);
      return;
    }
    const params = frame.params;
    if (params?.sessionId !== this.sessionId) return; // child sessions carry their own ids
    if (frame.method === "session.event") {
      this.sawTurn = true;
      const event = params.event;
      if (event?.type === "turn/end") this.ended = event.data?.reason?.kind;
      // The final answer is the last assistant message that carried text, not the last message.
      if (event?.type === "assistant/message") {
        const text = answerText(event.data?.message?.content);
        if (text) this.said = text;
      }
      return;
    }
    if (frame.method === "session.status") {
      if (params.status === "running") this.sawTurn = true;
      if (params.status === "idle" && this.sawTurn) this.idle?.resolve();
    }
  }

  private send(message: unknown): void {
    this.child.stdin!.write(`${JSON.stringify(message)}\n`);
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = String(++this.seq);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`dsh ${method} timed out after ${timeoutMs}ms${this.diagnostics()}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /** Send the turn and resolve once the session reports idle after it started. */
  async run(promptText: string): Promise<void> {
    await this.request(
      "initialize",
      { cwd: this.cwd, provider: PROVIDER, model: this.model, reasoningEffort: this.effort },
      INIT_TIMEOUT_MS,
    );
    const idle = new Promise<void>((resolve, reject) => {
      this.idle = { resolve, reject };
    });
    await this.request(
      "session/prompt",
      { sessionId: this.sessionId, contentBlocks: [{ type: "text", text: promptText }] },
      PROMPT_TIMEOUT_MS,
    );
    await idle;
  }

  finishReason(): string | undefined {
    return this.ended;
  }

  lastMessage(): string | undefined {
    return this.said;
  }

  kill(): void {
    this.child.kill("SIGKILL");
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.request("shutdown", undefined, SHUTDOWN_GRACE_MS);
    } catch {
      // a finished turn is what matters; a wedged runtime is killed below
    }
    this.child.kill("SIGTERM");
  }
}

/** The harness logs one session per workspace root under DSH_HOME, encoded as `--path-with-dashes--`. */
function dshSessionFile(dshHome: string, cwd: string, sessionId: string): string {
  const slug = `--${cwd.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9]+/g, "-")}--`;
  const dir = join(dshHome, "sessions", slug, sessionId);
  const file = join(dir, "session.v3.jsonl");
  return existsSync(file) ? file : existsSync(dir) ? dir : file;
}

export async function dshAgent(opts: PackAgentOpts): Promise<PackAgentResult> {
  const persona = opts.persona;
  if (!persona) throw new Error("the dsh runner needs opts.persona: the skill or contract for its system prompt");
  const creds = credentials();
  const dshHome = process.env.DSH_HOME?.trim() || DEFAULT_DSH_HOME;
  // ponytail: tools and useBash are ignored - the minimal tree is fixed at one persistent bash tool,
  // and it mounts no sandbox plugin, so the review node's read-only contract is instruction-only here
  // (the persona says what may never be run). Pi still enforces it structurally.
  const rt = new DshRuntime(
    opts.cwd,
    {
      ...process.env,
      DSH_HOME: dshHome,
      DEEPSEEK_BASE_URL: creds.baseUrl,
      DEEPSEEK_API_KEY: creds.apiKey,
      DSH_SYSTEM_PROMPT: persona,
    },
    opts.model?.trim() || creds.model || DEFAULT_MODEL,
    EFFORT[opts.thinkingLevel],
  );
  const wallMs = opts.wallMs ?? AGENT_WALL_MS;
  let aborted = false;
  let wall: ReturnType<typeof setTimeout> | undefined;
  const sessionFile = (): string => dshSessionFile(dshHome, opts.cwd, rt.sessionId);
  try {
    await Promise.race([
      rt.run(opts.prompt),
      new Promise<never>((_, reject) => {
        wall = setTimeout(() => {
          aborted = true;
          rt.kill(); // dsh has no cancel in this subset: the wall clock ends the process
          reject(new Error("agent aborted after wall clock"));
        }, wallMs);
      }),
    ]);
    const reason = rt.finishReason();
    return {
      sessionFile: sessionFile(),
      lastError: reason && reason !== "completed" ? `turn ended: ${reason}` : undefined,
      text: rt.lastMessage(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      sessionFile: sessionFile(),
      lastError: aborted ? "agent aborted after wall clock" : msg,
      text: rt.lastMessage(),
    };
  } finally {
    clearTimeout(wall);
    await rt.close();
  }
}
