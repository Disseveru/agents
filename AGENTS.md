# AGENTS.md

## Project overview

Cloudflare Agents SDK — a framework for building stateful AI agents on Cloudflare Workers. This is a monorepo containing the core SDK packages, examples, guides, sites, and documentation.

## Repository structure

```
packages/          # Published npm packages (need changesets for changes)
  agents/          # Core SDK (see packages/agents/AGENTS.md)
  ai-chat/         # @cloudflare/ai-chat — higher-level AI chat agent
  hono-agents/     # Hono framework integration
  codemode/        # @cloudflare/codemode — experimental code generation

examples/          # Self-contained demo apps (see examples/AGENTS.md)
  playground/      # Main showcase app — all SDK features in one UI (uses Kumo design system)
  mcp/             # MCP server example
  mcp-client/      # MCP client example
  ...              # ~20 examples total

experimental/      # Work-in-progress experiments (not published, no stability guarantees)

site/              # Deployed websites
  agents/          # agents.cloudflare.com (Astro)
  ai-playground/   # Workers AI playground (React + Vite)

guides/            # In-depth pattern tutorials with narrative READMEs (see guides/AGENTS.md)
  anthropic-patterns/
  human-in-the-loop/

openai-sdk/        # Examples using @openai/agents SDK
  basic/ chess-app/ handoffs/ human-in-the-loop/ ...

docs/              # Markdown docs for developers.cloudflare.com (see docs/AGENTS.md)
design/            # Architecture and design decision records (see design/AGENTS.md)
scripts/           # Repo-wide tooling (typecheck, export checks, update checks)
```

## Nested AGENTS.md files

Some directories have their own AGENTS.md with deeper guidance:

| File                        | Scope                                                                     |
| --------------------------- | ------------------------------------------------------------------------- |
| `packages/agents/AGENTS.md` | Core SDK internals — exports, source layout, build, testing, architecture |
| `examples/AGENTS.md`        | Example conventions — required structure, consistency rules, known issues |
| `guides/AGENTS.md`          | Guide conventions — how guides differ from examples, README expectations  |
| `docs/AGENTS.md`            | Writing user-facing docs — Diátaxis framework, upstream sync, style       |
| `design/AGENTS.md`          | Design records and RFCs — format, workflow, relationship to docs          |

## Setup

```bash
pnpm install       # installs all workspaces
```

