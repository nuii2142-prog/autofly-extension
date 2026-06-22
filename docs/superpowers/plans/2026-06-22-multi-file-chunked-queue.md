# Multi-file Chunked Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the runner load several prompt files at once and process them as sequential segments — one ZIP per file — with a failure-streak pause for unattended hours-long runs.

**Architecture:** One flat queue whose items carry `segmentIndex`; each segment has its own `runId`. The existing per-runId capture + `finalizeRunZip` finalize one ZIP per segment at each segment boundary. Pause/resume/restart-recovery are unchanged because it stays one queue. Pure logic lives in `src/background/queue-state.js` (DOM-free, unit tested); background wires it; popup gains multi-file UI.

**Tech Stack:** Vanilla JS (MV3 extension), `node --test` (node:test + assert/strict), no build step.

---

## File Structure

- `src/background/queue-state.js` — add pure helpers: `buildSegmentedQueue`, `segmentComplete`, `nextFailureStreak`, `shouldPauseForFailures`, `zipNameForSegment`, `failedItemsToSegments`.
- `tests/background-queue-state.test.js` — add tests for the helpers above.
- `background.js` — `startProcessing` builds a segmented queue; `processQueue` submits each item with its segment runId, finalizes per-segment at boundaries, and pauses on a failure streak; add a `RERUN_FAILED` message handler.
- `popup.js` — collect per-file segments, send `{ segments }`, render the file list + segment progress + "Re-run failed" button.
- `popup.html` — `multiple` on the file input; file-list, segment-progress, and re-run-failed elements.
- `content.js` — confirm each submit uses `settings.runId` (already does); no logic change expected.

---

## Task 1: Pure segment + failure-streak helpers (TDD)

**Files:**
- Modify: `src/background/queue-state.js`
- Test: `tests/background-queue-state.test.js`

- [ ] **Step 1 — Failing tests.** Add to `tests/background-queue-state.test.js`:

```js
const { buildSegmentedQueue, segmentComplete, nextFailureStreak, shouldPauseForFailures, zipNameForSegment, failedItemsToSegments } = require("../src/background/queue-state.js");

test("buildSegmentedQueue tags items with segmentIndex and one runId per segment", () => {
  const { queue, segments } = buildSegmentedQueue([
    { name: "cats", prompts: ["a", "b"] },
    { name: "dogs", prompts: [{ prompt: "c", sourcePrompt: "c-src" }] }
  ], 1000);
  assert.equal(queue.length, 3);
  assert.equal(queue[0].segmentIndex, 0);
  assert.equal(queue[2].segmentIndex, 1);
  assert.equal(queue[2].sourcePrompt, "c-src");
  assert.equal(segments.length, 2);
  assert.notEqual(segments[0].runId, segments[1].runId);
  assert.equal(segments[0].name, "cats");
  assert.ok(queue.every((i) => i.status === "pending" && i.attempts === 0));
});

test("buildSegmentedQueue drops empty prompts but keeps segment indexing", () => {
  const { queue } = buildSegmentedQueue([{ name: "a", prompts: ["x", "  ", ""] }], 1);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].prompt, "x");
});

test("segmentComplete is true only when no item in the segment is pending or running", () => {
  const queue = [
    { segmentIndex: 0, status: "done" },
    { segmentIndex: 0, status: "failed" },
    { segmentIndex: 1, status: "pending" }
  ];
  assert.equal(segmentComplete(queue, 0), true);
  assert.equal(segmentComplete(queue, 1), false);
});

test("nextFailureStreak resets on done, increments on failed, holds on retry", () => {
  assert.equal(nextFailureStreak(3, "done"), 0);
  assert.equal(nextFailureStreak(3, "failed"), 4);
  assert.equal(nextFailureStreak(3, "retry"), 3);
});

test("shouldPauseForFailures triggers at or above the limit", () => {
  assert.equal(shouldPauseForFailures(4, 5), false);
  assert.equal(shouldPauseForFailures(5, 5), true);
});

test("zipNameForSegment sanitizes the file name and appends the timestamp", () => {
  assert.equal(zipNameForSegment("cats/run:1", "20260622-101010"), "cats_run_1-20260622-101010.zip");
  assert.equal(zipNameForSegment("", "T"), "segment-T.zip");
});

test("failedItemsToSegments groups failed items by their segment name, order preserved", () => {
  const segs = failedItemsToSegments(
    [
      { status: "failed", segmentIndex: 0, sourcePrompt: "a" },
      { status: "done", segmentIndex: 0, sourcePrompt: "b" },
      { status: "failed", segmentIndex: 1, sourcePrompt: "c" }
    ],
    [{ name: "cats" }, { name: "dogs" }]
  );
  assert.deepEqual(segs, [
    { name: "cats", prompts: [{ prompt: "a", sourcePrompt: "a" }] },
    { name: "dogs", prompts: [{ prompt: "c", sourcePrompt: "c" }] }
  ]);
});
```

- [ ] **Step 2 — Run, expect FAIL.** `npm test` → fails with helpers undefined.

- [ ] **Step 3 — Implement helpers** in `src/background/queue-state.js` (add to `api`). Normalize a prompt entry as `string | {prompt, sourcePrompt}` → `{prompt, sourcePrompt}`. runId per segment = `${now}-s${index}`; item id = `${now}-${runningIndex}`. `zipNameForSegment` reuses the same illegal-char stripping style as `ZipCapture.sanitizeEntryName` (replace `[^a-zA-Z0-9_-]` runs with `_`, fallback `segment`).

