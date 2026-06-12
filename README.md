# Nuii AutoFly Studio

Original Chrome extension for bulk prompt automation on browser-based AI image tools. This project does not include third-party extension code, branding assets, or platform APIs.

## What is improved

- Persistent queue state with pause, resume, stop, retries, and run logs.
- Paste, TXT, and CSV prompt import with duplicate removal.
- Prefix and suffix prompt transforms, including `{n}` numbering.
- Delay, timeout, retry, auto-download, auto-delete, and continue-on-error controls.
- Auto-download of full-resolution results through Firefly's own download control, to the standard Downloads folder.
- Optional completion chime when the queue finishes, played from an offscreen document.
- Completion is detected from result images actually finishing rendering, so the next prompt only starts once the current images are done.
- The Firefly tab is auto-refreshed at run start and every 10 prompts, preventing the detection stalls that appear once the results feed accumulates ~50 batches.
- More resilient page automation for prompt inputs, generate buttons, busy states, output changes, and download buttons.
- Split submit/wait runner: the extension sends a prompt to the Firefly Generate prompt box, clicks Generate once, then waits for completed outputs on the Generate page before starting the next delay.
- Debugger/CDP click path: when the optional `debugger` permission is granted (Chrome asks once on the first Start), the Generate button can be clicked through Chrome's debugger input API, which is closer to a real browser click. Denying the permission keeps runs working with standard DOM clicks only.
- Safe tab targeting: a Firefly run never reloads or navigates a non-Firefly tab; it adopts an existing Firefly tab or opens a new one.
- Background-friendly queue runner: the service worker keeps the Firefly tab non-discardable and does not activate the tab between prompts.
- Active tab targeting with Adobe Firefly as the stable default.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder:

   `C:\Users\Darks\Documents\autofly-extension`

## Usage

1. Open Adobe Firefly in a browser tab and sign in.
2. Open the extension popup.
3. Paste prompts or import a `.txt` / `.csv` file.
4. Set delay, timeout, retry, and download options.
5. Click **Start**.

## Notes

- The extension automates visible browser UI and depends on the target platform layout.
- If the platform changes its page structure, adjust the selectors in `content.js`.
- Auto-download clicks visible download controls when generation appears complete.
