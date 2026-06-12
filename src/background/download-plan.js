(function attachBackgroundDownloadPlan(root) {
  const DEFAULT_SUBFOLDER = "Firefly-AutoFly";
  const MAX_SLUG_WORDS = 5;
  const MAX_SLUG_LEN = 48;

  // Common filler words dropped so a slug captures the descriptive part of the
  // prompt (e.g. "young-couple-kitchen" rather than "a-young-couple-at-a").
  const STOPWORDS = new Set([
    "a", "an", "the", "of", "at", "in", "on", "to", "and", "with", "for", "by",
    "from", "into", "over", "beside", "their", "his", "her", "its", "as", "is"
  ]);

  // Chrome refuses absolute paths and ".." segments, and rejects characters that
  // are illegal in filenames. Reduce any input to a safe relative folder under
  // the Downloads directory (nested subfolders are allowed).
  function sanitizeSubfolder(name) {
    const raw = String(name || "").trim();
    if (!raw) return DEFAULT_SUBFOLDER;

    const parts = raw
      .split(/[\\/]+/)
      .map((segment) => segment
        .replace(/[^a-zA-Z0-9 _.-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/ /g, "-")
        .replace(/\.+/g, ".")
        .replace(/^[.-]+|[.-]+$/g, ""))
      .filter(Boolean)
      .filter((segment) => segment !== "." && segment !== "..");

    return parts.join("/") || DEFAULT_SUBFOLDER;
  }

  function promptSlug(prompt) {
    const words = String(prompt || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter((word) => !STOPWORDS.has(word))
      .slice(0, MAX_SLUG_WORDS);

    const slug = words.join("-").slice(0, MAX_SLUG_LEN).replace(/^-+|-+$/g, "");
    return slug || "image";
  }

  function extensionFromUrl(url) {
    const path = String(url || "").split(/[?#]/)[0];
    const match = path.match(/\.(jpe?g|png|webp|gif|avif)$/i);
    return match ? `.${match[1].toLowerCase()}` : ".jpg";
  }

  function pad(value) {
    return String(value).padStart(3, "0");
  }

  function buildDownloadPlan(options) {
    const opts = options || {};
    const subfolder = sanitizeSubfolder(opts.subfolder);
    const index = Number(opts.index) || 0;
    const slug = promptSlug(opts.prompt);
    const urls = (Array.isArray(opts.urls) ? opts.urls : [])
      .filter((url) => /^https?:\/\//i.test(String(url || "")));
    const many = urls.length > 1;

    return urls.map((url, position) => {
      const suffix = many ? `-${position + 1}` : "";
      return {
        url,
        filename: `${subfolder}/${pad(index)}-${slug}${suffix}${extensionFromUrl(url)}`
      };
    });
  }

  const api = {
    sanitizeSubfolder,
    promptSlug,
    extensionFromUrl,
    buildDownloadPlan
  };

  root.NuiiBackgroundDownloadPlan = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