Node 24+ required. Uses pnpm workspaces with [Nx](https://nx.dev) for task orchestration, caching, and affected detection.

## Commands

Run from the repo root:

| Command                            | What it does                                                       |
| ---------------------------------- | ------------------------------------------------------------------ |
| `pnpm run build`                   | Builds all packages via Nx (cached, dependency-ordered)            |
| `pnpm run check`                   | Full CI check: sherif + export checks + oxfmt + oxlint + typecheck |
| `pnpm run test`                    | Runs all tests via Nx (cached)                                     |
| `pnpm run test:react`              | Runs Playwright-based React hook tests for agents                  |
| `pnpm run typecheck`               | TypeScript type checking across the repo (custom script)           |
| `pnpm run format`                  | Oxfmt format all files                                             |
| `pnpm run check:exports`           | Verifies package.json exports match actual build output            |
| `pnpm exec nx affected -t build`   | Build only packages affected by current changes                    |
| `pnpm exec nx affected -t test`    | Test only packages affected by current changes                     |
| `pnpm exec nx run <project>:build` | Build a single project (and its dependencies)                      |

Run an example locally:

```bash
cd examples/playground   # or any example
pnpm dev                 # starts Vite dev server + Workers runtime via @cloudflare/vite-plugin
```

Example apps will normally hot reload when the dev server is running. When the dev server is running, make sure to rebuild changed packages (`pnpm run build`) to see changes reflected in the running app.

## Code standards

### TypeScript

- Strict mode enabled (`agents/tsconfig`)
- Target: ES2021, module: ES2022, moduleResolution: bundler
- `verbatimModuleSyntax: true` — use explicit `import type` for type-only imports
- JSX: `react-jsx`

### Linting — Oxlint

Config in `.oxlintrc.json`. Plugins: `react`, `jsx-a11y`, `typescript`, `react-hooks`. Key rules:

- `no-explicit-any: "error"` — never use `any`, use `unknown` and narrow
- `no-unused-vars: "error"` — with `varsIgnorePattern: "^_"` and `argsIgnorePattern: "^_"`
- `correctness` category set to `"error"` — catches common mistakes
- `jsx-a11y` rules enabled — accessibility violations are errors
- `react-hooks/exhaustive-deps: "warn"` — warns on missing hook dependencies

Oxlint does **not** handle formatting — Oxfmt does.

### Formatting — Oxfmt

- Run `pnpm run format` to format all files
- Config in `.oxfmtrc.json` (`trailingComma: "none"`, `printWidth: 80`)

### Workers conventions

- Always TypeScript, always ES modules
- `wrangler.jsonc` (not `.toml`) for configuration
- All wrangler configs use `compatibility_date: "2026-06-11"` and `compatibility_flags: ["nodejs_compat"]`
- Never hardcode secrets — use `wrangler secret put` or `.env`
- No native/FFI dependencies (must run in Workers runtime)

## Testing

Tests use **vitest** with `@cloudflare/vitest-pool-workers` for running inside the Workers runtime.

```bash
pnpm run test             # agents + ai-chat unit/integration tests
pnpm run test:react       # Playwright-based React hook tests (agents package)
```

Test locations:

- `packages/agents/src/tests/` — core SDK tests
- `packages/agents/src/react-tests/` — React hook tests (Playwright + vitest-browser-react)
- `packages/ai-chat/src/tests/` — AI chat tests
- `packages/agents/src/tests-d/` — type-level tests (`.test-d.ts`)

Each test directory has its own `vitest.config.ts` and (for Workers tests) a `wrangler.jsonc`.

For a repo-wide rollup of **what proves feature X works, at which layer, and which CI run guards it** — plus the tracked skip/quarantine debt — see [`design/test-coverage-matrix.md`](design/test-coverage-matrix.md).

## Contributing

### Changesets

Changes to `packages/` that affect the public API or fix bugs need a changeset:

```bash
pnpm exec changeset       # interactive prompt — pick packages, semver bump, description
```

This creates a markdown file in `.changeset/` that gets consumed during release.

Examples, guides, and sites don't need changesets.

### Pull request process

CI runs on every PR (`pnpm install --frozen-lockfile && pnpm run build && pnpm run check && pnpm exec nx affected -t test`); the workflow is in `.github/workflows/pullrequest.yml`. On push to `main` the Release workflow (`.github/workflows/release.yml`) runs the same steps but uses `nx run-many -t test` as a safety net against under-reported affected projects, then publishes via changesets. All checks must pass.

### Generated files

- `env.d.ts` files are generated by `wrangler types` — regenerate with `pnpm exec wrangler types` inside the relevant example/package, don't hand-edit
- `pnpm-lock.yaml` — regenerated by `pnpm install`, don't hand-edit

## Learned Workspace Facts

- `packages/shell/` is published as `@cloudflare/shell` — an experimental sandboxed JS execution and filesystem runtime for agents, built on the same dynamic Worker loader machinery as `@cloudflare/codemode`.
- To run code against a `Workspace`: import `stateTools` from `@cloudflare/shell/workers` and `DynamicWorkerExecutor`/`resolveProvider` from `@cloudflare/codemode`; use `executor.execute(code, [resolveProvider(stateTools(workspace))])`.

## Learned User Preferences

- Keep `Workspace` as a pure durable filesystem — do not embed execution or session logic inside it. Execution is a caller concern wired via `@cloudflare/codemode` + `stateTools`.
- When a package boundary feels wrong (e.g., a helper package depending on a larger package just for an adapter), prefer moving the adapter out rather than carrying the dependency.

## Boundaries

**Always:**

- Run `pnpm run check` before considering work done
- Use `import type` for type-only imports (enforced by `verbatimModuleSyntax`)
- Keep examples simple and self-contained — they're user-facing learning material
- Use Cloudflare Workers APIs (KV, D1, R2, Durable Objects, etc.) over third-party equivalents
- Use Workers AI for LLM calls in examples — not third-party APIs like OpenAI or Anthropic

**Ask first:**

- Adding new dependencies to `packages/` (these ship to users)
- Changing `wrangler.jsonc` compatibility dates across the repo
- Modifying CI workflows

**Never:**

- Hardcode secrets or API keys
- Add native/FFI/C-binding dependencies
- Use `any` — Oxlint will reject it
- Use CommonJS or Service Worker format — ES modules only
- Modify `node_modules/` or `dist/` directories
- Force push to main

## Cursor Cloud specific instructions

Notes for cloud agents working in this monorepo. The VM snapshot already has Node 24, `pnpm` (via corepack), and Playwright Chromium installed; the startup update script only runs `pnpm install`.

- **Node version:** The repo requires Node 24+, but the base VM's default `node` on `PATH` (`/exec-daemon/node`) is Node 22. Node 24 is installed via `nvm` and `~/.bashrc` prepends it, so interactive shells get Node 24 automatically (`node -v` → v24). `pnpm` is provided by corepack on that Node. If a shell somehow lands on Node 22, run `nvm use 24`.
- **Full test suite needs a browser.** `pnpm run test` runs browser/React tests (via `@vitest/browser-playwright`) inside the `agents`, `@cloudflare/ai-chat`, `@cloudflare/voice`, and `@cloudflare/codemode` projects. Without Playwright's Chromium they fail with `browserType.launch: Executable doesn't exist`. Install it with `pnpm run prepare:playwright` (idempotent). `pnpm run test:react` also depends on it.
- **Running example apps locally:** `cd examples/<name> && pnpm start` (Vite dev on port 5173). Many examples (e.g. `playground`, `ai-chat`, `assistant`, `agents-as-tools`) set `"remote": true` on the `ai` binding, so `vite dev` tries to open a **remote Cloudflare proxy session and fails without `CLOUDFLARE_API_TOKEN`** ("Could not start remote dev session. No credentials found"). For a fully-offline run, use an example with no remote binding — e.g. `examples/dynamic-workers` (Worker Loader demo, zero secrets), `examples/workflows`, or `examples/push-notifications`. Note some LLM examples (e.g. `tictactoe`) start locally but need their own API key at runtime.
- **Test output noise:** Passing test runs print `uncaught exception ...`, `Simulated ... error`, and "Durable Object reset" lines by design (recovery/error-path fixtures), and Nx may label the workers-runtime test tasks "flaky". Judge pass/fail by the `Test Files ... passed` / `NX Successfully ran target test` summary, not by these logs.