- [ ] **Step 4 — Run, expect PASS.** `npm test` (all prior tests still green).

- [ ] **Step 5 — Commit.** `git add -A && git commit` (message: `feat: segment + failure-streak queue helpers`).

---

## Task 2: Background — segmented queue, per-segment finalize, streak pause

**Files:**
- Modify: `background.js` — `startProcessing` (~137), `processQueue` (~233), message router (RERUN_FAILED), constant `FAILURE_STREAK_LIMIT = 5`.

- [ ] **Step 1 — startProcessing accepts segments.** When `request.segments` is present, `const { queue, segments } = QueueState.buildSegmentedQueue(request.segments, Date.now())`; set `appState.queue = queue`, `appState.segments = segments`, `appState.failureStreak = 0`, `appState.finalizedSegments = []`. Fallback: when only `prompts`/`items` given, wrap as a single segment `[{ name: "prompts", prompts: items }]` so existing callers keep working.

- [ ] **Step 2 — Per-segment runId on submit.** In `runPrompt`/the submit settings, set the runId passed to the content script to `appState.segments[item.segmentIndex].runId` (instead of the single `appState.runId`). Capture then lands in that segment's IDB run.

- [ ] **Step 3 — Boundary finalize.** In `processQueue`, after `applyPromptResultToItem` resolves an item to done/failed: if `QueueState.segmentComplete(appState.queue, item.segmentIndex)` and `item.segmentIndex` not in `appState.finalizedSegments` → push it, then `await finalizeRunZip({ segment: appState.segments[item.segmentIndex] })`. Extend `finalizeRunZip`/`FINALIZE_ZIP` to take an explicit `{ runId, zipName }` from the segment (name via `QueueState.zipNameForSegment(segment.name, zipTimestamp())`), so it builds that segment's ZIP rather than the whole-run one. The next segment's first submit clears its IDB via `ensureZipRun(newRunId)`.

- [ ] **Step 4 — Failure-streak pause.** After each transition: `appState.failureStreak = QueueState.nextFailureStreak(appState.failureStreak, transition.action)`. If `QueueState.shouldPauseForFailures(appState.failureStreak, FAILURE_STREAK_LIMIT)` → `addLog("Paused: " + FAILURE_STREAK_LIMIT + " prompts failed in a row — Firefly session may have expired. Log in and click Resume.")`, `await playCompletionSound("alert")` (reuse the completion sound), set status `Paused`, `stopWorkerKeepAlive()`, `saveAndBroadcast()`, break the loop. Resume continues normally; reset streak to 0 on resume.

- [ ] **Step 5 — RERUN_FAILED handler.** Add a message action that builds `QueueState.failedItemsToSegments(appState.queue, appState.segments)` and calls `startProcessing({ segments })`.

- [ ] **Step 6 — Verify + commit.** `npm run check` passes; `git commit` (`feat: segmented background runs with streak pause`).

---

## Task 3: Popup — collect & send per-file segments

**Files:** Modify `popup.js` (`collectPromptEntries` ~344, `handleFile` ~224, `handleStartOrResume` ~289), `popup.html` (file input).

- [ ] **Step 1 — Multi-file input.** `popup.html`: add `multiple` to `#file-input`; store uploaded files as `uploadedFiles = [{ name, text }]` instead of a single `uploadedText`.
- [ ] **Step 2 — collectSegments().** New popup helper: paste mode → one segment `{ name: "prompts", prompts: parsePromptEntries(text, settings) }`; file mode → one segment per file `{ name: fileStem, prompts: parsePromptEntries(file.text, settings) }` (dedup per file). Empty segments dropped.
- [ ] **Step 3 — Send segments.** `handleStartOrResume` sends `{ segments: collectSegments(), settings, target... }` (keep `prompts` only for the paste fallback). `updatePromptCount` sums prompts across segments.
- [ ] **Step 4 — Verify + commit.** `npm run check`; manual: load 2 files, confirm count = sum. `git commit` (`feat: popup multi-file segment ingestion`).

---

## Task 4: Popup — file list, segment progress, re-run-failed UI

**Files:** Modify `popup.html`, `popup.js` (`renderState` ~378).

- [ ] **Step 1 — File list.** Under the drop zone, render loaded files + counts (`cats.txt — 50`).
- [ ] **Step 2 — Segment progress.** In `renderState`, when `state.segments` and a current item exist, show `Segment {i+1}/{n}: {name}` near `#current-prompt`.
- [ ] **Step 3 — Re-run failed button.** Add `#rerun-failed` (hidden); in `renderState` show `Re-run failed (N)` when `stats.failed > 0` and not running; click → `sendMessage({ action: "RERUN_FAILED" })`.
- [ ] **Step 4 — Verify + commit.** `npm run check`; `git commit` (`feat: popup segment progress + re-run failed`).

---

## Task 5: Manual end-to-end verification

- [ ] Reload extension. Load **2 small files** (3 prompts each), ZIP mode, Image 4. Run.
- [ ] Expect: **2 ZIPs** downloaded (named per file), each with that file's images; activity shows `Segment 1/2` then `Segment 2/2`; timer + total run time present.
- [ ] Optional: force a failure streak (rename the tab away mid-run) → confirm Pause + sound + the resume message.

---

## Notes
- `FAILURE_STREAK_LIMIT = 5`, `zipName = <fileStem>-<timestamp>.zip` — both fixed per spec (YAGNI on settings).
- Single file / paste still produces exactly one ZIP (one implicit segment).
