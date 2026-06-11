(function attachSharedText(root) {
  const shared = root.NuiiShared || {};

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function truncate(value, length) {
    const text = String(value || "");
    if (text.length <= length) return text;
    return `${text.slice(0, length - 1)}...`;
  }

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  Object.assign(shared, {
    clampNumber,
    truncate,
    normalizeText,
    delay,
    clone
  });

  root.NuiiShared = shared;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      clampNumber,
      truncate,
      normalizeText,
      delay,
      clone
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
