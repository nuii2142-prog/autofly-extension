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

  // Run-control actions (start/pause/resume/stop) may only come from the
  // extension's own pages (popup). A sender with a tab is a content script in
  // a web page; pages on the automated site must not be able to drive runs.
  function isControlSenderAllowed(sender) {
    return Boolean(sender) && !sender.tab;
  }

  Object.assign(shared, {
    isControlSenderAllowed,
    normalizeTabMessageResponse
  });

  root.NuiiShared = shared;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      isControlSenderAllowed,
      normalizeTabMessageResponse
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
