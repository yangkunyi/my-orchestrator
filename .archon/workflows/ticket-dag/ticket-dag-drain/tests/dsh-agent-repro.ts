#!/usr/bin/env bun
/**
 * Temp-Target repro: the dsh runner against a STUB runtime. No network, no real dsh, no Archon.
 * The stub speaks the same newline-delimited JSON-RPC the harness does, and records what it was told.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dshAgent } from "../scripts/dsh-agent.ts";
import type { ThinkingLevel } from "../scripts/config.ts";
import { implementPrompt } from "../scripts/prompt.ts";
import { expect, expectEqual, expectReject, mkTemp, runScript } from "./target.ts";

const STUB = `#!${process.execPath}
import { mkdirSync, writeFileSync } from "node:fs";
const seen = process.env.STUB_SEEN;
const turnKind = process.env.STUB_TURN_KIND ?? "completed";
const record = {
  argv: process.argv.slice(2),
  home: process.env.DSH_HOME,
  baseUrl: process.env.DEEPSEEK_BASE_URL,
  apiKey: process.env.DEEPSEEK_API_KEY,
  persona: process.env.DSH_SYSTEM_PROMPT,
};
const save = () => writeFileSync(seen, JSON.stringify(record));
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
const notify = (method, params) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\\n");
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let nl = buffer.indexOf("\\n"); nl >= 0; nl = buffer.indexOf("\\n")) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
function handle(message) {
  if (message.method === "initialize") {
    record.initialize = message.params;
    save();
    reply(message.id, { serverInfo: { name: "stub-runtime" } });
    return;
  }
  if (message.method === "session/prompt") {
    record.prompt = message.params;
    save();
    const sessionId = message.params.sessionId;
    const slug = "--" + process.cwd().replace(/^\\/+|\\/+$/g, "").replace(/[^a-zA-Z0-9]+/g, "-") + "--";
    const dir = [record.home, "sessions", slug, sessionId].join("/");
    mkdirSync(dir, { recursive: true });
    writeFileSync([dir, "session.v3.jsonl"].join("/"), JSON.stringify({ stub: true }) + "\\n");
    reply(message.id, { messageId: "message-1" });
    notify("session.status", { sessionId, status: "running" });
    notify("session.event", { sessionId, event: { type: "turn/end", seq: 1, data: { turn: 1, reason: { kind: turnKind } } } });
    notify("session.status", { sessionId, status: "idle" });
    return;
  }
  if (message.method === "shutdown") {
    save();
    reply(message.id, {});
    process.exit(0);
  }
}
`;

const work = mkTemp("pack-dsh-");
const home = mkTemp("pack-dsh-home-");
const seen = join(work, "seen.json");
const stub = join(work, "stub-dsh");
writeFileSync(stub, STUB);
chmodSync(stub, 0o755);
// The missing-credential branch needs its own HOME, and homedir() ignores process.env.HOME - so it
// runs in a child process with a fresh environment instead.
const noHome = mkTemp("pack-dsh-nohome-");
const probe = join(work, "no-credentials.ts");
writeFileSync(
  probe,
  `import { dshAgent } from ${JSON.stringify(join(import.meta.dir, "../scripts/dsh-agent.ts"))};\n` +
    `try {\n` +
    `  await dshAgent({ cwd: process.cwd(), artifactsDir: process.cwd(), ticketId: "feat/01", role: "implement", model: undefined, thinkingLevel: "high", prompt: "do it" });\n` +
    `  console.log(JSON.stringify({ threw: false }));\n` +
    `} catch (e) {\n` +
    `  console.log(JSON.stringify({ threw: true, message: e instanceof Error ? e.message : String(e) }));\n` +
    `}\n`,
);

const saved = { ...process.env };
process.env.DSH_BIN = stub;
process.env.DSH_HOME = home;
process.env.DEEPSEEK_BASE_URL = "https://gateway.invalid/v1";
process.env.DEEPSEEK_API_KEY = "test-key";
process.env.STUB_SEEN = seen;

const run = (role: "implement" | "conflict", prompt: string, model?: string, level: ThinkingLevel = "high") =>
  dshAgent({
    cwd: work,
    artifactsDir: work,
    ticketId: "feat/01",
    role,
    model,
    thinkingLevel: level,
    prompt,
  });

try {
  const prompt = implementPrompt("tickets/01-demo.md");
  const result = await run("implement", prompt);
  const got = JSON.parse(readFileSync(seen, "utf8")) as Record<string, any>;

  expectEqual("stub launched with the minimal profile", got.argv.join(" "), "--profile sdk-minimal");
  expectEqual("DSH_HOME is passed through", got.home, home);
  expectEqual("gateway from the environment", got.baseUrl, "https://gateway.invalid/v1");
  expect("persona carries the implement skill", got.persona.includes("Implement the work described by the user"));
  expect("persona carries the tdd rules", got.persona.includes("Red before green."));
  expect("persona carries the seams rule", got.persona.includes("Test only at pre-agreed seams."));
  expectEqual("initialize cwd", got.initialize.cwd, work);
  expectEqual("initialize provider", got.initialize.provider, "deepseek-official");
  expectEqual("initialize model defaults", got.initialize.model, "deepseek-flash");
  expectEqual("initialize effort from thinkingLevel", got.initialize.reasoningEffort, "high");
  expect("session id is ours", String(got.prompt.sessionId).startsWith("session-"));
  const text = got.prompt.contentBlocks[0].text as string;
  expect("message carries the task", text.includes("tickets/01-demo.md"));
  expect("message drops the skill body the persona carries", !text.includes("Implement the work described by the user"));
  expectEqual("session log is returned", result.sessionFile, join(home, "sessions", `--${work.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9]+/g, "-")}--`, got.prompt.sessionId, "session.v3.jsonl"));
  expect("session log exists", existsSync(result.sessionFile));
  expectEqual("completed turn has no error", result.lastError, undefined);

  process.env.STUB_TURN_KIND = "aborted";
  const second = await run("conflict", "resolve the conflict", "custom-model");
  const got2 = JSON.parse(readFileSync(seen, "utf8")) as Record<string, any>;
  expectEqual("configured model wins", got2.initialize.model, "custom-model");
  expectEqual("a non-completed turn is reported", second.lastError, "turn ended: aborted");

  await expectReject(
    "review stays on Pi",
    () => run("review" as unknown as "conflict", "review the diff"),
    /does not serve the review node/,
  );

  for (const [level, effort] of [
    ["off", "off"],
    ["minimal", "low"],
    ["medium", "high"],
    ["xhigh", "high"],
    ["max", "max"],
  ] as const) {
    await run("conflict", "resolve the conflict", undefined, level);
    const mapped = JSON.parse(readFileSync(seen, "utf8")) as Record<string, any>;
    expectEqual(`thinkingLevel ${level} maps to effort ${effort}`, mapped.initialize.reasoningEffort, effort);
  }

  delete process.env.DEEPSEEK_BASE_URL;
  delete process.env.DEEPSEEK_API_KEY;
  const bare = runScript(probe, work, { HOME: noHome, DSH_BIN: stub, DSH_HOME: home });
  const bareOut = JSON.parse((bare.stdout || "{}").trim().split("\n").pop() ?? "{}") as { threw?: boolean; message?: string };
  expect("credentials are required", bareOut.threw === true);
  expect("and the error names what to set", (bareOut.message ?? "").includes("needs DEEPSEEK_BASE_URL"));

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
} finally {
  for (const key of ["DSH_BIN", "DSH_HOME", "DEEPSEEK_BASE_URL", "DEEPSEEK_API_KEY", "STUB_SEEN", "STUB_TURN_KIND"] as const) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(work, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  rmSync(noHome, { recursive: true, force: true });
}
