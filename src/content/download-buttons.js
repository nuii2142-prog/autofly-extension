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

  const api = {
    isSafeDownloadCandidate,
    filterDownloadCandidates,
    resolveDownloadLimit
  };

  root.NuiiContentDownloads = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
