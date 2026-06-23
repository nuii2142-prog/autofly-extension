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

  // Firefly Image 5's 1K/2K picker is cosmetic: the generate request always
  // carries "resolutionLevel":"1MP" (1K) no matter what the picker shows, so
  // selecting 2K still yields a 1K image. The real lever is this request field
  // ("1MP"=1K, "4MP"=2K). Rewriting it to "4MP" makes Image 5 return 2688x1536
  // (confirmed live on image5). DOM-free + pure so it can be unit tested; the
  // caller below decides when to apply it.
  const RESOLUTION_LEVEL = { "1K": "1MP", "2K": "4MP" };
  function rewriteResolutionLevel(bodyText, wantResolution) {
    const level = RESOLUTION_LEVEL[wantResolution];
    if (!level || typeof bodyText !== "string") return bodyText;
    return bodyText.replace(/"resolutionLevel"\s*:\s*"[^"]*"/, '"resolutionLevel":"' + level + '"');
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
    const GEN_URL_V5 = "image-v5.ff.adobe.io/v1/images/generate-async";
    // The runner bridges the desired resolution here via a documentElement dataset
    // attribute (this MAIN-world script shares the DOM but not window with
    // content.js). Only "2K" needs overriding; 1K is Firefly's own default.
    function force2KWanted() {
      try {
        return !!win.document &&
          win.document.documentElement.getAttribute("data-nuii-resolution") === "2K";
      } catch (e) { return false; }
    }
    // Clone the response BEFORE returning it to the app so reading our copy never
    // races the app consuming the body.
    function tapResponse(res) {
      try {
        const ct = (res.headers && res.headers.get("content-type")) || "";
        if (ct.includes("json")) res.clone().json().then(forward).catch(() => {});
      } catch (e) {}
      return res;
    }
    win.fetch = function (...args) {
      const url = (args[0] && args[0].url) || args[0];
      if (typeof url === "string" && url.indexOf(GEN_URL_V5) !== -1 && force2KWanted()) {
        const first = args[0];
        if (first && typeof first === "object" && typeof first.clone === "function") {
          // fetch(Request): read + rewrite the body, then rebuild the Request.
          return first.clone().text().then((body) => {
            const next = rewriteResolutionLevel(body, "2K");
            const req = next !== body ? new Request(first, { body: next }) : first;
            return origFetch.call(win, req).then(tapResponse);
          }).catch(() => origFetch.apply(this, args).then(tapResponse));
        }
        if (args[1] && typeof args[1].body === "string") {
          // fetch(url, { body })
          const next = rewriteResolutionLevel(args[1].body, "2K");
          if (next !== args[1].body) args[1] = Object.assign({}, args[1], { body: next });
          return origFetch.apply(this, args).then(tapResponse);
        }
      }
      return origFetch.apply(this, args).then(tapResponse);
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

  const api = { extractOutputs, rewriteResolutionLevel };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  return api;
})(typeof globalThis !== "undefined" ? globalThis : this);
