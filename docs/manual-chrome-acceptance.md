# Manual Chrome Acceptance Checklist

Use this after code changes that affect popup, background runner, content scripts, or Firefly route handling.

## Setup

- Open `chrome://extensions`.
- Enable Developer mode.
- Load unpacked from `C:\Users\Darks\Documents\autofly-extension`.
- Open a signed-in Adobe Firefly tab.
- After reloading the extension, refresh any already-open Firefly tab so the latest content scripts are active.

## Generate Page Flow

- Paste two short prompts into the popup.
- Start the run while Firefly stays on `/generate/image`.
- Verify each prompt creates one generation batch, not duplicate rows for the same prompt.
- Verify the queue reaches `Complete`.
- Verify the activity log includes route/stage diagnostics without full prompt text beyond truncation.

## History Redirect Flow

- Run two prompts in a Firefly session that redirects to `/your-stuff?...generationHistory...`.
- Verify the run waits on the History route instead of timing out immediately.
- Verify the runner returns Firefly to `/generate/image` before the next prompt.
- Verify the queue reaches `Complete` or records a clear failure reason.

## Duplicate-Generation Guard

- Run one prompt and let the result wait time out (set a short timeout, e.g. 60s, on a slow generation).
- Verify the prompt is NOT retried after "Generation started" was logged: the item should complete as done with a "not retried" notice instead of clicking Generate a second time.
- Verify exactly one generation batch exists in Firefly for that prompt.

## Completion Detection

- Run one prompt on a busy Generate page (existing batches and style cards visible).
- Verify the run advances only AFTER the new batch card's images are fully rendered (stage "generate-batch-loaded"), not seconds after clicking Generate while the card still shows a percent indicator.
- Run several prompts back to back and verify every prompt produces a finished batch in Firefly: N prompts in the queue must equal N completed batches on the page.
- Verify the rhythm is: batch finishes -> delay -> next prompt submits, with no full-timeout stalls between prompts.
- If a prompt still completes via the timeout fallback, verify the activity log contains a "Wait diagnostics:" line (numbers only, no prompt text) and report it.

## Error Detection Accuracy

- Run one prompt while Adobe's promo banner ("Get unlimited image generations...") is visible on the page.
- Verify the run is NOT failed by marketing copy: the prompt should complete or time out, never fail within seconds with promo text as the error.
- If a real decline occurs (prompt declined / reached your generation limit), verify it is still reported as a failure with the page's actual error text.

## Auto-Download Safety

- Enable Auto-download and run one prompt.
- Verify result download controls are clicked, but footer/navigation links containing "download" (for example "Download the app") are never clicked.
- Verify the Firefly tab is not navigated away by the auto-download pass.

## Double-Start Guard

- Start a multi-prompt run, then immediately send Start again (for example from a reopened popup).
- Verify the second start is rejected with "A run is already in progress" in the activity area and the running queue is not reset.

## Queue Controls

- Start a multi-prompt run.
- Pause and resume once.
- Stop once and confirm the active item is returned to pending or the run stops cleanly.
- Export the log and confirm it contains no secrets or full untruncated prompt dump.
