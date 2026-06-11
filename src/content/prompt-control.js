(function attachContentPromptControl(root) {
  function normalizePromptValue(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function promptValueMatches(actual, expected) {
    return normalizePromptValue(actual) === normalizePromptValue(expected);
  }

  function choosePromptInputCandidate(candidates) {
    const match = (candidates || []).find((candidate) => {
      return candidate
        && candidate.target
        && candidate.visible
        && !candidate.disabled;
    });

    return match ? match.target : null;
  }

  const api = {
    choosePromptInputCandidate,
    normalizePromptValue,
    promptValueMatches
  };

  root.NuiiContentPrompt = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
