# Pack config is ticket-dag.yaml plus a path input

The Archon pack reads Target `.scratch/ticket-dag.yaml` for `model`, `thinkingLevel`, and `concurrency`. It does not read `.scratch/orchestrator.yaml` (ADR-0015 is the CLI).

Archon `inputs.config` defaults to `.scratch/ticket-dag.yaml`. `archon workflow run ticket-dag-drain --input config=<path>` selects another file (relative to Target Main, or absolute). Missing file: Pi's default model, `thinkingLevel: high`, `concurrency: 4`. Invalid `thinkingLevel`, or `concurrency` that is not an integer ≥ 1, fails the drain. Extra keys are ignored. No `httpProxy` key.

Rejected: reusing `orchestrator.yaml`; requiring `--input` on every run; passing YAML body as the input; Archon assistant model settings.
