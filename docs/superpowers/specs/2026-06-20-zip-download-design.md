# Single-ZIP download of all generated images

**Date:** 2026-06-20
**Status:** Approved, in implementation

## Goal

Add an option so that, across a whole run/queue, every generated full-resolution
image is collected and delivered as **one ZIP file** instead of many separate
downloads. The existing per-file Auto-download stays unchanged; ZIP is a new,
off-by-default option.

## Decisions (user-confirmed)

- **Scope:** one ZIP for the entire run (all prompts combined).
- **ZIP-only:** when ZIP mode is on, suppress Firefly's per-image downloads —
  deliver only the single ZIP, no individual files in the Downloads folder.
- **Partial runs:** if the run is stopped early, still build a ZIP from whatever
  was captured so far.
- **Backward compatible:** default off → behaviour identical to today.

## Why this is non-trivial

1. Full-resolution images are only reachable through Firefly's own download
   control; the page `<img>` is a low-res thumbnail (see `content.js`
   `clickDownloadButtons`).
2. The Firefly tab **auto-refreshes during long runs** (commit `48989d0`), so
   the content script's in-page memory cannot be the accumulator.
3. MV3 message passing does not transfer `Blob`/`ArrayBuffer` cleanly, so binary
   data should not be shipped across the content↔background boundary.

## Architecture

### Capture (content script, per prompt — only when ZIP mode is on)

- Before clicking Firefly's download button, install a **capture-phase click
  hook** on `document` (idempotent). When Firefly programmatically clicks its
  download anchor, the hook:
  - reads the anchor `href` + `download` filename,
  - `preventDefault()`s so the browser does not save the file to disk,
  - `fetch()`es the `href` (same firefly origin / session, or a page `blob:`
    URL — both fetchable from the content script) into a `Blob`,
  - writes the `Blob` into **IndexedDB on the firefly origin**, keyed by run.
- The existing `clickDownloadButtons` flow is reused unchanged to *initiate* the
  download; the hook only diverts the result.
- **Verification item (live page):** confirm Firefly uses an `<a download>`
  click and that `preventDefault` cancels it. Documented fallback if not:
  MAIN-world script injection patching `HTMLAnchorElement.prototype.click`.

### Persist (IndexedDB on firefly.adobe.com)

- Database `nuii-autofly`, object store `zip-images`.
- Each record: `{ runId, seq, name, type, blob }`. `Blob`s are stored natively
  (no base64 bloat) and survive the tab auto-refresh because IndexedDB is
  per-origin, not per-page.
- The content script tracks the current `runId` (passed in each prompt's
  `settings.runId`). When it sees a **new** `runId`, it clears the whole store
  first — this purges leftovers from any prior run that failed to finalize and
  prevents unbounded growth.

### Finalize (background signals → content script builds)

- The background service worker knows when the queue ends. On a **terminal
  state** (Complete / Stopped / Error), if the run used ZIP mode, it:
  - ensures the content script is ready (`ensureContentReady`),
  - sends `FINALIZE_ZIP { runId }`.
- The content script reads all records for `runId`, builds a single ZIP, triggers
  one download via an `<a download>` click, clears the store, and returns
  `{ count, filename }`.
- Finalize is **idempotent** (guarded by `appState.zipFinalized`) so it runs at
  most once per run. It is invoked from the `processQueue` terminal path and also
  from `stopProcessing` (to cover stop-after-pause, when no queue loop is
  running). **Pause does not finalize.**
- No new permission: a content-script `<a download>` click triggers a normal
  browser download without the `downloads` permission.

## Components / files

### New (pure, unit-tested)

- `src/shared/zip-writer.js`
  - `crc32(bytes: Uint8Array): number` (unsigned 32-bit)
  - `buildZip(entries: {name, data: Uint8Array}[], options?): Uint8Array` —
    STORE mode (method 0): local file headers + data, central directory,
    end-of-central-directory. UTF-8 filename flag set. Deterministic fixed DOS
    date by default for testability.
- `src/content/zip-capture.js`
  - `sanitizeEntryName(name, fallback): string`
  - `dedupeEntryNames(names: string[]): string[]` — disambiguate collisions as
    `name (2).ext`, `name (3).ext`, deterministic and stable.
  - `extensionFromMime(mime): string` — png/jpeg/webp → `.png`/`.jpg`/`.webp`,
    default `.png`.

### Modified

- `src/shared/settings.js` — add `zipDownload: false` to defaults + sanitize.
- `popup.html` — add a switch row "Combine into a single ZIP" (id `zip-download`)
  under Auto-download.
- `popup.js` — bind `zip-download`, load/save it in the draft + `readSettings`.
- `content.js` — install/divert download hook, IndexedDB read/write/clear,
  handle `FINALIZE_ZIP`, build+trigger the ZIP download. Extract pure logic into
  `zip-capture.js` / `zip-writer.js`; keep DOM/IndexedDB glue thin.
- `manifest.json` — add the two new content-script files to the firefly
  `content_scripts` list.
- `background.js` — add `zipFinalized` to state; `finalizeRunZip()` helper; call
  it on terminal states in `processQueue` and from `stopProcessing`; add the new
  files to the `ensureContentReady` re-inject list. **Also add the currently
  missing `src/content/resolution-control.js`** to that re-inject list so the new
  files do not repeat the existing omission.

