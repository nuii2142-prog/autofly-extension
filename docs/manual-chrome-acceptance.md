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

## Queue Controls

- Start a multi-prompt run.
- Pause and resume once.
- Stop once and confirm the active item is returned to pending or the run stops cleanly.
- Export the log and confirm it contains no secrets or full untruncated prompt dump.
