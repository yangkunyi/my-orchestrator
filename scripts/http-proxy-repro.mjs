#!/usr/bin/env node
/** Drive shipped spawnDetachedRun: NODE_USE_ENV_PROXY at start, then fetch reaches api.x.ai. */
import { once } from "node:events";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childEnv, spawnDetachedRun } from "../dist/proxy.js";

const proxy = process.argv[2] ?? "http://127.0.0.1:23379";
const env = childEnv({ httpProxy: proxy, target: process.cwd() });
const shape =
  env.NODE_USE_ENV_PROXY === "1" &&
  env.HTTPS_PROXY === proxy &&
  env.HTTP_PROXY === proxy;
if (!shape) {
  console.log(JSON.stringify({ shape: false, spawned: false, reached: false, ok: false }));
  process.exit(1);
}

const fetchCode = `const c=new AbortController(); const t=setTimeout(()=>c.abort(),15000);
try {
  const r=await fetch("https://api.x.ai/v1/models",{signal:c.signal});
  console.log(JSON.stringify({status:r.status,reached:true}));
} catch (e) {
  console.log(JSON.stringify({status:0,reached:false,err:String(e.message)}));
  process.exit(1);
} finally { clearTimeout(t); }`;

const dir = mkdtempSync(join(tmpdir(), "http-proxy-repro-"));
const logFile = join(dir, "stdout.log");
let fd;
let spawned = false;
let reached = false;
try {
  fd = openSync(logFile, "a");
  const child = spawnDetachedRun({
    execPath: process.execPath,
    script: "--input-type=module",
    args: ["-e", fetchCode],
    httpProxy: proxy,
    target: process.cwd(),
    stdoutFd: fd,
  });
  closeSync(fd);
  fd = undefined;
  if (child.pid == null) {
    throw new Error("spawnDetachedRun produced no pid");
  }
  spawned = true;
  const [code] = await Promise.race([
    once(child, "exit"),
    once(child, "error").then(([err]) => Promise.reject(err)),
  ]);
  const out = readFileSync(logFile, "utf8").trim();
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    parsed = { raw: out };
  }
  reached = parsed?.reached === true;
  const ok = shape && spawned && reached && code === 0;
  console.log(JSON.stringify({ shape, spawned: true, reached, ok }));
  if (!ok) process.exitCode = 1;
} catch (err) {
  console.log(
    JSON.stringify({
      shape,
      spawned,
      reached,
      ok: false,
      err: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exitCode = 1;
} finally {
  if (fd !== undefined) {
    try {
      closeSync(fd);
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
}
