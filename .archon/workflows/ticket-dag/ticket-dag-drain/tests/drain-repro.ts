#!/usr/bin/env bun
/** Temp-Target repro: drain loop without Pi. Empty ticket branch FAILED-exits 0 so pick can empty. No Archon engine, no repo src/. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { noopAgent, RunnerUnavailable } from "../scripts/agent.ts";
import { rematchLeftovers } from "../scripts/rematch.ts";
import { REVIEW_BASE_REL } from "../scripts/review-artifacts.ts";
import { pickStartable } from "../scripts/pick.ts";
import { conflictTicket } from "../../ticket-dag-execute/scripts/conflict.ts";
import { implementTicket } from "../../ticket-dag-execute/scripts/implement.ts";
import {
  addTicketWorktree,
  commitFile,
  commitTickets,
  envWithout,
  expect,
  expectEqual,
  expectReject,
  gitC,
  mkTemp,
  runScript,
  statusOf,
  ticketOf,
  withTarget,
  writeTicket,
} from "./target.ts";

const implementScript = join(import.meta.dir, "../../ticket-dag-execute/scripts/implement.ts");
const conflictScript = join(import.meta.dir, "../../ticket-dag-execute/scripts/conflict.ts");

function agentOpts(artifacts: string) {
  return { artifactsDir: artifacts, runAgent: noopAgent };
}

async function drainUntilEmpty(
  root: string,
  artifacts: string,
  concurrency: number,
): Promise<{ iterations: number; tokens: string[] }> {
  await rematchLeftovers(root, artifacts);
  const tokens: string[] = [];
  let iterations = 0;
  for (; iterations < 500; iterations++) {
    const picked = await pickStartable(root, { concurrency, artifactsDir: artifacts });
    if (picked.length === 0) break;
    const batch = await Promise.all(
      picked.map(async (t) => {
        const token = await implementTicket(root, t.id, agentOpts(artifacts));
        if (token === "resolve") return conflictTicket(root, t.id, agentOpts(artifacts));
        return token;
      }),
    );
    tokens.push(...batch);
  }
  return { iterations, tokens };
}

try {
  await withTarget(async (root, artifacts) => {
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const token = await implementTicket(root, "feat/01", agentOpts(artifacts));
    expectEqual("empty branch stdout token", token, "failed");
    expectEqual("empty branch Status", statusOf(root, rel), "FAILED");
    const ticket = ticketOf(root, "feat/01");
    expect("Worktree kept", existsSync(join(root, ticket.worktreeRel)), ticket.worktreeRel);
  });

  await withTarget(async (root) => {
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const proc = runScript(implementScript, root, envWithout("INPUTS_TICKET"));
    expect("bare implement without ticket is unsupported", (proc.status ?? 1) !== 0, proc.status);
    expect("error names missing ticket", proc.stderr.includes("INPUTS_TICKET is required"));
  });

  await withTarget(async (root) => {
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const proc = runScript(conflictScript, root, envWithout("INPUTS_TICKET"));
    expect("bare conflict without ticket is unsupported", (proc.status ?? 1) !== 0, proc.status);
    expect("conflict error names missing ticket", proc.stderr.includes("INPUTS_TICKET is required"));
  });

  await withTarget(async (root) => {
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const proc = runScript(implementScript, root, { ...envWithout("ARTIFACTS_DIR"), INPUTS_TICKET: "feat/01" });
    expect("implement requires artifacts dir", (proc.status ?? 1) !== 0, proc.status);
    expect("error names missing artifacts", proc.stderr.includes("ARTIFACTS_DIR is required"));
  });

  await withTarget(async (root, artifacts) => {
    const r01 = writeTicket(root, "feat", "01", "one", "READY", "None");
    const r02 = writeTicket(root, "feat", "02", "two", "READY", "None");
    commitTickets(root);
    const { iterations, tokens } = await drainUntilEmpty(root, artifacts, 1);
    expectEqual("loop finished before cap", iterations < 500, true);
    expect("pick became empty", iterations >= 1, iterations);
    expectEqual("both empty branches failed", [...tokens].sort(), ["failed", "failed"]);
    expectEqual("01 FAILED", statusOf(root, r01), "FAILED");
    expectEqual("02 FAILED", statusOf(root, r02), "FAILED");
    const t1 = ticketOf(root, "feat/01");
    const t2 = ticketOf(root, "feat/02");
    expect("01 Worktree kept", existsSync(join(root, t1.worktreeRel)));
    expect("02 Worktree kept", existsSync(join(root, t2.worktreeRel)));
    const after = await pickStartable(root, { concurrency: 4, artifactsDir: artifacts });
    expectEqual("same drain does not re-pick just-FAILED", after.map((t) => t.id), []);
  });

  await withTarget(async (root, artifacts) => {
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const head = gitC(root, "rev-parse", "HEAD");
    await rematchLeftovers(root, artifacts);
    expectEqual(
      "rematch wrote review-base",
      readFileSync(join(artifacts, REVIEW_BASE_REL), "utf8").trim(),
      head,
    );
  });

  await withTarget(async (root, artifacts) => {
    writeFileSync(join(root, "conflict.txt"), "base\n");
    gitC(root, "add", "conflict.txt");
    gitC(root, "commit", "-m", "base conflict file");
    const rel = writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const ticket = ticketOf(root, "feat/01");
    const wt = addTicketWorktree(root, ticket);
    commitFile(wt, "conflict.txt", "from-agent\n", "agent conflict");
    writeFileSync(join(root, rel), "# 01\n\n**Blocked by:** None\n\nStatus: FAILED\n");
    gitC(root, "add", rel);
    gitC(root, "commit", "-m", "orchestrator: feat/01 Status FAILED");
    writeFileSync(join(root, "conflict.txt"), "from-main\n");
    gitC(root, "add", "conflict.txt");
    gitC(root, "commit", "-m", "main conflict");
    const token = await implementTicket(root, "feat/01", agentOpts(artifacts));
    expectEqual("resume-conflict implement token", token, "resolve");
    expectEqual("status still RUNNING until conflict node", statusOf(root, rel), "RUNNING");
    const conflictToken = await conflictTicket(root, "feat/01", agentOpts(artifacts));
    expectEqual("conflict stdout token", conflictToken, "failed");
    expectEqual("conflict stamps FAILED", statusOf(root, rel), "FAILED");
    expect("Worktree kept after unresolved conflict", existsSync(wt));
  });

  // Where a turn's session lives is the runner's to know, not the role table's: the node reports the
  // path the runner handed back, and it can only report it once the turn has run.
  await withTarget(async (root, artifacts) => {
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const saw: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => {
      saw.push(args.map(String).join(" "));
    };
    try {
      await implementTicket(root, "feat/01", {
        artifactsDir: artifacts,
        runAgent: async () => ({
          sessionFile: join(artifacts, "elsewhere", "session.v9.jsonl"),
          answer: { kind: "none" },
          lastError: undefined,
        }),
      });
    } finally {
      console.error = realError;
    }
    const line = saw.find((l) => l.includes(" session "));
    expectEqual(
      "the node reports the runner's session path",
      line,
      `feat/01 session ${join(artifacts, "elsewhere", "session.v9.jsonl")}`,
    );
  });

  // A turn that never got a session must not be reported as having one: a guessed path that does not
  // exist is worse than no pointer at all, so the node only says where a session is once it is told.
  await withTarget(async (root, artifacts) => {
    writeTicket(root, "feat", "01", "demo", "READY", "None");
    commitTickets(root);
    const saw: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => {
      saw.push(args.map(String).join(" "));
    };
    try {
      await implementTicket(root, "feat/01", {
        artifactsDir: artifacts,
        runAgent: async () => {
          // Not a RunnerUnavailable: an unexpected throw from a runner is that runner's bug. The node
          // still fails this one Ticket rather than the drain - only "cannot start" stops everything.
          throw new Error("the runner blew up in a way the seam does not know");
        },
      });
    } finally {
      console.error = realError;
    }
    expectEqual("a turn with no session reports none", saw.find((l) => l.includes(" session ")), undefined);
    expect(
      "an unexpected throw is still this Ticket's failure",
      saw.some((l) => l.includes("FAILED: the runner blew up in a way the seam does not know")),
      saw.join(" | "),
    );
  });

  // The runner never started: no agent saw this Ticket, so nothing here is a statement about the
  // Ticket's work. The reason goes where every other reason goes, the Status stops being RUNNING, and
  // the error leaves the node - the CLI routes below pin that it exits non-zero, because a non-zero
  // exit is the pack's only way to stop a drain (ADR-0032: a Git-contract FAILED exits 0).
  await withTarget(async (root, artifacts) => {
    const r01 = writeTicket(root, "feat", "01", "one", "READY", "None");
    const r02 = writeTicket(root, "feat", "02", "two", "READY", "None");
    commitTickets(root);
    const saw: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => {
      saw.push(args.map(String).join(" "));
    };
    try {
      await expectReject(
        "a runner that cannot start is not this Ticket's outcome",
        () =>
          implementTicket(root, "feat/01", {
            artifactsDir: artifacts,
            runAgent: async () => {
              throw new RunnerUnavailable("the dsh runner needs DEEPSEEK_BASE_URL + DEEPSEEK_API_KEY");
            },
          }),
        /the dsh runner needs DEEPSEEK_BASE_URL/,
      );
    } finally {
      console.error = realError;
    }
    expectEqual(
      "the attempt is recorded with its reason",
      saw.find((l) => l.includes(" FAILED: ")),
      "feat/01 FAILED: the dsh runner needs DEEPSEEK_BASE_URL + DEEPSEEK_API_KEY",
    );
    expectEqual("the aborted Ticket is FAILED, not left RUNNING", statusOf(root, r01), "FAILED");
    expectEqual("the rest of the backlog is untouched", statusOf(root, r02), "READY");
  });

  // The conflict node answers to the same rule: a runner that could not start is not a conflict
  // outcome either.
  await withTarget(async (root, artifacts) => {
    const rel = writeTicket(root, "feat", "01", "one", "READY", "None");
    commitTickets(root);
    addTicketWorktree(root, ticketOf(root, "feat/01"));
    await expectReject(
      "the conflict node lets the same error out",
      () =>
        conflictTicket(root, "feat/01", {
          artifactsDir: artifacts,
          runAgent: async () => {
            throw new RunnerUnavailable("the pi runner could not start: unknown model nope/nope");
          },
        }),
      /the pi runner could not start/,
    );
    expectEqual("conflict records the attempt too", statusOf(root, rel), "FAILED");
  });

  // The conflict node's own first Main write: the Ticket goes RESOLVING before its turn runs. That is
  // the one edge the conflict body used to stamp for itself; it is markResolving's now, and the turn
  // is where it is observable - the Ticket must already be out of CONFLICT when the agent starts.
  await withTarget(async (root, artifacts) => {
    const rel = writeTicket(root, "feat", "01", "one", "READY", "None");
    commitTickets(root);
    addTicketWorktree(root, ticketOf(root, "feat/01"));
    let during = "";
    await conflictTicket(root, "feat/01", {
      artifactsDir: artifacts,
      runAgent: async () => {
        during = statusOf(root, rel);
        return {
          sessionFile: join(artifacts, "conflict.jsonl"),
          answer: { kind: "none" },
          lastError: undefined,
        };
      },
    });
    expectEqual("the conflict node stamps RESOLVING before its turn", during, "RESOLVING");
  });

  // Each ticket node settles through its own route, and the reason its FAILED carries names that route.
  // A turn can leave a dirty Worktree for the settle of either node, so the two reasons ("worktree
  // dirty after implement" / "worktree dirty after conflict agent") are what tells settleAfterAgent and
  // settleAfterConflict apart: a node given the other's settle would say the other's reason.
  await withTarget(async (root, artifacts) => {
    const rel = writeTicket(root, "feat", "01", "one", "READY", "None");
    commitTickets(root);
    const saw: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => {
      saw.push(args.map(String).join(" "));
    };
    try {
      const token = await implementTicket(root, "feat/01", {
        artifactsDir: artifacts,
        runAgent: async (opts) => {
          // The turn ran and left an uncommitted file: settleAfterAgent's own dirty-tree route.
          writeFileSync(join(opts.cwd, "leftover.txt"), "x\n");
          return {
            sessionFile: join(artifacts, "implement.jsonl"),
            answer: { kind: "none" },
            lastError: undefined,
          };
        },
      });
      expectEqual("a dirty implement turn is this Ticket's outcome", token, "failed");
      expect(
        "and the reason is the implement settle's, not the conflict node's",
        saw.some((l) => l.includes("FAILED: worktree dirty after implement")),
        saw.join(" | "),
      );
      saw.length = 0;
      const conflictToken = await conflictTicket(root, "feat/01", {
        artifactsDir: artifacts,
        runAgent: async () => ({
          sessionFile: join(artifacts, "conflict.jsonl"),
          answer: { kind: "none" },
          lastError: undefined,
        }),
      });
      expectEqual("a dirty conflict turn is this Ticket's outcome", conflictToken, "failed");
      expect(
        "and the reason is the conflict settle's, not the implement node's",
        saw.some((l) => l.includes("FAILED: worktree dirty after conflict agent")),
        saw.join(" | "),
      );
    } finally {
      console.error = realError;
    }
    expectEqual("the Ticket is FAILED", statusOf(root, rel), "FAILED");
  });

  // The other route, so the two can never collapse into one: a turn that ran and failed keeps the git
  // contract's outcome, the node returns instead of throwing, and the turn's own error is the reason.
  await withTarget(async (root, artifacts) => {
    const rel = writeTicket(root, "feat", "01", "one", "READY", "None");
    commitTickets(root);
    const saw: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => {
      saw.push(args.map(String).join(" "));
    };
    let token: string;
    try {
      token = await implementTicket(root, "feat/01", {
        artifactsDir: artifacts,
        runAgent: async () => ({
          sessionFile: join(artifacts, "feat-01.jsonl"),
          answer: { kind: "none" },
          lastError: "Request timed out.",
        }),
      });
    } finally {
      console.error = realError;
    }
    expectEqual("a failed turn is this Ticket's outcome", token, "failed");
    expectEqual("and its Status is FAILED as before", statusOf(root, rel), "FAILED");
    expect(
      "the turn's own error is the recorded reason",
      saw.some((l) => l.includes("FAILED: ") && l.includes("Request timed out.")),
      saw.join(" | "),
    );
  });

  // Through the real node and a real runner that cannot start. dsh with no credentials is the cheapest
  // honest one: it is knowable before any turn, needs no child and no network.
  await withTarget(async (root, artifacts) => {
    const r01 = writeTicket(root, "feat", "01", "one", "READY", "None");
    const r02 = writeTicket(root, "feat", "02", "two", "READY", "None");
    commitTickets(root);
    mkdirSync(join(root, ".scratch"), { recursive: true });
    writeFileSync(join(root, ".scratch", "ticket-dag.yaml"), "runner: dsh\n");
    const proc = runScript(implementScript, root, {
      ...envWithout("DEEPSEEK_BASE_URL", "DEEPSEEK_API_KEY"),
      INPUTS_TICKET: "feat/01",
      ARTIFACTS_DIR: artifacts,
      // A HOME with no ~/.pi/agent/models.json: the packy fallback cannot answer either.
      HOME: mkTemp("pack-nohome-"),
    });
    expect(
      "a dsh node that cannot start exits non-zero",
      (proc.status ?? 0) !== 0,
      `status ${proc.status}: ${proc.stderr}`,
    );
    expect(
      "and says which runner could not start",
      proc.stderr.includes("the dsh runner needs DEEPSEEK_BASE_URL"),
      proc.stderr,
    );
    expectEqual("no Git-contract token was claimed", proc.stdout.trim(), "");
    expectEqual("the Ticket it began is FAILED", statusOf(root, r01), "FAILED");
    expectEqual("the backlog is untouched", statusOf(root, r02), "READY");
  });

  // Not every "cannot start" is a pre-flight check: a `dsh` that cannot spawn is only knowable when the
  // child fails, which is why the adapter asks the runtime whether its handshake ever completed.
  await withTarget(async (root, artifacts) => {
    const r01 = writeTicket(root, "feat", "01", "one", "READY", "None");
    commitTickets(root);
    mkdirSync(join(root, ".scratch"), { recursive: true });
    writeFileSync(join(root, ".scratch", "ticket-dag.yaml"), "runner: dsh\n");
    const proc = runScript(implementScript, root, {
      INPUTS_TICKET: "feat/01",
      ARTIFACTS_DIR: artifacts,
      // Credentials are perfect and the binary is not there: the failure lands after the pre-flight
      // checks, which is exactly the case a pre-flight-only fix would still report as this Ticket's.
      DSH_BIN: join(mkTemp("pack-nodsh-"), "no-such-dsh"),
      DEEPSEEK_BASE_URL: "https://gateway.invalid/v1",
      DEEPSEEK_API_KEY: "test-key",
      DSH_HOME: mkTemp("pack-dsh-home-"),
    });
    expect(
      "a dsh that cannot spawn exits non-zero",
      (proc.status ?? 0) !== 0,
      `status ${proc.status}: ${proc.stderr}`,
    );
    expect(
      "and says the runner could not start",
      proc.stderr.includes("the dsh runner could not start: "),
      proc.stderr,
    );
    expectEqual("the Ticket it began is FAILED", statusOf(root, r01), "FAILED");
  });

  // The same through the pi runner: an unknown model is a start failure, not a Ticket's work.
  await withTarget(async (root, artifacts) => {
    const r01 = writeTicket(root, "feat", "01", "one", "READY", "None");
    const r02 = writeTicket(root, "feat", "02", "two", "READY", "None");
    commitTickets(root);
    mkdirSync(join(root, ".scratch"), { recursive: true });
    writeFileSync(join(root, ".scratch", "ticket-dag.yaml"), "model: nope/nope\n");
    const proc = runScript(implementScript, root, { INPUTS_TICKET: "feat/01", ARTIFACTS_DIR: artifacts });
    expect(
      "a pi node that cannot start exits non-zero",
      (proc.status ?? 0) !== 0,
      `status ${proc.status}: ${proc.stderr}`,
    );
    expect(
      "and names the runner before the reason",
      proc.stderr.includes("the pi runner could not start: "),
      proc.stderr,
    );
    expectEqual("the Ticket it began is FAILED", statusOf(root, r01), "FAILED");
    expectEqual("the backlog is untouched", statusOf(root, r02), "READY");
  });

  // The implement node is where the machine is read: the tdd tree its persona runs under. With a HOME of
  // our own the tree is a stub whose rule can only reach a persona if the node read it and handed it to
  // the role's arguments. In a child process, because os.homedir() keeps the environment this process
  // started with (measured - an in-process change to HOME does not move it).
  const fakeHome = mkTemp("pack-probe-home-");
  const probeRule = "STUB-TREE-RULE-ONLY-THIS-HOME-HAS";
  const probeTree = join(fakeHome, ".pi", "agent", "skills", "tdd");
  mkdirSync(probeTree, { recursive: true });
  writeFileSync(join(probeTree, "SKILL.md"), `---\nname: tdd\ndescription: stub\n---\n\n${probeRule}\n`);
  const probe = join(fakeHome, "implement-skill-probe.ts");
  writeFileSync(
    probe,
    [
      `import { join } from "node:path";`,
      `import { implementTicket } from ${JSON.stringify(join(import.meta.dir, "../../ticket-dag-execute/scripts/implement.ts"))};`,
      `import { commitTickets, initTarget, mkTemp, writeTicket } from ${JSON.stringify(join(import.meta.dir, "target.ts"))};`,
      `const root = initTarget();`,
      `writeTicket(root, "feat", "01", "demo", "READY", "None");`,
      `commitTickets(root);`,
      `let persona = "";`,
      `await implementTicket(root, "feat/01", {`,
      `  artifactsDir: mkTemp("pack-probe-artifacts-"),`,
      `  config: { model: undefined, thinkingLevel: "high", concurrency: 4, runner: "dsh" },`,
      `  runAgent: async (opts: { persona: string }) => {`,
      `    persona = opts.persona;`,
      `    return { sessionFile: "/nonexistent", answer: { kind: "text", text: "stub" }, lastError: undefined };`,
      `  },`,
      `});`,
      `console.log(JSON.stringify({`,
      `  hasRule: persona.includes(${JSON.stringify(probeRule)}),`,
      `  namesTree: persona.includes(${JSON.stringify(probeTree)}),`,
      `}));`,
    ].join("\n"),
  );
  const probeProc = runScript(probe, fakeHome, { HOME: fakeHome });
  expect("the skill probe ran the implement node", probeProc.status === 0, probeProc.stderr.slice(0, 300));
  const probeSeen = JSON.parse(probeProc.stdout.trim()) as { hasRule: boolean; namesTree: boolean };
  expect(
    "the implement node reads the tdd tree and hands it to the role's persona",
    probeSeen.hasRule && probeSeen.namesTree,
    probeProc.stdout.trim(),
  );

  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
}
