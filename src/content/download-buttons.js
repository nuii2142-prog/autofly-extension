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

  const api = {
    isSafeDownloadCandidate,
    filterDownloadCandidates
  };

  root.NuiiContentDownloads = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
