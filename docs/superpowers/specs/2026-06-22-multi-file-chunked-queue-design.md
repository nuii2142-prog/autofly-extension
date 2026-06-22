# Multi-file chunked queue (segmented runs)

**Status:** Approved design — 2026-06-22. Branch: `firefly-network-capture`.

## Problem / Goal

Today a run is one queue → one ZIP. The user wants to load several `.txt`/`.csv`
files at once (≈5–10 files × ~50 prompts) and have the extension process them
**unattended in segments**: finish one file's prompts, download that file's ZIP,
clear, then proceed to the next file — one ZIP per file, back-to-back, for
hours-long batches.

This also sidesteps the 100+ single-ZIP memory wall: each segment finalizes
within the proven-safe ~50-prompt envelope, so **no streaming ZIP is needed**.

## Model

- Each selected file = one **segment**.
- A segment has `{ name (filename stem), runId }` plus its prompts.
- The queue is one flat list; each item carries `segmentIndex`.
- One segment → one ZIP, named `<filename-stem>-<timestamp>.zip`.
- **Backward compatible:** a single file or pasted text = exactly one segment =
  one ZIP (current behaviour unchanged).

## Architecture (Approach A: segmented single queue)

Reuse the existing per-runId capture + finalize machinery:

- Capture stores images in IndexedDB keyed by `runId`; `ensureZipRun(runId)`
  clears IDB when the runId changes.
- `finalizeRunZip` / `finalizeZip(runId)` builds + downloads the ZIP for a runId.

Each segment gets its own runId. Items are submitted with their segment's runId
(background overrides `settings.runId` per item). At a **segment boundary** (the
just-completed item is the last of its segment — the next pending item has a
different `segmentIndex`, or the queue ends), the loop finalizes that segment's
ZIP (downloaded, named after the file). The next segment's first submit calls
`ensureZipRun(newRunId)`, clearing the previous segment's IDB.

Pause/resume/stop and service-worker restart recovery keep working unchanged
because it remains one queue / one appState run.

Rejected alternative — **B. Chained separate runs** (each file a full run,
auto-start the next on completion): less engine change but cross-run state
(remaining files) must survive between runs and SW restarts, which is more
fragile than keeping one queue.

## Run flow (processQueue)

1. Pick next pending item; submit with its segment's runId; capture → IDB(runId).
2. On item done: if it is the last item of its segment → `finalizeRunZip` for this
   segment's runId → download `<name>-<ts>.zip`.
3. Continue; the next segment's first submit clears prior IDB via runId change.
4. On queue end: final segment finalized; status Complete; run summary + total time.

## Resilience — failure-streak pause (chosen behaviour)

- Track consecutive failures; reset to 0 on any success.
- On reaching `FAILURE_STREAK_LIMIT` (default 5): set status Paused, play the alert
  sound, log: *"Paused: 5 prompts failed in a row — Firefly session may have
  expired. Log in and click Resume."*
- Captured images so far stay in IDB; resuming continues the queue; the current
  segment finalizes when its last item completes.
- Isolated failures (< limit) are skipped via `continueOnError` as today.

## Re-run failed

- A **"Re-run failed (N)"** control appears in the popup when the last run has
  failed items.
- It starts a new run containing only the failed items, preserving each item's
  original segment name so re-run ZIPs are grouped/named per original file.

## UI (popup)

- File input gains `multiple`; selecting/dropping several files loads them all.
- File list shows each file + its prompt count (e.g. `cats.txt — 50`).
- The prompt-count line shows the total across files.
- During a run: show current segment progress (`Segment 2/7: dogs.txt`) alongside
  the existing per-prompt progress + run timer.
- "Re-run failed (N)" button (hidden when N = 0).

## Data flow

- popup `collectPromptEntries` → per-file segments `[{ name, prompts: [...] }]`
  (dedup applies per file).
- popup → background `startProcessing({ segments })`.
- background builds the flat queue: items `{ ..., segmentIndex }`; segments array
  `[{ name, runId }]`.
- per-item submit passes `settings.runId = segments[item.segmentIndex].runId`.
- boundary finalize uses that runId; ZIP named `segments[idx].name`.

## Pure logic (`src/background/queue-state.js`) + tests

- `buildSegmentedQueue(segments, now)` → `{ queue, segments }` with ids,
  `segmentIndex`, and a per-segment runId.
- `isSegmentBoundary(queue, completedIndex)` → boolean (next item is a different
  segment, or end of queue).
- `nextFailureStreak(prevStreak, itemSucceeded)` + `shouldPauseForFailures(streak, limit)`.
- `zipNameForSegment(name, timestamp)`.

All pure (DOM-free, time passed in) → unit tested in `tests/`.

## Files touched

- `popup.html` — multi-file input, file list, segment display, re-run button.
- `popup.js` — multi-file ingestion, render segments + re-run, send segments.
- `background.js` — segment-aware queue build, per-segment runId submit, boundary
  finalize, failure-streak pause.
- `src/background/queue-state.js` — pure helpers above (+ tests).
- `content.js` — ensure the per-segment runId reaches submit (minimal; submit
  already accepts `settings.runId`).

## Out of scope / YAGNI

- Streaming ZIP (chunking removes the need).
- Configurable failure-streak threshold (hardcode 5; revisit if needed).
- Parallel segment processing (sequential by design — one Firefly tab).
