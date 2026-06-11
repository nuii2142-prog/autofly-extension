(function attachContentHistoryResult(root) {
  function isHistoryResultSettled(state, beforeState, stableTicks, elapsedMs, sawChange) {
    const before = beforeState || {};
    const outputIncreased = state.outputCount > (before.outputCount || 0);
    const textChanged = Boolean(before.textHash) && state.textHash !== before.textHash;
    const settled = !state.loadingCount && !state.skeletonCount && stableTicks >= 2;

    if ((outputIncreased || textChanged) && settled) {
      return {
        complete: true,
        stage: outputIncreased ? "history-output-increased" : "history-output-changed",
        warning: ""
      };
    }

    if (state.outputCount > 0 && settled && sawChange && elapsedMs > 15000) {
      return {
        complete: true,
        stage: "history-output-complete",
        warning: "Completed by settled history output; baseline growth was not detected"
      };
    }

    if (state.outputCount > 0 && settled && stableTicks >= 4 && elapsedMs > 15000) {
      return {
        complete: true,
        stage: "history-output-existing",
        warning: "Completed by stable existing history output; no baseline growth was detected"
      };
    }

    return {
      complete: false,
      stage: "",
      warning: ""
    };
  }

  const api = {
    isHistoryResultSettled
  };

  root.NuiiContentHistory = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
