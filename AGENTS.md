# AGENTS.md

## Project

Nuii Auto Bulk is a vanilla Manifest V3 Chrome extension for queue-based prompt automation on browser image generation tools.

## Hard Rules

- Keep the extension loadable as an unpacked folder with no build step.
- Use Manifest V3 only.
- Do not put API keys, tokens, or secrets in extension code, storage, logs, or docs.
- Request the smallest practical `permissions` and `host_permissions`.
- Treat prompt text as private user content. Logs may include truncated prompts only.
- Keep popup message actions and content-script actions backward compatible unless the caller is updated in the same change.
- Prefer testable pure helpers in `src/**` over adding more logic to large top-level files.

## Stack

- Vanilla JavaScript.
- Chrome Extension Manifest V3.
- Node built-in test runner for local unit tests.
- No bundler, transpiler, TypeScript, React, WXT, or Plasmo in the current phase.

## Commands

- Syntax check: `npm run check`
- Unit tests: `npm test`
- If `node` is not on PATH in Codex Desktop, use the bundled runtime at `C:\Users\Darks\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`.

## Done Criteria

- `background.js`, `content.js`, and `popup.js` pass syntax checks.
- Unit tests pass.
- Manual Chrome acceptance checklist is updated when browser-only behavior changes.
- Route diagnostics remain privacy-safe and do not log full prompt text.
