(() => {
  if (globalThis.__NUII_AUTOFLY_CONTENT_READY__) {
    return;
  }

  globalThis.__NUII_AUTOFLY_CONTENT_READY__ = true;
  console.log("[Nuii AutoFly] Content automation ready.");
  const FireflySelectors = globalThis.NuiiContentSelectors;
  const GenerationResult = globalThis.NuiiContentGeneration;
  const PromptControl = globalThis.NuiiContentPrompt;
  const ResolutionControl = globalThis.NuiiContentResolution;
  const ZipWriter = globalThis.NuiiZipWriter;
  const ZipCapture = globalThis.NuiiZipCapture;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "PING") {
      sendResponse({
        success: true,
        url: location.href,
        title: document.title,
        diagnostics: getDiagnostics()
      });
      return true;
    }

    if (request.action === "SUBMIT_PROMPT" || request.action === "PROCESS_PROMPT") {
      submitPrompt(request.prompt, request.settings || {})
        .then(sendResponse)
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (request.action === "WAIT_FOR_RESULT") {
      waitForExistingResult(request.prompt, request.settings || {})
        .then(sendResponse)
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (request.action === "WAIT_FOR_HISTORY_RESULT") {
      waitForHistoryResult(request.prompt, request.settings || {})
        .then(sendResponse)
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (request.action === "GET_GENERATION_STATE") {
      sendResponse({
        success: true,
        state: generatePageState(request.prompt || ""),
        promptValue: getPromptValue(),
        generateButtons: generateButtonCandidates().slice(0, 5).map((item) => ({
          score: item.score,
          label: truncate(elementLabel(item.element), 80),
          rect: elementRect(item.element)
        }))
      });
      return true;
    }

    if (request.action === "CLICK_GENERATE_DOM") {
      const button = findGenerateButton();
      if (!button) {
        sendResponse({ success: false, error: "Generate button not found" });
        return true;
      }
      clickElement(button);
      sendResponse({ success: true });
      return true;
    }

    if (request.action === "FOCUS_PROMPT") {
      const input = findPromptInput();
      if (!input) {
        sendResponse({ success: false, error: "Prompt input not found" });
        return true;
      }
      const target = editableTarget(input) || input;
      target.scrollIntoView({ block: "center", inline: "nearest" });
      target.focus();
      sendResponse({ success: true });
      return true;
    }

    if (request.action === "FINALIZE_ZIP") {
      finalizeZip(request.runId)
        .then(sendResponse)
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    return false;
  });

  async function submitPrompt(prompt, settings = {}) {
    const startedAt = Date.now();
    await preferGridView();
    const resolution = await applyResolution(settings.resolution);
    const input = await waitFor(() => findPromptInput(), 12000, 250);

    if (!input) {
      return { success: false, error: "Prompt input not found" };
    }

    clearPromptValue(input);
    await sleep(150);
    setPromptValue(input, prompt);
    const promptAccepted = await waitFor(() => PromptControl.promptValueMatches(getPromptValue(), prompt), 2500, 150);
    if (!promptAccepted) {
      clearPromptValue(input);
      await sleep(150);
      setPromptValue(input, prompt);
      await sleep(500);
    }

    if (!PromptControl.promptValueMatches(getPromptValue(), prompt)) {
      return {
        success: false,
        error: "Prompt box did not accept the new prompt; old prompt may still be present"
      };
    }

    const generateButton = await waitFor(() => findGenerateButton(), 9000, 250);
    if (!generateButton) {
      return { success: false, error: "Generate button not found" };
    }

    const buttonRect = elementRect(generateButton);
    const buttonCandidates = generateButtonCandidates().slice(0, 5).map((item) => ({
      score: item.score,
      label: truncate(elementLabel(item.element), 80),
      rect: elementRect(item.element)
    }));

    return {
      success: true,
      stage: "prepared",
      generateButton: buttonRect,
      generateButtons: buttonCandidates,
      state: generatePageState(prompt),
      resolution,
      elapsedMs: Date.now() - startedAt,
      error: ""
    };
  }

  // Re-apply the requested image resolution before each Generate. A Firefly tab
  // reload resets the picker to its 1K default, and the picker selection is not
  // persisted anywhere we can pre-seed (no relevant localStorage key), so the
  // only reliable path is to drive the Spectrum menu the same way a user would.
  // A failure here never blocks the run: it returns a reason and we generate at
  // whatever resolution the page currently holds.
  async function applyResolution(target) {
    if (!ResolutionControl || !ResolutionControl.isSupportedResolution(target)) {
      return { applied: false, reason: "unsupported", target: target || null };
    }

    const readItems = () =>
      deepQuerySelectorAll(ResolutionControl.RESOLUTION_ITEM_SELECTOR).map((element) => ({
        value: element.getAttribute("value") || element.getAttribute("data-testid"),
        checked: element.getAttribute("aria-checked") === "true"
      }));

    if (!ResolutionControl.needsChange(readItems(), target)) {
      return { applied: true, already: true, resolution: target };
    }

    const findOption = () => firstVisible(deepQuerySelectorAll(ResolutionControl.menuItemSelector(target)));

    // The option is only clickable when the picker menu is open. After a reload
    // it is usually closed, so open it via the Resolution trigger first.
    let option = findOption();
    if (!option) {
      const trigger = findResolutionTrigger();
      if (trigger) {
        clickElement(trigger);
        option = await waitFor(() => findOption(), 3000, 150);
      }
    }

    if (!option) {
      return { applied: false, reason: "control-not-found", target };
    }

    clickElement(option);

    const confirmed = await waitFor(
      () => (ResolutionControl.currentResolution(readItems()) === target ? true : null),
      3000,
      150
    );

    if (confirmed) {
      console.log(`[Nuii AutoFly] Resolution set to ${target}.`);
      return { applied: true, resolution: target };
    }

    return { applied: false, reason: "selection-not-confirmed", target };
  }

  // Locate the clickable control that opens the Resolution picker. Prefer the
  // explicit Spectrum selectors; if those miss, anchor to a verified resolution
  // menu item and walk up (across shadow boundaries) to its owning picker, which
  // is more robust than guessing the trigger's attributes.
  function findResolutionTrigger() {
    const direct = firstVisible(
      ResolutionControl.RESOLUTION_TRIGGER_SELECTORS.flatMap((selector) => deepQuerySelectorAll(selector))
    );
    if (direct) return direct;

    const items = deepQuerySelectorAll(ResolutionControl.RESOLUTION_ITEM_SELECTOR);
    for (const item of items) {
      let node = item;
      for (let depth = 0; depth < 12 && node; depth += 1) {
        const parent = node.parentNode;
        node = parent && parent.host ? parent.host : parent;
        if (!node || !node.tagName) continue;
        if (node.tagName === "SP-PICKER" || node.tagName === "SP-ACTION-BUTTON") return node;
        if ((node.getAttribute && node.getAttribute("aria-haspopup")) && isVisible(node)) return node;
      }
    }

    return null;
  }

  async function waitForExistingResult(prompt, settings) {
    // Lower bound 10s: the background sends the remaining run-timeout budget,
    // which can legitimately be under a minute on the final pass.
    const timeout = clamp(Number(settings.timeout) || 240, 10, 600) * 1000;
    const autoDownload = Boolean(settings.autoDownload);
    const startedAt = Date.now();
    const beforeState = settings.baselineState || generatePageState(prompt);
    const result = await waitForGeneration({
      prompt,
      timeout,
      startedAt,
      beforeState
    });

    // Download the full-resolution result through Firefly's own download
    // control (the page <img> is only a low-res grid thumbnail). Scope to the
    // number of images this prompt produced so older batches still on the page
    // are not re-downloaded.
    let downloads = 0;
    if (result.success && autoDownload) {
      downloads = await clickDownloadButtons(result.newImageCount, settings);
    }

    if (result.success) {
      clearPromptValue();
      await waitFor(() => !PromptControl.normalizePromptValue(getPromptValue()), 2000, 150);
    }

    return {
      success: result.success,
      warning: result.warning || "",
      stage: result.stage || "",
      code: result.code || "",
      finalState: result.finalState || null,
      diag: result.diag || null,
      downloads,
      elapsedMs: Date.now() - startedAt,
      error: result.error || ""
    };
  }

  async function waitForHistoryResult(prompt, settings) {
    const timeout = clamp(Number(settings.timeout) || 240, 10, 600) * 1000;
    const startedAt = Date.now();
    const beforeState = settings.baselineHistoryState || generationHistoryState();
    let sawChange = false;
    let stableTicks = 0;
    let lastStableKey = "";

    while (Date.now() - startedAt < timeout) {
      await sleep(1000);

      if (!isFireflyHistoryPage()) {
        return {
          success: false,
          error: "Firefly left Generation history before result completed",
          code: "LEFT_HISTORY"
        };
      }

      const state = generationHistoryState();
      const stableKey = `${state.outputCount}:${state.textHash}:${state.loadingCount}:${state.skeletonCount}`;
      const changed = state.outputCount > (beforeState.outputCount || 0)
        || (beforeState.textHash && state.textHash !== beforeState.textHash);

      if (changed) sawChange = true;

      if (stableKey === lastStableKey) {
        stableTicks += 1;
      } else {
        stableTicks = 0;
        lastStableKey = stableKey;
      }

      if (state.errorText) {
        return { success: false, error: state.errorText };
      }

      const settled = globalThis.NuiiContentHistory.isHistoryResultSettled(
        state,
        beforeState,
        stableTicks,
        Date.now() - startedAt,
        sawChange
      );

      if (settled.complete) {
        let downloads = 0;
        if (settings.autoDownload) {
          // Scope History downloads to the outputs this prompt added.
          downloads = await clickDownloadButtons(state.outputCount - (beforeState.outputCount || 0), settings);
        }

        return {
          success: true,
          warning: settled.warning,
          stage: settled.stage,
          finalState: state,
          downloads,
          elapsedMs: Date.now() - startedAt,
          error: ""
        };
      }
    }

    return { success: false, code: "RESULT_TIMEOUT", error: "Timed out waiting for History page result" };
  }

  function findPromptInput() {
    const candidates = FireflySelectors.PROMPT_INPUT_SELECTORS
      .flatMap((selector) => deepQuerySelectorAll(selector))
      .map((element) => {
        const target = editableTarget(element);
        return {
          element,
          target,
          visible: Boolean(target && isVisible(target)),
          disabled: Boolean(target && isDisabled(target))
        };
      });

    return PromptControl.choosePromptInputCandidate(candidates) || findLargestEditable();
  }

  function findLargestEditable() {
    const editables = deepQuerySelectorAll("textarea, input, [contenteditable='true'], [role='textbox'], sp-textfield, sp-textarea")
      .filter(isVisible)
      .filter((element) => !isDisabled(element))
      .map((element) => ({ element: editableTarget(element), area: element.getBoundingClientRect().width * element.getBoundingClientRect().height }))
      .filter((item) => item.element)
      .sort((a, b) => b.area - a.area);

    return editables.length ? editables[0].element : null;
  }

  function setPromptValue(input, prompt) {
    input = editableTarget(input) || input;
    input.scrollIntoView({ block: "center", inline: "nearest" });
    clickElement(input);
    input.focus();

    if (input.isContentEditable || input.getAttribute("contenteditable") === "true") {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("insertText", false, prompt);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: prompt }));
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      return;
    }

    if (!isTextEntryElement(input)) {
      input.textContent = "";
      input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "deleteContentBackward" }));
      input.textContent = prompt;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: prompt }));
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      return;
    }

    const view = input.ownerDocument.defaultView || window;
    const prototype = input.tagName === "TEXTAREA"
      ? view.HTMLTextAreaElement.prototype
      : view.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor && descriptor.set) {
      descriptor.set.call(input, "");
      descriptor.set.call(input, prompt);
    } else {
      input.value = "";
      input.value = prompt;
    }

    input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: prompt }));
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, composed: true, key: " ", code: "Space" }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, composed: true, key: " ", code: "Space" }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  function clearPromptValue(input) {
    input = input || findPromptInput();
    if (!input) return;

    const target = editableTarget(input) || input;
    target.focus();

    if (target.isContentEditable || target.getAttribute("contenteditable") === "true") {
      target.textContent = "";
      target.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "deleteContentBackward" }));
      target.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      return;
    }

    if (isTextEntryElement(target)) {
      const view = target.ownerDocument.defaultView || window;
      const prototype = target.tagName === "TEXTAREA"
        ? view.HTMLTextAreaElement.prototype
        : view.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

      if (descriptor && descriptor.set) {
        descriptor.set.call(target, "");
      } else {
        target.value = "";
      }

      target.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "deleteContentBackward" }));
      target.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }
  }

  function getPromptValue() {
    const input = findPromptInput();
    const target = editableTarget(input) || input;
    if (!target) return "";
    if (isTextEntryElement(target)) return target.value || "";
    return target.textContent || "";
  }

  function findGenerateButton() {
    const scored = generateButtonCandidates();
    return scored.length ? scored[0].element : null;
  }

  // Unlike the click-target candidates, state observation must include the
  // disabled button: while Firefly generates, the Generate button is disabled,
  // and that is the primary busy signal. Filtering disabled buttons out made
  // generateButtonDisabled permanently false and blinded busy detection.
  function findGenerateButtonForState() {
    const scored = FireflySelectors.GENERATE_BUTTON_SELECTORS
      .flatMap((selector) => deepQuerySelectorAll(selector))
      .filter(isVisible)
      .map((element) => ({ element, score: generateButtonScore(element) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.length ? scored[0].element : null;
  }

  function generateButtonCandidates() {
    const candidates = FireflySelectors.GENERATE_BUTTON_SELECTORS
      .flatMap((selector) => deepQuerySelectorAll(selector))
      .filter(isVisible)
      .filter((element) => !isDisabled(element));

    return candidates
      .map((element) => ({ element, score: generateButtonScore(element) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  function generateButtonScore(element) {
    const label = elementLabel(element);
    const rect = element.getBoundingClientRect();
    let score = 0;

    if (element.matches && FireflySelectors.GENERATE_BUTTON_SELECTORS.slice(0, 4).some((selector) => {
      try {
        return element.matches(selector);
      } catch (error) {
        return false;
      }
    })) {
      score += 40;
    }
    if (/\bgenerate\b/i.test(label)) score += 10;
    if (/\b(create|submit|render)\b/i.test(label)) score += 5;
    if (/download|save|cancel|stop|history|gallery|edit|pricing|upgrade/i.test(label)) score -= 20;
    if (element.closest("nav, header, [role='navigation'], [aria-label*='navigation' i]")) score -= 16;
    if (element.tagName === "A") score -= 8;
    if (element.tagName === "BUTTON" || element.getAttribute("role") === "button" || element.tagName === "SP-BUTTON") score += 4;
    if (rect.top > window.innerHeight * 0.55) score += 8;
    if (rect.left > window.innerWidth * 0.55) score += 4;
    if (rect.width >= 70 && rect.height >= 30) score += 3;
    if (rect.top < 130) score -= 10;

    return score;
  }

  async function waitForGeneration({ prompt, timeout, startedAt, beforeState }) {
    let sawBusy = false;
    let sawChange = false;
    let stableTicks = 0;
    let idleButtonTicks = 0;
    let batchStableTicks = 0;
    let newLoadedCount = 0;
    let newStableTicks = 0;
    let lastNewLoadedCount = -1;
    let lastStableKey = "";
    let lastBatchSignature = "";
    let lastObservedState = null;

    // Pre-click image set. Use the baseline captured in submitPrompt (before
    // Generate was clicked) when available; capturing it live here would run
    // after generation already started and miss the new images entirely.
    const baselineImageKeys = new Set(
      (beforeState && Array.isArray(beforeState.imageKeys) && beforeState.imageKeys.length)
        ? beforeState.imageKeys
        : currentLoadedOutputImageKeys()
    );

    const buildDiag = () => {
      const lastBatch = lastObservedState ? lastObservedState.batch : null;
      return {
        baselineOutputs: beforeState ? beforeState.outputCount || 0 : 0,
        baselineImages: baselineImageKeys.size,
        lastOutputs: lastObservedState ? lastObservedState.outputCount : -1,
        lastLoading: lastObservedState ? lastObservedState.loadingCount : -1,
        lastSkeleton: lastObservedState ? lastObservedState.skeletonCount : -1,
        buttonFound: Boolean(lastObservedState && lastObservedState.generateButtonFound),
        buttonDisabled: Boolean(lastObservedState && lastObservedState.generateButtonDisabled),
        batchFound: Boolean(lastBatch && lastBatch.found),
        batchImages: lastBatch ? `${lastBatch.loadedCount}/${lastBatch.imageCount}` : "none",
        batchBusy: lastBatch ? lastBatch.busyCount : -1,
        batchPercent: Boolean(lastBatch && lastBatch.hasPercent),
        batchStableTicks,
        newLoadedCount,
        newStableTicks,
        idleButtonTicks,
        stableTicks,
        sawBusy,
        sawChange,
        probe: batchDomProbe()
      };
    };

    while (Date.now() - startedAt < timeout) {
      await sleep(1000);
      const blockingError = findBlockingError();
      if (blockingError) {
        return { success: false, error: blockingError };
      }

      if (isFireflyHistoryPage()) {
        return {
          success: false,
          error: "Firefly moved to Generation history before result completed",
          code: "NAVIGATED_HISTORY"
        };
      }

      const state = generatePageState(prompt);
      const busy = GenerationResult.isGenerateBusyState(state);
      const stableKey = `${state.outputCount}:${state.outputSignature}:${state.loadingCount}:${state.skeletonCount}:${state.generateButtonDisabled}`;
      const changed = state.key !== beforeState.key
        || state.outputSignature !== beforeState.outputSignature
        || state.promptSeen !== beforeState.promptSeen;

      if (busy) sawBusy = true;
      if (changed) sawChange = true;

      if (stableKey === lastStableKey) {
        stableTicks += 1;
      } else {
        stableTicks = 0;
        lastStableKey = stableKey;
      }

      // The page-wide skeleton heuristic can match permanent UI chrome, so it
      // must not gate the button-idle signal; the disabled state of the
      // Generate button itself is the authoritative in-progress indicator.
      const buttonIdle = state.generateButtonFound && !state.generateButtonDisabled;
      idleButtonTicks = buttonIdle ? idleButtonTicks + 1 : 0;

      if (state.batch && state.batch.found && state.batch.signature === lastBatchSignature) {
        batchStableTicks += 1;
      } else {
        batchStableTicks = 0;
        lastBatchSignature = state.batch ? state.batch.signature : "";
      }

      newLoadedCount = currentLoadedOutputImageKeys().filter((key) => !baselineImageKeys.has(key)).length;
      if (newLoadedCount > 0 && newLoadedCount === lastNewLoadedCount) {
        newStableTicks += 1;
      } else {
        newStableTicks = 0;
        lastNewLoadedCount = newLoadedCount;
      }

      lastObservedState = state;

      if (state.errorText) {
        return { success: false, error: state.errorText };
      }

      const settled = GenerationResult.isGenerateResultSettled(
        state,
        beforeState,
        stableTicks,
        Date.now() - startedAt,
        { busy, sawBusy, sawChange, idleButtonTicks, batchStableTicks, newLoadedCount, newStableTicks }
      );

      if (settled.complete) {
        return {
          success: true,
          stage: settled.stage,
          warning: settled.warning,
          finalState: state,
          diag: buildDiag(),
          newImageCount: newLoadedCount
        };
      }
    }

    if (sawChange) {
      return { success: false, code: "RESULT_TIMEOUT", error: "Timed out before Generate page output settled", diag: buildDiag() };
    }

    return { success: false, code: "RESULT_TIMEOUT", error: "Timed out waiting for Generate page output", diag: buildDiag() };
  }

  function generatePageState(prompt) {
    const loadingCount = deepQuerySelectorAll("[aria-busy='true'], [role='progressbar'], progress, [class*='loading' i], [class*='spinner' i], [class*='progress' i]")
      .filter(isVisible)
      .length;
    const skeletonCount = generateSkeletonElements().length;
    const outputs = generateOutputElements();
    const visibleText = document.body ? document.body.innerText || "" : "";
    const outputSignature = outputs
      .map((element) => outputElementSignature(element))
      .join("|");
    const button = findGenerateButtonForState();
    const promptValue = getPromptValue();
    const batch = newestBatchState();
    const imageKeys = outputs
      .filter((element) => element.tagName === "IMG" && element.complete && element.naturalWidth > 20)
      .map((element) => element.currentSrc || element.src)
      .filter(Boolean);

    return {
      loadingCount,
      skeletonCount,
      outputCount: outputs.length,
      outputSignature,
      imageKeys,
      batch,
      promptSeen: resultPromptSeen(prompt, visibleText),
      promptValue,
      generateButtonFound: Boolean(button),
      generateButtonDisabled: button ? isDisabled(button) : false,
      generateButtonLabel: button ? truncate(elementLabel(button), 80) : "",
      errorText: historyErrorText(visibleText),
      key: `${loadingCount}:${skeletonCount}:${outputs.length}:${outputSignature}:${promptValue}:${button ? isDisabled(button) : "none"}:${simpleHash(visibleText.slice(0, 5000))}`
    };
  }

  // State of the newest generation batch card. Firefly inserts the batch for
  // a new submission at the top, so the first matching container is the one
  // this run just created. Completion is judged only inside that container.
  function newestBatchState() {
    const container = FireflySelectors.BATCH_CONTAINER_SELECTORS
      .flatMap((selector) => deepQuerySelectorAll(selector))
      .filter(isVisible)
      .find(Boolean) || null;

    if (!container) {
      return { found: false, signature: "", imageCount: 0, loadedCount: 0, busyCount: 0, hasPercent: false };
    }

    const images = deepQueryWithin(container, "img")
      .filter(isVisible)
      .filter((image) => {
        const rect = image.getBoundingClientRect();
        return rect.width >= 80 && rect.height >= 60;
      });
    const loadedCount = images.filter((image) => image.complete && image.naturalWidth > 20).length;
    const busyCount = deepQueryWithin(
      container,
      "[aria-busy='true'], [role='progressbar'], progress, [class*='skeleton' i], [class*='shimmer' i], [class*='spinner' i], [class*='loading' i]"
    ).filter(isVisible).length;
    // Only count percent text inside progress-shaped nodes. The card also
    // renders the prompt caption, which may contain figures like "50% opacity"
    // that must not be mistaken for generation progress.
    const hasPercent = deepQueryWithin(
      container,
      "[role='progressbar'], [aria-valuenow], progress, [class*='progress' i], [class*='percent' i], [class*='loading' i]"
    )
      .filter(isVisible)
      .some((node) => /(^|\s)\d{1,3}\s?%/.test(node.textContent || ""));
    const signature = images.map((image) => image.currentSrc || image.src || "").join("|")
      || `${container.tagName}:${Math.round(container.getBoundingClientRect().height)}`;

    return {
      found: true,
      signature,
      imageCount: images.length,
      loadedCount,
      busyCount,
      hasPercent
    };
  }

  // src keys of result <img> elements that are currently fully loaded. Used to
  // detect images produced by THIS submission (keys absent from the pre-click
  // baseline), independent of any Firefly-specific container markup.
  function currentLoadedOutputImageKeys() {
    return generateOutputElements()
      .filter((element) => element.tagName === "IMG" && element.complete && element.naturalWidth > 20)
      .map((element) => element.currentSrc || element.src)
      .filter(Boolean);
  }

  // Compact, privacy-safe snapshot of the result area's structure. Logged by the
  // background so an exported run reveals which batch selectors actually match
  // on the live page and how result images are shaped — no prompt text, no full
  // image URLs.
  function batchDomProbe() {
    const countVisible = (selector) => deepQuerySelectorAll(selector).filter(isVisible).length;
    const resultImages = generateOutputElements().filter((element) => element.tagName === "IMG");
    const topImgs = resultImages
      .map((image) => {
        const rect = image.getBoundingClientRect();
        return {
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          top: Math.round(rect.top),
          loaded: Boolean(image.complete && image.naturalWidth > 20)
        };
      })
      .sort((a, b) => a.top - b.top)
      .slice(0, 6);

    return {
      batchGrid0: countVisible('[data-testid="batch-grid-0"]'),
      collapsible: countVisible("firefly-collapsible-batch-grid"),
      anyBatchTestid: countVisible('[data-testid*="batch" i]'),
      fireflyThumb: countVisible("firefly-thumbnail"),
      progress: countVisible("[role='progressbar'], progress, [aria-busy='true']"),
      bigImgCount: resultImages.length,
      topImgs
    };
  }

  function generateOutputElements() {
    const knownFireflyOutputs = FireflySelectors.OUTPUT_CONTAINER_SELECTORS
      .flatMap((selector) => deepQuerySelectorAll(selector))
      .filter(isVisible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width >= 110 && rect.height >= 90;
      });
    const largeImages = deepQuerySelectorAll("img")
      .filter(isVisible)
      .filter((image) => {
        const rect = image.getBoundingClientRect();
        return rect.width >= 140 && rect.height >= 100 && image.naturalWidth > 40 && image.naturalHeight > 40;
      });
    const canvases = deepQuerySelectorAll("canvas, video")
      .filter(isVisible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width >= 140 && rect.height >= 100;
      });
    const backgroundImages = deepQuerySelectorAll("div, article, section, a")
      .filter(isVisible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width < 140 || rect.height < 100) return false;
        const style = (element.ownerDocument.defaultView || window).getComputedStyle(element);
        return style.backgroundImage && style.backgroundImage !== "none" && /url\(/i.test(style.backgroundImage);
      });

    return uniqueElements([...knownFireflyOutputs, ...largeImages, ...canvases, ...backgroundImages]);
  }

  function generateSkeletonElements() {
    const explicit = deepQuerySelectorAll("[class*='skeleton' i], [class*='placeholder' i], [class*='shimmer' i], [data-testid*='skeleton' i], [data-testid*='loading' i]")
      .filter(isVisible);
    const blocks = deepQuerySelectorAll("div, article, section")
      .filter(isVisible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width < 140 || rect.height < 100 || rect.width * rect.height < 18000) return false;
        if (element.textContent.trim()) return false;
        if (deepQueryWithin(element, "img, canvas, video").some(isVisible)) return false;

        const style = (element.ownerDocument.defaultView || window).getComputedStyle(element);
        if (style.backgroundImage && style.backgroundImage !== "none" && /url\(/i.test(style.backgroundImage)) return false;
        return isGreyLike(style.backgroundColor) || /pulse|shimmer|skeleton|placeholder|loading/i.test(`${style.animationName} ${String(element.className || "")}`);
      });

    return uniqueElements([...explicit, ...blocks]);
  }

  function resultPromptSeen(prompt, visibleText) {
    const normalizedPrompt = normalizePrompt(prompt);
    const normalizedText = normalizePrompt(visibleText);
    if (!normalizedPrompt || !normalizedText) return false;

    if (normalizedText.includes(normalizedPrompt.slice(0, Math.min(80, normalizedPrompt.length)))) {
      return true;
    }

    const words = normalizedPrompt.split(" ").filter((word) => word.length >= 5).slice(0, 10);
    if (words.length < 4) return false;
    const hits = words.filter((word) => normalizedText.includes(word)).length;
    return hits >= Math.min(6, Math.ceil(words.length * 0.65));
  }

  function outputElementSignature(element) {
    const rect = element.getBoundingClientRect();
    if (element.tagName === "IMG") {
      return `${element.currentSrc || element.src}:${element.naturalWidth}x${element.naturalHeight}:${Math.round(rect.width)}x${Math.round(rect.height)}`;
    }

    const style = (element.ownerDocument.defaultView || window).getComputedStyle(element);
    return `${element.tagName}:${style.backgroundImage || ""}:${Math.round(rect.width)}x${Math.round(rect.height)}`;
  }

  function isFireflyHistoryPage() {
    return location.hostname === "firefly.adobe.com"
      && location.pathname.includes("/your-stuff")
      && location.search.includes("generationHistory");
  }

  function generationHistoryState() {
    const loadingCount = deepQuerySelectorAll("[aria-busy='true'], [role='progressbar'], progress, [class*='loading' i], [class*='spinner' i], [class*='progress' i]")
      .filter(isVisible)
      .length;
    const skeletonCount = historySkeletonElements().length;
    const outputCount = historyOutputElements().length;
    const visibleText = document.body ? document.body.innerText || "" : "";
    const errorText = historyErrorText(visibleText);

    return {
      loadingCount,
      skeletonCount,
      outputCount,
      errorText,
      textHash: simpleHash(visibleText.slice(0, 4000))
    };
  }

  function historySkeletonElements() {
    const explicit = deepQuerySelectorAll("[class*='skeleton' i], [class*='placeholder' i], [class*='shimmer' i], [data-testid*='skeleton' i], [data-testid*='loading' i]")
      .filter(isVisible);
    const visualBlocks = deepQuerySelectorAll("div, article, section")
      .filter(isVisible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width < 110 || rect.height < 90 || rect.width * rect.height < 14000) return false;
        if (element.textContent.trim()) return false;
        if (deepQueryWithin(element, "img, canvas, video").some(isVisible)) return false;

        const style = (element.ownerDocument.defaultView || window).getComputedStyle(element);
        if (style.backgroundImage && style.backgroundImage !== "none" && /url\(/i.test(style.backgroundImage)) return false;
        return isGreyLike(style.backgroundColor) || /pulse|shimmer|skeleton|placeholder|loading/i.test(`${style.animationName} ${String(element.className || "")}`);
      });

    return uniqueElements([...explicit, ...visualBlocks]);
  }

  function historyOutputElements() {
    const largeImages = deepQuerySelectorAll("img")
      .filter(isVisible)
      .filter((image) => {
        const rect = image.getBoundingClientRect();
        return rect.width >= 110 && rect.height >= 90 && image.naturalWidth > 20 && image.naturalHeight > 20;
      });
    const largeCanvases = deepQuerySelectorAll("canvas, video")
      .filter(isVisible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width >= 110 && rect.height >= 90;
      });
    const backgroundImages = deepQuerySelectorAll("div, article, section, a")
      .filter(isVisible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width < 110 || rect.height < 90) return false;
        const style = (element.ownerDocument.defaultView || window).getComputedStyle(element);
        return style.backgroundImage && style.backgroundImage !== "none" && /url\(/i.test(style.backgroundImage);
      });

    return uniqueElements([...largeImages, ...largeCanvases, ...backgroundImages]);
  }

  function historyErrorText(text) {
    return GenerationResult.pageErrorText(text);
  }

  function findBlockingError() {
    const alerts = deepQuerySelectorAll("[role='alert'], [aria-live='assertive'], [class*='error' i]")
      .filter(isVisible)
      .map((element) => element.textContent.trim())
      .filter(Boolean);

    const message = GenerationResult.blockingErrorFromTexts(alerts);
    return message ? truncate(message, 160) : "";
  }

  // --- Single-ZIP capture -------------------------------------------------
  // When ZIP mode is on, Firefly's own download button is still clicked, but a
  // capture-phase click hook diverts the resulting <a download> so the image
  // bytes are fetched and stashed in IndexedDB (which survives the long-run tab
  // refresh) instead of saving each file to disk. At run end the background
  // sends FINALIZE_ZIP and these are packed into one archive.
  const ZIP_DB_NAME = "nuii-autofly";
  const ZIP_DB_VERSION = 1;
  const ZIP_IMAGES_STORE = "images";
  const ZIP_META_STORE = "meta";

  const zipState = {
    hookInstalled: false,
    active: false,
    runId: null,
    pending: []
  };

  function openZipDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(ZIP_DB_NAME, ZIP_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ZIP_IMAGES_STORE)) {
          const store = db.createObjectStore(ZIP_IMAGES_STORE, { keyPath: "id", autoIncrement: true });
          store.createIndex("runId", "runId", { unique: false });
        }
        if (!db.objectStoreNames.contains(ZIP_META_STORE)) {
          db.createObjectStore(ZIP_META_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
    });
  }

  function idbRequest(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB request failed"));
    });
  }

  async function idbGetMeta(key) {
    const db = await openZipDb();
    try {
      const tx = db.transaction(ZIP_META_STORE, "readonly");
      const record = await idbRequest(tx.objectStore(ZIP_META_STORE).get(key));
      return record ? record.value : null;
    } finally {
      db.close();
    }
  }

  async function idbSetMeta(key, value) {
    const db = await openZipDb();
    try {
      const tx = db.transaction(ZIP_META_STORE, "readwrite");
      await idbRequest(tx.objectStore(ZIP_META_STORE).put({ key, value }));
    } finally {
      db.close();
    }
  }

  async function idbClearImages() {
    const db = await openZipDb();
    try {
      const tx = db.transaction(ZIP_IMAGES_STORE, "readwrite");
      await idbRequest(tx.objectStore(ZIP_IMAGES_STORE).clear());
    } finally {
      db.close();
    }
  }

  async function idbPutImage(record) {
    const db = await openZipDb();
    try {
      const tx = db.transaction(ZIP_IMAGES_STORE, "readwrite");
      await idbRequest(tx.objectStore(ZIP_IMAGES_STORE).add(record));
    } finally {
      db.close();
    }
  }

  async function idbGetImagesByRun(runId) {
    const db = await openZipDb();
    try {
      const tx = db.transaction(ZIP_IMAGES_STORE, "readonly");
      const index = tx.objectStore(ZIP_IMAGES_STORE).index("runId");
      const records = await idbRequest(index.getAll(runId));
      return records || [];
    } finally {
      db.close();
    }
  }

  // Start (or continue) a run's capture set. A changed runId clears any leftover
  // images from a prior run. The marker lives in IndexedDB, not memory, so the
  // mid-run tab refresh (which re-injects this script) does not wipe the run.
  async function ensureZipRun(runId) {
    if (!runId) return;
    if (zipState.runId !== runId) {
      const stored = await idbGetMeta("currentRunId");
      if (stored !== runId) {
        await idbClearImages();
        await idbSetMeta("currentRunId", runId);
      }
      zipState.runId = runId;
    }
  }

  function anchorFromEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      if (node && node.tagName === "A") return node;
    }
    return event.target && event.target.closest ? event.target.closest("a") : null;
  }

  function isCapturableAnchor(anchor) {
    if (!anchor) return false;
    if (anchor.hasAttribute("data-nuii-zip")) return false; // our own ZIP download
    const href = anchor.getAttribute("href") || anchor.href || "";
    if (!href || /^javascript:/i.test(href)) return false;
    const hasDownload = anchor.hasAttribute("download");
    const looksDownloadable = /^(blob:|data:|https?:)/i.test(href);
    return hasDownload || looksDownloadable;
  }

  function installDownloadHook() {
    if (zipState.hookInstalled) return;
    document.addEventListener("click", onDownloadClickCapture, true);
    zipState.hookInstalled = true;
  }

  function onDownloadClickCapture(event) {
    if (!zipState.active) return;
    const anchor = anchorFromEvent(event);
    if (!isCapturableAnchor(anchor)) return;

    const href = anchor.href || anchor.getAttribute("href");
    const downloadName = anchor.getAttribute("download") || "";

    // Divert Firefly's own download: cancel the default action so the file does
    // not hit disk, then stash its bytes for the run-end ZIP. Propagation is
    // left intact so Firefly's own click handlers still run normally.
    event.preventDefault();
    zipState.pending.push(captureDownload(href, downloadName));
  }

  async function captureDownload(href, downloadName) {
    try {
      const runId = zipState.runId;
      if (!runId) return false;
      const response = await fetch(href, { credentials: "include" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const type = blob.type || "";
      const name = ZipCapture.sanitizeEntryName(downloadName, "image" + ZipCapture.extensionFromMime(type));
      await idbPutImage({ runId, name, type, blob });
      console.log(`[Nuii AutoFly] Captured image for ZIP: ${name} (${blob.size} bytes)`);
      return true;
    } catch (error) {
      console.warn("[Nuii AutoFly] ZIP capture failed:", error && error.message);
      return false;
    }
  }

  function zipTimestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return (
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    );
  }

  function triggerZipDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.setAttribute("data-nuii-zip", "1");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 4000);
  }

  async function finalizeZip(runId) {
    zipState.active = false;
    const targetRun = runId || zipState.runId;
    const records = await idbGetImagesByRun(targetRun);
    if (!records.length) {
      return { success: true, count: 0 };
    }

    const names = ZipCapture.dedupeEntryNames(
      records.map((record, index) =>
        ZipCapture.sanitizeEntryName(
          record.name,
          `image-${String(index + 1).padStart(3, "0")}${ZipCapture.extensionFromMime(record.type)}`
        )
      )
    );

    const entries = [];
    for (let i = 0; i < records.length; i += 1) {
      const buffer = await records[i].blob.arrayBuffer();
      entries.push({ name: names[i], data: new Uint8Array(buffer) });
    }

    const zipBytes = ZipWriter.buildZip(entries);
    const blob = new Blob([zipBytes], { type: "application/zip" });
    const filename = `nuii-autofly-${zipTimestamp()}.zip`;
    triggerZipDownload(blob, filename);
    await idbClearImages();

    return { success: true, count: entries.length, filename };
  }

  async function clickDownloadButtons(limit, settings) {
    const opts = settings || {};
    const zipMode = Boolean(opts.autoDownload && opts.zipDownload);
    const DownloadButtons = globalThis.NuiiContentDownloads;
    // The newest batch is inserted at the top of the results feed, so ordering
    // download controls top-first and capping to this prompt's image count
    // targets the current batch and skips older batches still on the page.
    // An unknown count resolves to 0: better to skip than re-download old work.
    const max = DownloadButtons.resolveDownloadLimit(limit);
    if (!max) return 0;

    zipState.active = zipMode;
    if (zipMode) {
      await ensureZipRun(opts.runId);
      installDownloadHook();
      zipState.pending = [];
    }

    await sleep(1200);
    const buttons = DownloadButtons.filterDownloadCandidates(
      deepQuerySelectorAll("button, [role='button'], a, sp-button")
        .filter(isVisible)
        .filter((element) => !isDisabled(element))
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
        .map((element) => ({
          element,
          descriptor: {
            label: elementLabel(element),
            tagName: element.tagName,
            hasDownloadAttr: Boolean(element.hasAttribute && element.hasAttribute("download")),
            inNavigation: Boolean(element.closest && element.closest("nav, header, footer, [role='navigation'], [aria-label*='navigation' i]"))
          }
        })),
      max
    );

    for (const item of buttons) {
      clickElement(item.element);
      await sleep(450);
    }

    if (zipMode) {
      // Give Firefly time to create and click its download anchors so the hook
      // can intercept them, then wait for every fetch + IndexedDB write.
      await sleep(2500);
      const results = await Promise.allSettled(zipState.pending);
      zipState.pending = [];
      return results.filter((result) => result.status === "fulfilled" && result.value).length;
    }

    return buttons.length;
  }

  async function preferGridView() {
    const button = firstVisible(FireflySelectors.GRID_VIEW_SELECTORS.flatMap((selector) => deepQuerySelectorAll(selector)));
    if (!button) return false;
    clickElement(button);
    await sleep(500);
    return true;
  }

  function clickElement(element) {
    if (!element || !element.scrollIntoView) return;
    const view = element.ownerDocument.defaultView || window;
    const Pointer = view.PointerEvent || view.MouseEvent;
    element.scrollIntoView({ block: "center", inline: "nearest" });
    element.dispatchEvent(new Pointer("pointerdown", { bubbles: true }));
    element.dispatchEvent(new view.MouseEvent("mousedown", { bubbles: true }));
    element.dispatchEvent(new Pointer("pointerup", { bubbles: true }));
    element.dispatchEvent(new view.MouseEvent("mouseup", { bubbles: true }));
    element.click();
  }

  function elementRect(element) {
    const rect = element.getBoundingClientRect();
    const offset = frameOffset(element.ownerDocument);
    return {
      x: rect.x + offset.x,
      y: rect.y + offset.y,
      width: rect.width,
      height: rect.height,
      centerX: rect.x + offset.x + rect.width / 2,
      centerY: rect.y + offset.y + rect.height / 2
    };
  }

  function frameOffset(ownerDocument) {
    let x = 0;
    let y = 0;
    let currentDocument = ownerDocument;

    while (currentDocument && currentDocument !== document) {
      const frame = currentDocument.defaultView && currentDocument.defaultView.frameElement;
      if (!frame) break;
      const rect = frame.getBoundingClientRect();
      x += rect.x;
      y += rect.y;
      currentDocument = frame.ownerDocument;
    }

    return { x, y };
  }

  function firstVisible(elements) {
    const match = elements.find((element) => isVisible(element) && !isDisabled(element)) || null;
    return editableTarget(match) || match;
  }

  function isVisible(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    const view = element.ownerDocument.defaultView || window;
    const style = view.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden"
      && style.display !== "none"
      && Number(style.opacity) !== 0
      && rect.width > 2
      && rect.height > 2;
  }

  function isDisabled(element) {
    return Boolean(element.disabled)
      || element.getAttribute("aria-disabled") === "true"
      || element.closest("[aria-disabled='true']");
  }

  function elementLabel(element) {
    return [
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-test-id"),
      element.getAttribute("class"),
      element.shadowRoot ? element.shadowRoot.textContent : ""
    ].filter(Boolean).join(" ").trim();
  }

  function editableTarget(element) {
    if (!element) return null;
    if (isTextEntryElement(element) || element.isContentEditable) {
      return element;
    }

    if (element.shadowRoot) {
      const inner = ["textarea", "input", "[contenteditable='true']", "[role='textbox']"]
        .flatMap((selector) => Array.from(element.shadowRoot.querySelectorAll(selector)))
        .find((candidate) => isVisible(candidate) && !isDisabled(candidate));
      if (inner) return inner;
    }

    const nested = ["textarea", "input", "[contenteditable='true']", "[role='textbox']"]
      .flatMap((selector) => Array.from(element.querySelectorAll(selector)))
      .find((candidate) => isVisible(candidate) && !isDisabled(candidate));

    return nested || element;
  }

  function isTextEntryElement(element) {
    return element && (element.tagName === "TEXTAREA" || element.tagName === "INPUT");
  }

  // Discovering shadow roots and iframes requires walking every element, which
  // is the expensive part of deep queries. One page-state computation issues
  // many deep queries back to back, so the discovered roots are cached briefly
  // and shared between them instead of re-walking the DOM per query.
  let deepRootsCache = { time: 0, roots: null };

  function collectDocumentRoots() {
    const now = Date.now();
    if (deepRootsCache.roots && now - deepRootsCache.time < 400) {
      return deepRootsCache.roots;
    }

    const roots = [document];
    const visited = new Set();

    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index];
      if (!root || visited.has(root)) continue;
      visited.add(root);

      safeQueryAll(root, "*").forEach((element) => {
        if (element.shadowRoot && !visited.has(element.shadowRoot)) {
          roots.push(element.shadowRoot);
        }

        if (element.tagName === "IFRAME") {
          try {
            if (element.contentDocument && !visited.has(element.contentDocument)) {
              roots.push(element.contentDocument);
            }
          } catch (error) {
            // Cross-origin frames are intentionally inaccessible.
          }
        }
      });
    }

    deepRootsCache = { time: now, roots };
    return roots;
  }

  function deepQuerySelectorAll(selector) {
    const results = [];

    for (const root of collectDocumentRoots()) {
      try {
        results.push(...Array.from(root.querySelectorAll(selector)));
      } catch (error) {
        // Ignore unsupported selectors in older embedded contexts.
      }
    }

    return uniqueElements(results);
  }

  function deepQueryWithin(rootElement, selector) {
    const results = [];
    const roots = [rootElement];
    const visited = new Set();

    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index];
      if (!root || visited.has(root)) continue;
      visited.add(root);
      results.push(...safeQueryAll(root, selector));

      safeQueryAll(root, "*").forEach((element) => {
        if (element.shadowRoot && !visited.has(element.shadowRoot)) {
          roots.push(element.shadowRoot);
        }
      });
    }

    return uniqueElements(results);
  }

  function safeQueryAll(root, selector) {
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch (error) {
      return [];
    }
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements));
  }

  function isGreyLike(color) {
    const match = String(color || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
    if (!match) return false;

    const red = Number(match[1]);
    const green = Number(match[2]);
    const blue = Number(match[3]);
    const alpha = match[4] === undefined ? 1 : Number(match[4]);
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);

    return alpha > 0.2 && max - min <= 18 && max >= 170 && max <= 245;
  }

  function simpleHash(text) {
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    return String(hash);
  }

  function normalizePrompt(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .trim();
  }

  function getDiagnostics() {
    const promptInput = findPromptInput();
    const generateButton = findGenerateButton();
    return {
      promptInputFound: Boolean(promptInput),
      promptInputTag: promptInput ? promptInput.tagName : "",
      generateButtonFound: Boolean(generateButton),
      generateButtonLabel: generateButton ? truncate(elementLabel(generateButton), 80) : "",
      editableCount: deepQuerySelectorAll("textarea, input, [contenteditable='true'], [role='textbox'], sp-textfield, sp-textarea").length,
      buttonCount: deepQuerySelectorAll("button, [role='button'], sp-button, a").length
    };
  }

  function waitFor(check, timeout, interval) {
    const startedAt = Date.now();
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        const result = check();
        if (result) {
          clearInterval(timer);
          resolve(result);
          return;
        }

        if (Date.now() - startedAt >= timeout) {
          clearInterval(timer);
          resolve(null);
        }
      }, interval);
    });
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function truncate(value, length) {
    const text = String(value || "");
    return text.length > length ? `${text.slice(0, length - 1)}...` : text;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