## Settings semantics

- `zipMode = zipDownload` (independent of `autoDownload`). Revised 2026-06-20
  after testing showed users enable ZIP without Auto-download; coupling them
  meant nothing was captured.
- `zipDownload` true → capture + suppress per-file downloads + finalize at run end.
- `autoDownload` true, `zipDownload` false → current per-file behaviour.
- both false → no downloads.
- Capture runs whenever `autoDownload || zipDownload`.

## Manual "Download all as ZIP" button

- A popup button (disabled while a run is active) sends `DOWNLOAD_ALL_ZIP` to the
  background, which calls `finalizeRunZip({ manual: true })` — bypassing the
  once-per-run guard and the zip-mode check so the user can rebuild on demand.
- Captured images are therefore **kept** in IndexedDB after finalize (cleared
  only when the next run starts under a new `runId`), so the button can rebuild
  the archive repeatedly.
- The background resolves the target via `findFireflyTabId()` (this run's tab, or
  any open Firefly tab) so the button still works after the run ends.

## ZIP naming

- Archive: `nuii-auto-bulk-<YYYYMMDD-HHMMSS>.zip`.
- Entries: the anchor `download` filename when present, else
  `image-001.<ext>`…; collisions disambiguated by `dedupeEntryNames`.

## Edge cases

- No images captured at finalize → skip the download, log "no images to zip".
- Tab not ready at finalize → `ensureContentReady`; if still unavailable, log a
  warning (records remain in IndexedDB for a later manual recovery).
- Very large runs → STORE output ≈ sum of inputs; held in memory briefly. Known
  limitation, acceptable for current scale.
- Pause/resume → records persist under the same `runId`; finalize only on
  terminal states.

## Testing

- `tests/shared-zip-writer.test.js` — CRC32 known vectors
  (`""`→0, `"123456789"`→`0xCBF43926`, fox pangram→`0x414FA339`); single- and
  two-entry archive structure (signatures, central-dir count, offsets, stored
  name/size/crc).
- `tests/content-zip-capture.test.js` — sanitize, dedupe, mime→ext.
- `tests/shared-settings.test.js` — `zipDownload` default + sanitize coercion.
- DOM/IndexedDB glue in `content.js` and the background finalize wiring are
  covered by the manual Chrome acceptance checklist (consistent with the
  project's existing pattern of testing extracted pure helpers only).
- `npm run check` (syntax) and `npm test` (unit) must pass.

## Implementation status (2026-06-20)

**Working (confirmed against live Firefly):**
- ZIP capture + single-archive download. Logs show `intercepts=N captured=N
  failed=0` and `Saved ZIP: ...`. Firefly's download control is an
  `SP-ACTION-BUTTON` labelled "Download"; the capture-phase click hook + same-
  origin/blob fetch works without extra permissions.
- Decoupled from Auto-download; manual "Download ZIP" button; `autoZipOnComplete`
  toggle (default on → auto-download at run end; off → sound only, user clicks
  the button).
- Per-prompt diagnostics in the exported run log: `zip: scanned=.. downloadish=..
  picked=.. clicked=.. intercepts=.. captured=.. failed=..` and `res: ...`.

**Resolution (2K) — root cause found, rewritten, needs live re-confirmation:**
- The `res:` diagnostic proved the real cause: the old selector
  `[data-testid^="firefly-menu-item-"]` matched the **model picker**
  (`firefly-menu-item-ADOBE:FIREFLY:COLLIGO:IMAGE5`, …) and the **action menu**
  (`firefly-menu-item-EDITIMAGE`, …) — never the resolution picker. So "2K" was
  never found and it stayed 1K (the earlier testid-normalize fix was treating the
  wrong menu).
- Rewritten (`applyResolution` in content.js): the control is now located by its
  **value text** — only the resolution picker renders a bare `1K`/`2K` token —
  preferring an element near a "Resolution" label. It opens that picker, clicks
  the option whose text resolves to the target, and verifies the displayed value
  flipped. Runs per prompt (after the start-of-run refresh, before each Generate)
  and logs `res: set 2K [...]` / `res: NOT-confirmed ... [candidates]`.
- Confirm on the next Image 5 run via `res: set 2K`. If still failing, the
  `[candidates]` list in the diagnostic shows the real DOM to refine against.
- STILL UNVERIFIED as of the 2026-06-20T04:02 log: that run was the **older
  build** (its `res:` line was the old testid format `[EDITIMAGE,...]`, not the
  new `TAG:text@res` format), so the value-text rewrite was not exercised — the
  user had not reloaded the extension. The images may have come out 2K anyway
  because Firefly appears to remember a manually-set 2K across reloads; our code
  should still control it. Action: reload, run Image 5, check `res: set 2K`.

**Resolved / not-a-bug:**
- Firefly Image 5 generating 1 image per prompt is normal (user confirmed) — no
  change needed; the per-prompt capture of 1 image is correct.

## Out of scope (YAGNI)

- DEFLATE compression (STORE is sufficient for already-compressed images).
- Third-party ZIP libraries / any build step.
- `chrome.downloads` API (anchor-download needs no extra permission).
- Per-prompt ZIPs (run-level only, per the user's decision).
