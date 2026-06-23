(function attachBackgroundRoutePolicy(root) {
  function isFireflyUrl(url) {
    try {
      return new URL(url).host === "firefly.adobe.com";
    } catch (error) {
      return false;
    }
  }

  function isFireflyGenerateUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.host === "firefly.adobe.com" && parsed.pathname.includes("/generate/image");
    } catch (error) {
      return false;
    }
  }

  function isFireflyHistoryUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.host === "firefly.adobe.com"
        && parsed.pathname.includes("/your-stuff")
        && parsed.search.includes("generationHistory");
    } catch (error) {
      return false;
    }
  }

  function chooseResultWaitStrategy(url) {
    if (isFireflyGenerateUrl(url)) {
      return { kind: "generate", action: "WAIT_FOR_RESULT", routeLabel: "Generate" };
    }

    if (isFireflyHistoryUrl(url)) {
      return { kind: "history", action: "WAIT_FOR_HISTORY_RESULT", routeLabel: "History" };
    }

    return { kind: "recover", action: null, routeLabel: "Other" };
  }

  function shouldGuardFireflyRedirect(options) {
    return options.status === "Running"
      && options.stayOnGenerate
      && options.targetTabId === options.tabId
      && !options.waitingForResult;
  }

  function shouldReturnToGenerateAfterWait(result) {
    return result && result.kind === "history";
  }

  function shouldRecoverWaitError(error) {
    return /receiving end|message port closed|extension context invalidated|frame with ID|No response/i.test(String(error || ""));
  }

  // After a failed SUBMIT_PROMPT, Generate was never clicked by the runner, so
  // "the content script went silent" alone is not submission evidence — only
  // Firefly itself moving to Generation history proves a job actually started.
  // Anything weaker must fail the item so the normal retry path can rerun it.
  function shouldAssumeSubmittedAfterFailedSubmit(tabUrl) {
    return isFireflyHistoryUrl(tabUrl || "");
  }

  // A Firefly Generate feed that accumulates many batches starts virtualizing
  // images, which blinds result detection (observed at ~50 batches: zero
  // detectable result images and intermittent full-timeout stalls). Reloading
  // the tab between prompts keeps the feed small and detection reliable.
  function shouldRefreshFireflyPage(options) {
    const opts = options || {};
    return opts.platform === "firefly"
      && Number(opts.promptsSinceRefresh) >= Number(opts.refreshEvery);
  }

  // Firefly's SPA occasionally wedges and never renders the prompt box (or its
  // Generate button), so SUBMIT_PROMPT returns "Prompt input not found". A plain
  // queue retry re-hits the same wedged page because the periodic refresh may not
  // be due yet (run logs show these failing in clusters), so the runner reloads
  // the tab once before retrying when it sees one of these page-wedged errors.
  function shouldReloadBeforeRetry(error) {
    return /prompt input not found|generate button not found/i.test(String(error || ""));
  }

  const api = {
    isFireflyUrl,
    isFireflyGenerateUrl,
    isFireflyHistoryUrl,
    chooseResultWaitStrategy,
    shouldAssumeSubmittedAfterFailedSubmit,
    shouldGuardFireflyRedirect,
    shouldReturnToGenerateAfterWait,
    shouldRecoverWaitError,
    shouldRefreshFireflyPage,
    shouldReloadBeforeRetry
  };

  root.NuiiBackgroundRoutePolicy = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
