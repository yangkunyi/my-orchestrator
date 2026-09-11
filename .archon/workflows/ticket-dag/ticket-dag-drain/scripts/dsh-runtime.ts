/**
 * The dsh wire protocol, with no pack nouns: spawn `dsh --profile <tree>`, write newline-delimited
 * JSON-RPC to stdin, match responses by id, read `session.event` / `session.status` off stdout,
 * detect the turn's idle, time out, collect stderr, and shut down.
 *
 * Nothing here knows a Ticket, a persona, a role or a gateway - the caller supplies the argv, the
 * initialize handshake and the environment. tests/dsh-agent-repro.ts drives this class against a
 * stub dsh with no pack config at all.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

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

export type DshRuntimeOpts = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Everything after the dsh binary: the caller picks the harness tree, e.g. ["--profile", "sdk-minimal"]. */
  argv: string[];
  /** The initialize handshake: which gateway answers, with which model, and how hard it thinks. */
  provider: string;
  model: string;
  effort: string;
};

/** One dsh process, spoken to over stdio. */
export class DshRuntime {
  readonly sessionId: string;
  private readonly child: ChildProcess;
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly stderr: string[] = [];
  private seq = 0;
  private ready = false;
  private sawTurn = false;
  private idle: { resolve: () => void; reject: (e: Error) => void } | undefined;
  private ended: string | undefined;
  private said: string | undefined;
  private closed = false;

  constructor(private readonly opts: DshRuntimeOpts) {
    this.sessionId = `session-${crypto.randomUUID().replace(/-/g, "")}`;
    // DSH_BIN is this module's test hook: tests/dsh-agent-repro.ts points it at a stub harness. It is
    // the one variable read from this process rather than from the caller's environment, and nothing
    // in the pack sets it. Unset, the child is `dsh`, which Bun resolves off opts.env's PATH.
    this.child = spawn(process.env.DSH_BIN?.trim() || "dsh", opts.argv, {
      cwd: opts.cwd,
      env: opts.env,
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
      {
        cwd: this.opts.cwd,
        provider: this.opts.provider,
        model: this.opts.model,
        reasoningEffort: this.opts.effort,
      },
      INIT_TIMEOUT_MS,
    );
    this.ready = true;
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

  /**
   * Whether the harness answered initialize. Before that, any failure (no binary, a profile that
   * cannot boot, a child that exits early) means the runtime never came up - the pack's dsh layer reads
   * this to tell "cannot start" from "the turn went badly", which are different to a Ticket.
   */
  hasStarted(): boolean {
    return this.ready;
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
