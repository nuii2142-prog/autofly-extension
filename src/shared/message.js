(function attachSharedMessage(root) {
  const shared = root.NuiiShared || {};

  function normalizeTabMessageResponse(response, lastErrorMessage) {
    if (lastErrorMessage) {
      return {
        success: false,
        error: lastErrorMessage
      };
    }

    if (!response) {
      return {
        success: false,
        error: "No response from content script"
      };
    }

    return response;
  }

  Object.assign(shared, {
    normalizeTabMessageResponse
  });

  root.NuiiShared = shared;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      normalizeTabMessageResponse
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
