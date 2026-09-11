#!/usr/bin/env bun
/**
 * Temp-Target repro: the dsh runner against a STUB runtime. No network, no real dsh, no Archon.
 * The stub speaks the same newline-delimited JSON-RPC the harness does, and records what it was told.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ThinkingLevel } from "../scripts/config.ts";
import type { PackAgentOpts } from "../scripts/agent.ts";
import { dshAgent } from "../scripts/dsh-agent.ts";
import { DshRuntime } from "../scripts/dsh-runtime.ts";
import { implementTask, personaFor, readTddSkill, REVIEW_AXES, reviewPersona, reviewTask } from "../scripts/prompt.ts";
import { sessionEnv } from "../scripts/worktree-env.ts";
import { expect, expectEqual, expectReject, mkTemp, runScript } from "./target.ts";

const STUB = `#!${process.execPath}
import { mkdirSync, writeFileSync } from "node:fs";
const seen = process.env.STUB_SEEN;
const turnKind = process.env.STUB_TURN_KIND ?? "completed";
const silent = process.env.STUB_SILENT === "1";
const record = {
  argv: process.argv.slice(2),
  home: process.env.DSH_HOME,
  baseUrl: process.env.DEEPSEEK_BASE_URL,
  apiKey: process.env.DEEPSEEK_API_KEY,
  persona: process.env.DSH_SYSTEM_PROMPT,
  path: process.env.PATH,
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
    if (!silent) notify("session.event", { sessionId, event: { type: "assistant/message", seq: 11, data: { turn: 1, step: 1, message: { role: "assistant", content: [{ type: "reasoning", text: "THINKING-LEAK" }, { type: "text", text: "STUB-ANSWER" }] } } } });
    notify("session.event", { sessionId, event: { type: "turn/end", seq: 12, data: { turn: 1, reason: { kind: turnKind } } } });
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
    `  await dshAgent({ cwd: process.cwd(), artifactsDir: process.cwd(), sessionKey: "feat/01", role: "implement", model: undefined, thinkingLevel: "high", prompt: "do it", persona: "PERSONA" });\n` +
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

type Call = {
  role: "implement" | "conflict" | "review";
  task: string;
  persona: string;
  model?: string;
  level?: ThinkingLevel;
  /** Where the session runs: the Ticket Worktree by default, the Target for the Main cases below. */
  cwd?: string;
};
const run = ({ role, task, persona, model, level = "high", cwd = work }: Call) =>
  dshAgent({
    cwd,
    // The seam's transform from the module that owns it: the same value roles.ts puts on the opts, and
    // the one Pi applies to its spawn context. This test is about what dsh does with what it is handed.
    env: (base) => sessionEnv(cwd, base),
    artifactsDir: work,
    sessionKey: "feat/01",
    role,
    model,
    thinkingLevel: level,
    prompt: task,
    persona,
  });

