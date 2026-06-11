(function attachBackgroundQueueState(root) {
  function applyPromptResultToItem(item, appState, response) {
    if (response.success) {
      item.status = "done";
      item.finishedAt = Date.now();
      item.meta = {
        downloads: response.downloads || 0,
        warning: response.warning || "",
        stage: response.stage || "",
        route: response.route || "",
        outputCount: response.finalState ? response.finalState.outputCount : null
      };
      return { action: "done" };
    }

    // A result-verification timeout after a confirmed submission means
    // generation already started on the page; retrying would click Generate
    // again and create a duplicate batch with double credit spend.
    if (response.code === "RESULT_TIMEOUT" && item.submittedAt) {
      const warning = "Result not verified before timeout; generation already started, so it was not retried. Check Firefly for the output.";
      item.status = "done";
      item.finishedAt = Date.now();
      item.meta = {
        downloads: 0,
        warning,
        stage: "unverified-timeout",
        route: response.route || "",
        outputCount: null,
        unverified: true
      };
      return { action: "done", warning };
    }

    item.error = response.error || "Unknown automation error";
    appState.lastError = item.error;

    if (item.attempts <= appState.settings.retryLimit) {
      item.status = "pending";
      return { action: "retry" };
    }

    item.status = "failed";
    item.finishedAt = Date.now();
    return { action: "failed" };
  }

  function computeStats(queue) {
    return (queue || []).reduce(
      (stats, item) => {
        stats.total += 1;
        if (item.status === "done") stats.done += 1;
        if (item.status === "failed") stats.failed += 1;
        if (item.status === "pending") stats.pending += 1;
        if (item.status === "running") stats.running += 1;
        return stats;
      },
      { total: 0, done: 0, failed: 0, pending: 0, running: 0 }
    );
  }

  function recoverRunningItemsAfterRestart(appState, now) {
    const queue = Array.isArray(appState.queue) ? appState.queue : [];
    const recoveredItems = queue.filter((item) => item && item.status === "running");

    recoveredItems.forEach((item) => {
      if (item.submittedAt) {
        item.status = "failed";
        item.error = "Service worker restarted after prompt submission; skipped to avoid duplicate Generate click";
        item.finishedAt = now;
        return;
      }

      item.status = "pending";
      item.error = "Service worker restarted before prompt submission";
    });

    appState.status = "Paused";
    appState.currentPrompt = "";
    appState.currentItemId = null;
    appState.waitingForResult = false;

    return {
      recovered: recoveredItems.length
    };
  }

  const api = {
    applyPromptResultToItem,
    computeStats,
    recoverRunningItemsAfterRestart
  };

  root.NuiiBackgroundQueueState = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
