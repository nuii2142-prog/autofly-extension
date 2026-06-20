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
// The error tone always uses the built-in chime. Any failure falls back to it.
async function playCompletion(tone) {
  if (tone === "complete") {
    try {
      const stored = await chrome.storage.local.get("nuiiCustomSound");
      const custom = stored && stored.nuiiCustomSound;
      if (custom && custom.dataUrl) {
        await playDataUrl(custom.dataUrl);
        return;
      }
    } catch (error) {
      // Fall through to the built-in chime.
    }
  }
  playChime(tone);
}

// Play an uploaded sound through the Web Audio API. This mirrors the chime path,
// which is known to work in this offscreen document; HTMLAudioElement.play() is
// blocked by the autoplay policy here (which is why the upload fell back before).
async function playDataUrl(dataUrl) {
  const AudioCtx = self.AudioContext || self.webkitAudioContext;
  if (!AudioCtx) throw new Error("AudioContext unavailable");

  const ctx = new AudioCtx();
  try {
    const response = await fetch(dataUrl);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.start();
    await new Promise((resolve) => {
      source.onended = resolve;
      setTimeout(resolve, (audioBuffer.duration + 1) * 1000);
    });
  } finally {
    ctx.close().catch(() => {});
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