try {
  // The dsh implement node's persona is composed from a skill tree the caller names; this run points
  // at its own stub tree, so no assertion here depends on the machine's pi skills being installed.
  const skill = {
    dir: join(work, "skills", "tdd"),
    body: "---\nname: tdd\ndescription: stub\n---\n\nRed before green.\n\nTest only at pre-agreed seams.\n\nRead the codebase-design skill for the vocabulary.\n",
  };
  const task = implementTask("tickets/01-demo.md");
  // A Ticket Worktree has a .venv once `uv sync` has run; the stub records the PATH it was spawned with.
  mkdirSync(join(work, ".venv", "bin"), { recursive: true });
  const result = await run({ role: "implement", task, persona: personaFor("implement", "dsh", { skill }) });
  const got = JSON.parse(readFileSync(seen, "utf8")) as Record<string, any>;

  expectEqual("stub launched with the minimal profile", got.argv.join(" "), "--profile sdk-minimal");
  expectEqual("DSH_HOME is passed through", got.home, home);
  expectEqual("gateway from the environment", got.baseUrl, "https://gateway.invalid/v1");
  expect("persona carries the implement skill", got.persona.includes("Implement the work described by the user"));
  expect("persona carries the tdd rules", got.persona.includes("Red before green."));
  expect("persona carries the seams rule", got.persona.includes("Test only at pre-agreed seams."));
  expect("persona drops the out-of-scope pointer", !got.persona.includes("codebase-design"));
  expect("persona keeps the examples reachable", got.persona.includes("tests.md"));
  expect("persona names the skill tree it came from", got.persona.includes(skill.dir));
  expectEqual("initialize cwd", got.initialize.cwd, work);
  expectEqual("initialize provider", got.initialize.provider, "deepseek-official");
  expectEqual("initialize model defaults", got.initialize.model, "deepseek-flash");
  expectEqual("initialize effort from thinkingLevel", got.initialize.reasoningEffort, "high");
  expect("session id is ours", String(got.prompt.sessionId).startsWith("session-"));
  expectEqual("the message is the task, never the skill", got.prompt.contentBlocks[0].text, task);
  expectEqual(
    "session log is returned",
    result.sessionFile,
    join(
      home,
      "sessions",
      `--${work.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9]+/g, "-")}--`,
      got.prompt.sessionId,
      "session.v3.jsonl",
    ),
  );
  expect("session log exists", existsSync(result.sessionFile));
  expectEqual("completed turn has no error", result.lastError, undefined);
  expectEqual("the answer comes off the event stream", result.answer, { kind: "text", text: "STUB-ANSWER" });
  const answerText = result.answer.kind === "text" ? result.answer.text : "";
  expect("reasoning parts never leak into the answer", !answerText.includes("THINKING-LEAK"));

  // The Worktree rule, where it used to be dropped: dsh's child used to get `...process.env` alone.
  expectEqual(
    "the Worktree's .venv is first on the child PATH",
    got.path,
    `${join(work, ".venv", "bin")}:${saved.PATH ?? ""}`,
  );
  // The Target has no .venv, so the drain-end readers' base environment is passed through untouched.
  const target = mkTemp("pack-dsh-main-");
  await run({ role: "conflict", task: "resolve the conflict", persona: personaFor("conflict", "dsh"), cwd: target });
  const gotMain = JSON.parse(readFileSync(seen, "utf8")) as Record<string, any>;
  expectEqual("a cwd without a .venv leaves PATH alone", gotMain.path, saved.PATH ?? "");
  expectEqual("and still gets the harness variables", gotMain.home, home);

  process.env.STUB_TURN_KIND = "aborted";
  const second = await run({
    role: "conflict",
    task: "resolve the conflict",
    persona: personaFor("conflict", "dsh"),
    model: "custom-model",
  });
  const got2 = JSON.parse(readFileSync(seen, "utf8")) as Record<string, any>;
  expectEqual("configured model wins", got2.initialize.model, "custom-model");
  expectEqual("a non-completed turn is reported", second.lastError, "turn ended: aborted");
  expectEqual("partial text still comes back", second.answer, { kind: "text", text: "STUB-ANSWER" });

  // A turn that spoke no text at all is not an empty answer and not a log to re-read: it says so.
  process.env.STUB_SILENT = "1";
  const quiet = await run({ role: "conflict", task: "resolve the conflict", persona: personaFor("conflict", "dsh") });
  expectEqual("a turn with no assistant text answers none", quiet.answer, { kind: "none" });
  delete process.env.STUB_SILENT;

  const reviewPayload = reviewTask("abc", "head1", "c1 do a thing\n");
  const review = await run({
    role: "review",
    task: reviewPayload,
    persona: reviewPersona("abc", REVIEW_AXES[0]),
  });
  const got3 = JSON.parse(readFileSync(seen, "utf8")) as Record<string, any>;
  expectEqual("review message is the range payload", got3.prompt.contentBlocks[0].text, reviewPayload);
  expect("review persona pins the range", got3.persona.includes("abc...HEAD"));
  // dsh has no allowlist to mount: the persona is the whole enforcement of this contract.
  expect(
    "review persona is read-only by instruction",
    got3.persona.includes("read-only") && got3.persona.includes("Never write:"),
  );
  expect("review persona names no Pi tool line", !got3.persona.includes("Use read, grep, find, and ls"));
  expect("review persona never tells it to spawn agents", got3.persona.includes("Do not spawn agents"));
  expect("review persona carries its axis", got3.persona.includes(`Your axis: ${REVIEW_AXES[0]}`));
  expectEqual("review returns its answer too", review.answer, { kind: "text", text: "STUB-ANSWER" });

  for (const [level, effort] of [
    ["off", "off"],
    ["minimal", "low"],
    ["medium", "high"],
    ["xhigh", "high"],
    ["max", "max"],
  ] as const) {
    await run({ role: "conflict", task: "resolve the conflict", persona: personaFor("conflict", "dsh"), level });
    const mapped = JSON.parse(readFileSync(seen, "utf8")) as Record<string, any>;
    expectEqual(`thinkingLevel ${level} maps to effort ${effort}`, mapped.initialize.reasoningEffort, effort);
  }

  // The guard is for callers the type cannot reach (plain JS, a config-driven dispatch), so the opts
  // are built without the field on purpose and passed through one narrow cast. The cast is the test.
  const withoutPersona = {
    cwd: work,
    artifactsDir: work,
    sessionKey: "feat/01",
    role: "implement",
    model: undefined,
    thinkingLevel: "high",
    prompt: "do it",
  } as unknown as PackAgentOpts;
  await expectReject("a persona is required", () => dshAgent(withoutPersona), /needs opts.persona/);

  delete process.env.DEEPSEEK_BASE_URL;
  delete process.env.DEEPSEEK_API_KEY;
  const bare = runScript(probe, work, { HOME: noHome, DSH_BIN: stub, DSH_HOME: home });
  const bareOut = JSON.parse((bare.stdout || "{}").trim().split("\n").pop() ?? "{}") as {
    threw?: boolean;
    message?: string;
  };
  expect("credentials are required", bareOut.threw === true);
  expect("and the error names what to set", (bareOut.message ?? "").includes("needs DEEPSEEK_BASE_URL"));

  // The dsh implement persona's tdd section is a pure function of the skill the caller hands it:
  // the tree-found and the tree-absent branch are both asserted here, with no child and no HOME.
  const suppliedPersona = personaFor("implement", "dsh", { skill });
  expect("the supplied skill body feeds the persona", suppliedPersona.includes("Red before green."));
  expect("the out-of-scope pointer is filtered out", !suppliedPersona.includes("codebase-design"));
  expect("the persona names the tree it came from", suppliedPersona.includes(skill.dir));
  expect(
    "the persona frames the skill's siblings",
    suppliedPersona.includes("tests.md") && suppliedPersona.includes("mocking.md"),
  );

  // The reader is the only place the filesystem is touched, and absence is a value, not a throw.
  const treeDir = join(work, "tree-with-skill");
  mkdirSync(treeDir, { recursive: true });
  writeFileSync(join(treeDir, "SKILL.md"), skill.body);
  const found = personaFor("implement", "dsh", { skill: readTddSkill(treeDir) });
  expect("the reader finds a tree on disk", found.includes("Red before green."));
  expect("and the persona names that tree", found.includes(treeDir));

  const missingTree = join(work, "no-such-tree");
  expectEqual("a missing tree reads as undefined, not a thrown error", readTddSkill(missingTree), undefined);
  const fallbackPersona = personaFor("implement", "dsh", { skill: readTddSkill(missingTree) });
  expect("no skill tree falls back to the inlined body", fallbackPersona.includes("Red before green."));
  expect("the fallback drops the pointer too", !fallbackPersona.includes("codebase-design"));
  expect("a supplied skill and an absent one are different personas", fallbackPersona !== suppliedPersona);

  // The runtime module is the wire protocol alone: the stub drives it with no persona, no
  // credentials and no pack config - only an argv, a minimal environment and an initialize handshake.
  const bareSeen = join(work, "bare-seen.json");
  const rt = new DshRuntime({
    cwd: work,
    env: { STUB_SEEN: bareSeen, DSH_HOME: home },
    argv: ["--profile", "sdk-minimal"],
    provider: "bare-provider",
    model: "bare-model",
    effort: "low",
  });
  await rt.run("BARE-PROMPT");
  const bareGot = JSON.parse(readFileSync(bareSeen, "utf8")) as Record<string, any>;
  expectEqual("runtime initialize takes the caller's cwd", bareGot.initialize.cwd, work);
  expectEqual("runtime initialize takes the caller's provider", bareGot.initialize.provider, "bare-provider");
  expectEqual("runtime initialize takes the caller's model", bareGot.initialize.model, "bare-model");
  expectEqual("runtime initialize takes the caller's effort", bareGot.initialize.reasoningEffort, "low");
  expectEqual("runtime sends the caller's prompt", bareGot.prompt.contentBlocks[0].text, "BARE-PROMPT");
  expect("runtime needs no persona", bareGot.persona === undefined);
  expectEqual("runtime reads the turn kind off the stream", rt.finishReason(), "completed");
  expectEqual("runtime reads the final text off the stream", rt.lastMessage(), "STUB-ANSWER");
  expect("runtime leaks no reasoning part", !(rt.lastMessage() ?? "").includes("THINKING-LEAK"));
  await rt.close();

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
} finally {
  for (const key of [
    "DSH_BIN",
    "DSH_HOME",
    "DEEPSEEK_BASE_URL",
    "DEEPSEEK_API_KEY",
    "STUB_SEEN",
    "STUB_TURN_KIND",
    "STUB_SILENT",
  ] as const) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(work, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  rmSync(noHome, { recursive: true, force: true });
}
