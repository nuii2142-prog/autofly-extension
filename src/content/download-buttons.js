(function attachContentDownloadButtons(root) {
  // Marketing and navigation labels that contain "download" but are not result
  // download controls (for example "Download the app" in the page footer).
  const UNSAFE_LABEL_PATTERN = /\b(the app|apps?|plans?|pricing|upgrade|premium|desktop|mobile|store)\b/i;

  function isSafeDownloadCandidate(descriptor) {
    const candidate = descriptor || {};
    const label = String(candidate.label || "");

    if (!/\bdownload\b/i.test(label)) return false;
    if (candidate.inNavigation) return false;
    if (UNSAFE_LABEL_PATTERN.test(label)) return false;

    // Plain links navigate the tab away mid-run; only allow real download links.
    const tag = String(candidate.tagName || "").toUpperCase();
    if (tag === "A" && !candidate.hasDownloadAttr) return false;

    return true;
  }

  function filterDownloadCandidates(candidates, limit) {
    const max = Number.isFinite(limit) ? limit : 6;
    return (candidates || [])
      .filter((candidate) => candidate && isSafeDownloadCandidate(candidate.descriptor || candidate))
      .slice(0, max);
  }

  // How many download controls a prompt may click. An unknown or zero count
  // means this prompt's images were not individually detected; clicking a
  // generic fallback amount would re-download older batches still on the page,
  // so the safe cap is zero, not a wider default.
  function resolveDownloadLimit(newImageCount) {
    const count = Number(newImageCount);
    if (!Number.isFinite(count) || count <= 0) return 0;
    return Math.min(count, 8);
  }

  // Choose which download controls to click for THIS prompt. Prefer controls
  // that newly appeared since the pre-generation snapshot (knownElements): that
  // scopes the download to the batch this prompt produced and never re-grabs
  // older batches still on the accumulating results feed. If the diff looks
  // unreliable (more fresh controls than a single batch could hold, e.g. the
  // feed virtualized/re-rendered and every element looks new), fall back to the
  // top-N by detected count. No fresh controls means nothing new to download.
  function selectFreshDownloads(candidates, knownElements, options) {
    const opts = options || {};
    const cap = Number.isFinite(opts.cap) ? opts.cap : 12;
    const fallbackLimit = Number.isFinite(opts.fallbackLimit) ? opts.fallbackLimit : 0;
    const known = knownElements || new Set();
    const list = Array.isArray(candidates) ? candidates : [];
    const fresh = list.filter((item) => item && !known.has(item.element));

    if (fresh.length > 0 && fresh.length <= cap) {
      return { items: fresh, strategy: "fresh", fresh: fresh.length };
    }
    if (fresh.length > cap) {
      return { items: list.slice(0, Math.max(0, fallbackLimit)), strategy: "fallback", fresh: fresh.length };
    }
    return { items: [], strategy: "none", fresh: 0 };
  }

  const api = {
    isSafeDownloadCandidate,
    filterDownloadCandidates,
    resolveDownloadLimit,
    selectFreshDownloads
  };

  root.NuiiContentDownloads = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
