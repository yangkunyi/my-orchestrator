#!/usr/bin/env bun
/**
 * Temp-Target repro: how the Pi adapter reaches its SDK, and the environment the bash tool it mounts
 * really spawns with. No Archon engine, no session, no credentials, no network.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RunnerUnavailable } from "../scripts/agent.ts";
import { loadPiSdk, piBashTool, piSdkCandidates } from "../scripts/pi-session.ts";
import { sessionEnv } from "../scripts/worktree-env.ts";
import { envWithout, expect, expectEqual, mkTemp } from "./target.ts";

const PI_SDK_PACKAGE = "@earendil-works/pi-coding-agent";
const PACK = join(import.meta.dir, "..");

/**
 * What this repro drives on the mounted definition. The SDK's own execute takes an ExtensionContext and
 * runs bash at `ctx?.cwd || cwd` with `exposeSessionEnvironment && ctx` (measured), so undefined is the
 * sessionless case: no session, no credentials, no network, one bounded shell command.
 */
type RunnableTool = {
  execute(
    id: string,
    params: { command: string },
    signal: undefined,
    onUpdate: undefined,
    ctx: undefined,
  ): Promise<unknown>;
};

/** The text one tool result carries: this repro only ever asks the mounted bash for text. */
function toolText(result: unknown): string {
  const content = (result as { content?: { text?: string }[] }).content ?? [];
  return content.map((part) => part.text ?? "").join("");
}

/** The nearest package.json above a file: which package a resolved path belongs to. */
function packageDirOf(file: string): string {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) return dir;
    if (dirname(dir) === dir) throw new Error(`no package.json above ${file}`);
  }
}

/** One package's `bin` entry: a bare string, or the name-to-path map this package publishes. */
function binOf(manifest: { bin?: string | Record<string, string> }): string {
  return typeof manifest.bin === "string" ? manifest.bin : (manifest.bin?.pi ?? "");
}

/**
 * The probe the child runs. It is a real file, not an inline `-e`, because the bare specifier in it has
 * to resolve from the temp tree the pack was copied into: the archon run workspace, where nothing above
 * the pack has node_modules and the bare name cannot resolve at all. `unreachable` asks the same tree
 * what the ladder does when neither the bare name nor any derived root can load.
 */
const PROBE = `
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadPiSdk, piSdkCandidates, runPackPi } from "./scripts/pi-session.ts";

function manifestName(file) {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) return JSON.parse(readFileSync(manifest, "utf8")).name;
    if (dirname(dir) === dir) return undefined;
  }
}

let bare = "resolved";
try {
  await import("${PI_SDK_PACKAGE}");
} catch {
  bare = "unresolved";
}

if (process.argv[2] === "unreachable") {
  try {
    await loadPiSdk({ env: {}, execPath: "/nonexistent/bin/bun", whichPi: () => null });
    console.log(JSON.stringify({ ok: false, why: "the ladder resolved something" }));
  } catch (e) {
    console.log(JSON.stringify({ ok: true, name: e.name, message: e.message }));
  }
} else {
  const candidates = piSdkCandidates();
  const entry = candidates.find((candidate) => existsSync(candidate));
  const sdk = await loadPiSdk();
  const fromLib = await loadPiSdk({ env: {}, execPath: join(process.cwd(), "bin", "node"), whichPi: () => null });
  // The production start path, in this tree: a model the SDK cannot resolve throws before any turn, so
  // whatever this reports, it proves the runner got past the SDK it could not reach before the fix.
  let runner = "started a turn";
  try {
    await runPackPi({
      cwd: process.cwd(),
      env: (base) => base,
      artifactsDir: join(process.cwd(), "artifacts"),
      sessionKey: "feat/01",
      role: "implement",
      model: "nope/nope",
      thinkingLevel: "high",
      persona: "PERSONA",
      prompt: "go",
    });
  } catch (e) {
    runner = e.name + ": " + e.message;
  }
  console.log(
    JSON.stringify({
      ok: true,
      candidates,
      bare,
      entry,
      entryName: entry ? manifestName(entry) : undefined,
      hasSession: typeof sdk.createAgentSession,
      fromLib: fromLib.marker,
      runner,
    }),
  );
}
`;

