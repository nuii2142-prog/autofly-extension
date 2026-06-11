(function attachContentGenerationResult(root) {
  // Page-wide text scanning needs word-bounded, error-shaped phrases: bare
  // keywords like "limit" match marketing copy ("unlimited image generations")
  // and fail healthy runs. False negatives here are safe — the wait loop
  // still times out — so precision wins over recall.
  const PAGE_ERROR_PATTERN = new RegExp(
    "\\b(?:"
    + [
      "prompt declined",
      "unable to generate",
      "couldn['’]?t (?:generate|process)",
      "could not (?:generate|process)",
      "generation failed",
      "failed to generate",
      "something went wrong",
      "content polic(?:y|ies)",
      "policy violation",
      "quota\\b(?:\\s+(?:reached|exceeded))?",
      "limits?\\s+(?:reached|exceeded|hit)",
      "(?:reached|exceeded)\\s+(?:your\\s+|the\\s+)?[^\\n]{0,40}?limits?\\b",
      "rate limits?\\b",
      "out of (?:generative\\s+)?credits",
      "insufficient credits",
      "try again later"
    ].join("|")
    + ")[^\\n]{0,120}",
    "i"
  );

  const ALERT_ERROR_PATTERN = /\b(?:error|errors|failed|fails|failure|try again|blocked|declined|policy|policies|quota|quotas|limit|limits)\b/i;

  function pageErrorText(text) {
    const match = String(text || "").match(PAGE_ERROR_PATTERN);
    return match ? match[0] : "";
  }

  function isGenerateBusyState(state) {
    if (!state) return false;
    return Boolean(
      state.loadingCount > 0
      || state.skeletonCount > 0
      || (state.generateButtonFound && state.generateButtonDisabled)
    );
  }

  function isGenerateResultSettled(state, beforeState, stableTicks, elapsedMs, flags) {
    const before = beforeState || {};
    const options = flags || {};
    const busy = Boolean(options.busy);
    const sawBusy = Boolean(options.sawBusy);
    const sawChange = Boolean(options.sawChange);
    const outputIncreased = state.outputCount > (before.outputCount || 0);
    const outputChanged = Boolean(before.outputSignature) && state.outputSignature !== before.outputSignature;
    const settled = !busy && !state.loadingCount && !state.skeletonCount && stableTicks >= 2;

    // The Generate button returning to enabled after a busy phase is the most
    // reliable completion signal: page-wide image signatures keep churning on
    // busy pages (lazy-loaded galleries, style rails) and can block the
    // stable-signature rules forever.
    const idleButtonTicks = Number(options.idleButtonTicks) || 0;
    if (
      (outputIncreased || outputChanged)
      && sawBusy
      && idleButtonTicks >= 2
      && elapsedMs > 5000
    ) {
      return {
        complete: true,
        stage: "generate-button-idle",
        warning: ""
      };
    }

    if ((outputIncreased || outputChanged) && settled) {
      return {
        complete: true,
        stage: outputIncreased ? "generate-output-increased" : "generate-output-changed",
        warning: ""
      };
    }

    if (state.outputCount >= 4 && settled && sawChange && stableTicks >= 4 && elapsedMs > 15000) {
      return {
        complete: true,
        warning: "Completed by settled visible output; baseline growth was not detected",
        stage: "generate-output-complete"
      };
    }

    if (state.outputCount > 0 && settled && sawBusy && elapsedMs > 8000) {
      return {
        complete: true,
        stage: "generate-busy-idle",
        warning: "Completed by Generate page returning idle after a busy state"
      };
    }

    return {
      complete: false,
      stage: "",
      warning: ""
    };
  }

  function blockingErrorFromTexts(texts) {
    const messages = Array.isArray(texts) ? texts : [];
    return messages.find((text) => {
      const normalized = String(text || "").replace(/\s+/g, " ").trim();
      if (!normalized) return false;
      if (/can['’]?t save .*generation history/i.test(normalized)) return false;
      if (/couldn['’]?t save .*generation history/i.test(normalized)) return false;
      return ALERT_ERROR_PATTERN.test(normalized);
    }) || "";
  }

  const api = {
    blockingErrorFromTexts,
    isGenerateBusyState,
    isGenerateResultSettled,
    pageErrorText
  };

  root.NuiiContentGeneration = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
