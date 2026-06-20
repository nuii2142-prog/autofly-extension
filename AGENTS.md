# AGENTS.md

## Project

Nuii Auto Bulk is a vanilla Manifest V3 Chrome extension for queue-based prompt automation on browser image generation tools.

Key features and their notes live in `docs/superpowers/specs/`. Current major
feature: single-ZIP download of all generated images (`zipDownload`), with a
manual "Download ZIP" popup button and an `autoZipOnComplete` toggle. The
content script intercepts Firefly's download click, fetches each full-res image,
and stashes it in IndexedDB (`nuii-autofly` db) until the run ends. Per-prompt
`zip:` and `res:` diagnostics are written into the exported run log — that
exported JSON is the primary debugging channel for browser-only behaviour the
unit tests cannot cover. Internal identifiers still use the legacy "autofly"
token on purpose (storage key, IndexedDB name, content-ready guard) to avoid
orphaning stored data.

App icons live in `icons/icon-{16,32,48,128}.png` (wired via manifest `icons` +
`action.default_icon`). They are generated from `design/icon-source-chosen.jpeg`
(regenerate with the System.Drawing PowerShell snippet if the source changes);
`design/icon-source-alt.jpeg` is the runner-up source kept for reference.

Completion sound: the popup can upload a custom audio file, stored as a data URL
in `chrome.storage.local` under `nuiiCustomSound`; `offscreen.js` plays it for the
"complete" tone and falls back to the synthesized chime (error tone always uses
the chime). Gated by the existing "Sound when finished" toggle.

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
