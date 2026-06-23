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

  // A new run may only start once the previous queue loop has fully exited.
  // A paused run can still be inside an awaited prompt (navigation waits run
  // up to 45s); replacing the state under it makes the old loop adopt the new
  // queue and cross-contaminate logs and item transitions.
  function canStartNewRun(options) {
    const opts = options || {};
    if (opts.status === "Running") {
      return {
        allowed: false,
        reason: "A run is already in progress. Stop or pause it before starting a new one."
      };
    }

    if (opts.queueLoopRunning) {
      return {
        allowed: false,
        reason: "The previous run is still finishing its current prompt. Wait a moment or stop it first."
      };
    }

    return { allowed: true, reason: "" };
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

  function formatRunSummary(stats, downloads, elapsedMs) {
    const summary = stats || {};
    const totalSeconds = Math.max(0, Math.round((Number(elapsedMs) || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    const images = Number(downloads) || 0;
    return `${summary.done || 0} done, ${summary.failed || 0} failed, ${images} image${images === 1 ? "" : "s"}, ${minutes}:${seconds}`;
  }

  // After a run, reconcile captured images against completed prompts. With ZIP
  // capture each done prompt should yield at least one image; a done item with
  // downloads=0 means the result poll's image never landed in its capture window
  // (a slow poll late in a laggy run). Returns the totals plus the specific
  // prompts that came up empty so the summary can name them instead of silently
  // undercounting. `shortfall` is the accurate net count (expected - captured);
  // `missing` lists suspect prompts (1-based queue position + text) to re-run.
  function captureGaps(queue, zipEnabled) {
    const items = Array.isArray(queue) ? queue : [];
    const done = items.filter((item) => item && item.status === "done");
    const captured = done.reduce(
      (sum, item) => sum + ((item.meta && Number(item.meta.downloads)) || 0),
      0
    );
    const missing = !zipEnabled ? [] : done
      .filter((item) => ((item.meta && Number(item.meta.downloads)) || 0) === 0)
      .map((item) => ({ position: items.indexOf(item) + 1, prompt: String(item.prompt || "") }));
    return { expected: done.length, captured, shortfall: Math.max(0, done.length - captured), missing };
  }

  // A prompt entry is either a bare string or { prompt, sourcePrompt }. Reduce it
  // to the { prompt, sourcePrompt } shape the queue stores.
  function normalizeEntry(entry) {
    if (entry && typeof entry === "object") {
      const prompt = String(entry.prompt || "").trim();
      return { prompt, sourcePrompt: String(entry.sourcePrompt || entry.prompt || "").trim() };
    }
    const prompt = String(entry || "").trim();
    return { prompt, sourcePrompt: prompt };
  }

  // Build a flat queue from segments [{ name, prompts }]. Each item carries its
  // segmentIndex; each segment gets its own runId so capture + finalize stay
  // isolated per segment (one ZIP per file). `now` is passed in to keep this pure.
  function buildSegmentedQueue(rawSegments, now) {
    const base = Number(now) || 0;
    const segments = [];
    const queue = [];
    let running = 0;
    (rawSegments || []).forEach((seg, segIndex) => {
      segments.push({
        name: String((seg && seg.name) || `segment-${segIndex + 1}`),
        runId: `${base}-s${segIndex}`
      });
      (((seg && seg.prompts) || [])).forEach((entry) => {
        const { prompt, sourcePrompt } = normalizeEntry(entry);
        if (!prompt) return;
        queue.push({
          id: `${base}-${running}`,
          prompt,
          sourcePrompt,
          status: "pending",
          attempts: 0,
          error: "",
          startedAt: null,
          finishedAt: null,
          segmentIndex: segIndex
        });
        running += 1;
      });
    });
    return { queue, segments };
  }

  // A segment is complete once none of its items are still pending or running
  // (every item is done or failed) — the cue to finalize that segment's ZIP.
  function segmentComplete(queue, segmentIndex) {
    const items = (queue || []).filter((item) => item && item.segmentIndex === segmentIndex);
    if (!items.length) return false;
    return items.every((item) => item.status === "done" || item.status === "failed");
  }

  // Consecutive-failure counter: reset on a success, +1 on a final failure, and
  // unchanged on a retry (the item will come back around).
  function nextFailureStreak(prevStreak, action) {
    const prev = Number(prevStreak) || 0;
    if (action === "done") return 0;
    if (action === "failed") return prev + 1;
    return prev;
  }

  function shouldPauseForFailures(streak, limit) {
    return (Number(streak) || 0) >= (Number(limit) || 0);
  }

  // <fileStem>-<timestamp>.zip with filesystem-unsafe runs collapsed to "_".
  function zipNameForSegment(name, timestamp) {
    const clean = String(name == null ? "" : name)
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return `${clean || "segment"}-${timestamp}.zip`;
  }

  // Collect the run's failed items back into segments (grouped by their original
  // segment, order preserved) so "Re-run failed" produces the same per-file ZIPs.
  function failedItemsToSegments(queue, segments) {
    const byIndex = new Map();
    (queue || []).forEach((item) => {
      if (!item || item.status !== "failed") return;
      if (!byIndex.has(item.segmentIndex)) byIndex.set(item.segmentIndex, []);
      byIndex.get(item.segmentIndex).push({
        prompt: String(item.prompt || item.sourcePrompt || "").trim(),
        sourcePrompt: String(item.sourcePrompt || item.prompt || "").trim()
      });
    });
    return [...byIndex.keys()]
      .sort((a, b) => a - b)
      .map((segIndex) => ({
        name: String(((segments || [])[segIndex] || {}).name || `segment-${segIndex + 1}`),
        prompts: byIndex.get(segIndex)
      }));
  }

  const api = {
    applyPromptResultToItem,
    canStartNewRun,
    computeStats,
    recoverRunningItemsAfterRestart,
    formatRunSummary,
    captureGaps,
    buildSegmentedQueue,
    segmentComplete,
    nextFailureStreak,
    shouldPauseForFailures,
    zipNameForSegment,
    failedItemsToSegments
  };

  root.NuiiBackgroundQueueState = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
