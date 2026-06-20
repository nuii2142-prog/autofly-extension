// Offscreen document: plays a short synthesized chime on request. Runs audio
// for the service worker, which cannot use the Web Audio API itself. The chime
// is generated with an oscillator so no binary audio asset is shipped.
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.action === "PLAY_COMPLETION_SOUND") {
    playCompletion(message.tone === "error" ? "error" : "complete");
  }
});

// A user-uploaded sound (stored as a data URL in chrome.storage.local under
// "nuiiCustomSound") replaces the synthesized chime for the "complete" tone.
// The error tone always uses the built-in chime. Any failure falls back to it,
// and the outcome is reported to the background so it shows in the run log.
async function playCompletion(tone) {
  if (tone === "complete") {
    let custom = null;
    try {
      const stored = await chrome.storage.local.get("nuiiCustomSound");
      custom = stored && stored.nuiiCustomSound;
    } catch (error) {
      custom = null;
    }
    if (custom && custom.dataUrl) {
      try {
        await playDataUrl(custom.dataUrl);
        reportSound(true, "");
        return;
      } catch (error) {
        reportSound(false, (error && error.message) || "playback failed");
        // Fall through to the built-in chime.
      }
    }
  }
  playChime(tone);
}

function reportSound(ok, error) {
  try {
    chrome.runtime.sendMessage({ action: "SOUND_RESULT", ok, error }, () => {
      void chrome.runtime.lastError;
    });
  } catch (error) {
    // Reporting is best-effort.
  }
}

// Decode a data URL to an ArrayBuffer without fetch() (fetch of data: URLs can be
// blocked by the offscreen document's CSP — a likely cause of the silent fallback).
function dataUrlToArrayBuffer(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Play an uploaded sound through the Web Audio API — the same path the chime uses
// (HTMLAudioElement.play() is blocked by the offscreen autoplay policy). Resumes a
// suspended context and supports both the promise and callback forms of decode.
async function playDataUrl(dataUrl) {
  const AudioCtx = self.AudioContext || self.webkitAudioContext;
  if (!AudioCtx) throw new Error("AudioContext unavailable");

  const ctx = new AudioCtx();
  try {
    if (ctx.state === "suspended" && ctx.resume) {
      await ctx.resume();
    }
    const arrayBuffer = dataUrlToArrayBuffer(dataUrl);
    const audioBuffer = await new Promise((resolve, reject) => {
      const maybePromise = ctx.decodeAudioData(arrayBuffer, resolve, reject);
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(resolve, reject);
      }
    });
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.start();
    await new Promise((resolve) => {
      source.onended = resolve;
      setTimeout(resolve, (audioBuffer.duration + 1) * 1000);
    });
  } finally {
    if (ctx.close) ctx.close().catch(() => {});
  }
}

function playChime(tone) {
  try {
    const AudioCtx = self.AudioContext || self.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    // complete: rising C5-E5-G5 major arpeggio; error: low descending pair.
    const notes = tone === "error" ? [392.0, 261.63] : [523.25, 659.25, 783.99];

    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;

      const start = now + index * 0.13;
      const end = start + 0.2;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.28, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    });

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1500);
  } catch (error) {
    // Audio unavailable in this environment; ignore.
  }
}
