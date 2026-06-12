# Nuii AutoFly Studio

Original Chrome extension for bulk prompt automation on browser-based AI image tools. This project does not include third-party extension code, branding assets, or platform APIs.

## What is improved

- Persistent queue state with pause, resume, stop, retries, and run logs.
- Paste, TXT, and CSV prompt import with duplicate removal.
- Prefix and suffix prompt transforms, including `{n}` numbering.
- Delay, timeout, retry, auto-download, auto-delete, and continue-on-error controls.
- Silent auto-download of generated images into a chosen subfolder of Downloads, named `NNN-prompt-words.jpg`, with a Firefly download-button fallback.
- Completion is detected from result images actually finishing rendering, so the next prompt only starts once the current images are done.
- More resilient page automation for prompt inputs, generate buttons, busy states, output changes, and download buttons.
- Split submit/wait runner: the extension sends a prompt to the Firefly Generate prompt box, clicks Generate once, then waits for completed outputs on the Generate page before starting the next delay.
- Debugger/CDP click path: the Generate button is clicked through Chrome's debugger input API instead of plain `element.click()`, which is closer to a real browser click.
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