/** Run the probe in the temp tree, the way an archon script node runs a pack file. */
function runProbe(
  root: string,
  env: NodeJS.ProcessEnv,
  mode?: string,
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [join(root, "probe.ts"), ...(mode ? [mode] : [])], {
    cwd: root,
    encoding: "utf8",
    env,
    timeout: 120_000,
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

const root = mkTemp("pack-pi-sdk-");

try {
  cpSync(join(PACK, "scripts"), join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "probe.ts"), PROBE);
  mkdirSync(join(root, ".venv", "bin"), { recursive: true });

  // The archon run workspace, reproduced: a copy of the pack with no node_modules anywhere above it.
  // The bare specifier cannot resolve there - that is the live drain failure - so the ladder has to
  // reach the SDK another way: the `pi` CLI's own install tree. The CLI pointed at here is the repo's
  // own install, symlinked the way a global install is (`pi` -> .../node_modules/.../dist/bundle/cli.js),
  // so this case does not depend on where the machine happened to install Pi.
  const sdkDir = packageDirOf(fileURLToPath(import.meta.resolve(PI_SDK_PACKAGE)));
  const sdkManifest = JSON.parse(readFileSync(join(sdkDir, "package.json"), "utf8")) as { bin?: string | Record<string, string> };
  const cli = join(sdkDir, binOf(sdkManifest));
  mkdirSync(join(root, "bin"), { recursive: true });
  symlinkSync(cli, join(root, "bin", "pi"));

  // The other derived root, named rather than assumed: a global node install keeps the package under the
  // executable's own `../lib/node_modules`. A fake tree pins that rule without this machine's luck; the
  // child is asked to load it through an injected lookup, since its own executable has no such install.
  const libSdk = join(root, "lib", "node_modules", "@earendil-works", "pi-coding-agent");
  mkdirSync(libSdk, { recursive: true });
  writeFileSync(join(libSdk, "package.json"), JSON.stringify({ name: PI_SDK_PACKAGE, type: "module", main: "./index.js" }));
  writeFileSync(join(libSdk, "index.js"), 'export const marker = "LIB_NODE_MODULES";\n');

  const probe = runProbe(root, { ...envWithout("PI_SDK_PATH"), PATH: join(root, "bin") });
  expect("the probe exits 0", probe.status === 0, probe);
  const found = JSON.parse(probe.stdout) as {
    ok: boolean;
    candidates: string[];
    bare: string;
    entry?: string;
    entryName?: string;
    hasSession?: string;
    fromLib?: string;
    runner: string;
  };
  expect("the bare specifier really cannot resolve there (the live failure)", found.bare === "unresolved", found);
  expect("the ladder still tries the bare name first", found.candidates[0] === PI_SDK_PACKAGE, found.candidates);
  expect("and reaches the SDK through the pi CLI's install tree", !!found.entry && existsSync(found.entry), found);
  expectEqual("the resolved path is the real package", found.entryName, PI_SDK_PACKAGE);
  expectEqual("and the ladder loads it there", found.hasSession, "function");
  expect("the runner starts there, and fails on the model instead", found.runner.startsWith("RunnerUnavailable: the pi runner could not start: "), found.runner);
  expect("not on the SDK it could not reach", !found.runner.includes("cannot reach the Pi SDK"), found.runner);

  expectEqual(
    "the executable's ../lib/node_modules is a candidate root",
    piSdkCandidates({ env: {}, execPath: join(root, "bin", "node"), whichPi: () => null }),
    [PI_SDK_PACKAGE, join(libSdk, "index.js")],
  );
  expectEqual("and the child loads the package that root names", found.fromLib, "LIB_NODE_MODULES");

  // PI_SDK_PATH is the operator's word, so it is the whole ladder: whatever package directory it names
  // is what loads. The entry is read from the package's own manifest, so a directory is enough.
  const fake = join(root, "fake-sdk");
  mkdirSync(fake, { recursive: true });
  writeFileSync(
    join(fake, "package.json"),
    JSON.stringify({ name: PI_SDK_PACKAGE, version: "0.0.0", type: "module", exports: { ".": { import: "./index.js" } } }),
  );
  writeFileSync(join(fake, "index.js"), 'export const marker = "PI_SDK_PATH";\n');
  expectEqual("PI_SDK_PATH is the whole ladder", piSdkCandidates({ env: { PI_SDK_PATH: fake } }), [join(fake, "index.js")]);
  expectEqual(
    "an entry file works the same way",
    piSdkCandidates({ env: { PI_SDK_PATH: join(fake, "index.js") } }),
    [join(fake, "index.js")],
  );
  const fakeSdk = (await loadPiSdk({ env: { PI_SDK_PATH: fake } })) as unknown as { marker?: string };
  expectEqual("and the ladder loads that package", fakeSdk.marker, "PI_SDK_PATH");

  // Nothing reachable is a runner that never started, and its message names the one fix an operator has.
  let unreachable: unknown;
  try {
    await loadPiSdk({ env: { PI_SDK_PATH: join(root, "not-a-package") } });
  } catch (e) {
    unreachable = e;
  }
  expect("an unreachable SDK is a runner that never started", unreachable instanceof RunnerUnavailable, unreachable);
  const message = unreachable instanceof Error ? unreachable.message : "";
  expect("and its message names PI_SDK_PATH", message.includes("PI_SDK_PATH"), message);
  expect("and the package it could not reach", message.includes(PI_SDK_PACKAGE), message);

  const unreachableChild = runProbe(root, { ...envWithout("PI_SDK_PATH"), PATH: "/nonexistent" }, "unreachable");
  expect("the unreachable probe exits 0", unreachableChild.status === 0, unreachableChild);
  const child = JSON.parse(unreachableChild.stdout) as { ok: boolean; name: string; message: string };
  expectEqual("a tree with no node_modules and no derivable root fails as the same kind", child.name, "RunnerUnavailable");
  expect("and names PI_SDK_PATH there too", child.message.includes("PI_SDK_PATH"), child.message);

  // The spawn chain's last link, closed: build the mounted tool through the pack's own factory and run
  // one bounded command through it. The child's own output is the evidence of the environment it spawned
  // with - the only reading of the hook the SDK keeps inside the definition it builds.
  const tool = piBashTool(await loadPiSdk(), {
    cwd: root,
    env: (base) => sessionEnv(root, base),
  }) as unknown as RunnableTool;
  const [spawnCwd, spawnPath] = toolText(
    await tool.execute("p3", { command: `printf '%s\\n' "$PWD" "$PATH"` }, undefined, undefined, undefined),
  ).split("\n");
  expectEqual("the mounted tool runs in the session's cwd", spawnCwd, root);
  expect(
    "the mounted tool hands bash the seam's environment",
    (spawnPath ?? "").startsWith(`${join(root, ".venv", "bin")}:`),
    spawnPath,
  );
  expect("and the environment underneath survives the hook", (spawnPath ?? "").split(":").length > 1, spawnPath);
  // The link above that one: the session has to mount this factory, not a bare definition no repro can see.
  const sessionSrc = readFileSync(join(PACK, "scripts", "pi-session.ts"), "utf8");
  expect("the session mounts the exported tool factory", sessionSrc.includes("customTools: [piBashTool(pi, opts)]"));

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
