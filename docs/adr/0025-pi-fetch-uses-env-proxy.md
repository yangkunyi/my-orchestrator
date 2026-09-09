# Pi fetch uses the Run process HTTP proxy

Pi SDK (`createAgentSession`) talks to the model with Node `fetch`. Node ignores `HTTP_PROXY` / `HTTPS_PROXY` unless the process is started with `NODE_USE_ENV_PROXY=1`. The CLI `pi` binary installs an undici `EnvHttpProxyAgent`; the SDK path does not.

The Orchestrator starts the Run process (detach child, or a one-shot re-exec when draining in the foreground) with `NODE_USE_ENV_PROXY=1`. Optional Target `.scratch/orchestrator.yaml` key `httpProxy` is copied into that env as `HTTP_PROXY` / `HTTPS_PROXY` (clash on this machine: `http://127.0.0.1:23379`).

Rejected: importing Pi's unexported `configureHttpDispatcher`; adding `undici` as a direct dependency; wrapping the `pi` CLI just to get its dispatcher.

Without this, a Ticket can FAILED in ~30s with session `Request timed out.` / `Connection error.` even when `clash` is already exported in the parent shell.
