// Runs in the page's MAIN world (manifest content_scripts world:"MAIN") so it can
// observe Firefly's own fetch()/XHR responses. Firefly delivers each generation as
// an async job whose result poll returns:
//   { outputs: [ { seed, image: { id, presignedUrl } }, ... ], size, ... }
// We forward those full-resolution presigned image URLs to the content script
// (isolated world) via window.postMessage. The content script captures them
// straight into the run's ZIP — the authoritative image list (exact batch size,
// stable ids), replacing the old DOM-scrape + download-button-click capture which
// could miss images or grab the wrong batch.
(function attachFireflyNetworkHook(root) {
  const TAG = "nuii-ff-capture";

  // Pull { url, id, seed } for every finished output in a result-poll body.
  // Returns null for anything that is not a completed result batch (no outputs,
  // or outputs still generating with no presignedUrl yet) so callers can ignore it.
  function extractOutputs(json) {
    if (!json || !Array.isArray(json.outputs)) return null;
    const items = [];
    for (const entry of json.outputs) {
      const image = entry && entry.image;
      if (!image || !image.presignedUrl) continue;
      items.push({
        url: image.presignedUrl,
        id: image.id || "",
        seed: typeof entry.seed === "number" ? entry.seed : null
      });
    }
    return items.length ? items : null;
  }

  const win = typeof window !== "undefined" ? window : null;

  if (win && !win.__nuiiFFHookInstalled && typeof win.fetch === "function") {
    win.__nuiiFFHookInstalled = true;

    const forward = (json) => {
      let outputs;
      try {
        outputs = extractOutputs(json);
      } catch (e) {
        return;
      }
      if (!outputs) return;
      try {
        win.postMessage({ source: TAG, outputs }, win.location.origin);
      } catch (e) {}
    };

    const origFetch = win.fetch;
    // Chain on the original promise and clone the response BEFORE returning it to
    // the app, so reading our clone never races the app consuming the body.
    win.fetch = function (...args) {
      return origFetch.apply(this, args).then((res) => {
        try {
          const ct = (res.headers && res.headers.get("content-type")) || "";
          if (ct.includes("json")) res.clone().json().then(forward).catch(() => {});
        } catch (e) {}
        return res;
      });
    };

    const Xhr = win.XMLHttpRequest;
    if (Xhr && Xhr.prototype && typeof Xhr.prototype.send === "function") {
      const origSend = Xhr.prototype.send;
      Xhr.prototype.send = function () {
        try {
          this.addEventListener("load", function () {
            try {
              const ct = (this.getResponseHeader && this.getResponseHeader("content-type")) || "";
              if (ct.includes("json")) forward(JSON.parse(this.responseText));
            } catch (e) {}
          });
        } catch (e) {}
        return origSend.apply(this, arguments);
      };
    }
  }

  const api = { extractOutputs };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  return api;
})(typeof globalThis !== "undefined" ? globalThis : this);
