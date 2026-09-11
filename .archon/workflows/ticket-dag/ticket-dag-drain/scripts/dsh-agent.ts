/**
 * The pack's dsh policy: everything the pack asks of DeepSeek Harness, and nothing of its wire
 * protocol (that lives in dsh-runtime.ts).
 *
 * Where the two runners differ - whatever this adapter does that Pi's pi-session.ts does not:
 * - thinking levels: dsh's deepseek plugin knows exactly four efforts, so Pi's seven levels fold
 *   onto them through EFFORT below; Pi passes its thinking level straight through.
 * - the tool set: the minimal tree is fixed at one persistent bash tool and mounts no sandbox
 *   plugin, so a read-only role is instruction-only here - the contract reaches the agent in the
 *   persona, which is this runner's whole system prompt. Pi enforces the same contract structurally.
 *   The seam carries no tool option for that reason.
 * - abort: this dsh subset has no cancel, so the wall clock ends the process with SIGKILL; Pi calls
 *   session.abort().
 *
 * The harness carries the persona as the whole system prompt, so the skill body travels as
 * DSH_SYSTEM_PROMPT and the ticket task as the first message. The Target's `runner:` drives every
 * agent node, the drain-end readers included.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AGENT_WALL_MS, packAnswer, type PackAgentOpts, type PackAgentResult } from "./agent.ts";
import { DshRuntime } from "./dsh-runtime.ts";
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
  const rt = new DshRuntime({
    cwd: opts.cwd,
    // The same seam transform Pi applies, on this adapter's own base: DSH_* stay, the Worktree's
    // .venv joins PATH when there is one. dsh's session is the one that used to miss it.
    env: opts.env({
      ...process.env,
      DSH_HOME: dshHome,
      DEEPSEEK_BASE_URL: creds.baseUrl,
      DEEPSEEK_API_KEY: creds.apiKey,
      DSH_SYSTEM_PROMPT: persona,
    }),
    argv: ["--profile", PROFILE],
    provider: PROVIDER,
    model: opts.model?.trim() || creds.model || DEFAULT_MODEL,
    effort: EFFORT[opts.thinkingLevel],
  });
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
      answer: packAnswer(rt.lastMessage()),
      lastError: reason && reason !== "completed" ? `turn ended: ${reason}` : undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      sessionFile: sessionFile(),
      answer: packAnswer(rt.lastMessage()),
      lastError: aborted ? "agent aborted after wall clock" : msg,
    };
  } finally {
    clearTimeout(wall);
    await rt.close();
  }
}
