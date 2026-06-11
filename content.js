(() => {
  if (globalThis.__NUII_AUTOFLY_CONTENT_READY__) {
    return;
  }

  globalThis.__NUII_AUTOFLY_CONTENT_READY__ = true;
  console.log("[Nuii AutoFly] Content automation ready.");
  const FireflySelectors = globalThis.NuiiContentSelectors;
  const GenerationResult = globalThis.NuiiContentGeneration;
  const PromptControl = globalThis.NuiiContentPrompt;

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
      submitPrompt(request.prompt)
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

    return false;
  });

  async function submitPrompt(prompt) {
    const startedAt = Date.now();
    await preferGridView();
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
      elapsedMs: Date.now() - startedAt,
      error: ""
    };
  }

  async function waitForExistingResult(prompt, settings) {
    const timeout = clamp(Number(settings.timeout) || 240, 60, 600) * 1000;
    const autoDownload = Boolean(settings.autoDownload);
    const startedAt = Date.now();
    const beforeState = settings.baselineState || generatePageState(prompt);
    const result = await waitForGeneration({
      prompt,
      timeout,
      startedAt,
      beforeState
    });

    let downloads = 0;
    if (result.success && autoDownload) {
      downloads = await clickDownloadButtons();
    }

    if (result.success) {
      clearPromptValue();
      await waitFor(() => !PromptControl.normalizePromptValue(getPromptValue()), 2000, 150);
    }

    return {
      success: result.success,
      warning: result.warning || "",
      stage: result.stage || "",
      finalState: result.finalState || null,
      downloads,
      elapsedMs: Date.now() - startedAt,
      error: result.error || ""
    };
  }

  async function waitForHistoryResult(prompt, settings) {
    const timeout = clamp(Number(settings.timeout) || 240, 60, 600) * 1000;
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
          downloads = await clickDownloadButtons();
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

    return { success: false, error: "Timed out waiting for History page result" };
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
    let lastStableKey = "";

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

      if (state.errorText) {
        return { success: false, error: state.errorText };
      }

      const settled = GenerationResult.isGenerateResultSettled(
        state,
        beforeState,
        stableTicks,
        Date.now() - startedAt,
        { busy, sawBusy, sawChange }
      );

      if (settled.complete) {
        return {
          success: true,
          stage: settled.stage,
          warning: settled.warning,
          finalState: state
        };
      }
    }

    if (sawChange) {
      return { success: false, error: "Timed out before Generate page output settled" };
    }

    return { success: false, error: "Timed out waiting for Generate page output" };
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
    const button = findGenerateButton();
    const promptValue = getPromptValue();

    return {
      loadingCount,
      skeletonCount,
      outputCount: outputs.length,
      outputSignature,
      promptSeen: resultPromptSeen(prompt, visibleText),
      promptValue,
      generateButtonFound: Boolean(button),
      generateButtonDisabled: button ? isDisabled(button) : false,
      generateButtonLabel: button ? truncate(elementLabel(button), 80) : "",
      errorText: historyErrorText(visibleText),
      key: `${loadingCount}:${skeletonCount}:${outputs.length}:${outputSignature}:${promptValue}:${button ? isDisabled(button) : "none"}:${simpleHash(visibleText.slice(0, 5000))}`
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

  function tryReturnToGeneratePage() {
    try {
      window.history.back();
    } catch (error) {
      // The background script also guards this route.
    }
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
    const match = text.match(/(prompt declined|unable to generate|generation failed|try again|content policy|quota|limit|error)[^\n]{0,120}/i);
    return match ? match[0] : "";
  }

  function isPageBusy() {
    const buttons = deepQuerySelectorAll("button, [role='button'], sp-button");
    const busyButton = buttons.some((button) => {
      const label = elementLabel(button);
      return isVisible(button) && (
        button.disabled ||
        button.getAttribute("aria-disabled") === "true" ||
        button.getAttribute("aria-busy") === "true" ||
        /generating|loading|cancel|stop|processing|in progress/i.test(label)
      );
    });

    const busyIndicators = deepQuerySelectorAll("[aria-busy='true'], [role='progressbar'], progress, .spinner, [class*='loading' i], [class*='spinner' i]");
    return busyButton || busyIndicators.some(isVisible);
  }

  function pageFingerprint() {
    const images = deepQuerySelectorAll("img")
      .filter(isVisible)
      .map((image) => `${image.currentSrc || image.src}:${image.naturalWidth}x${image.naturalHeight}`)
      .join("|");
    const canvases = deepQuerySelectorAll("canvas")
      .filter(isVisible)
      .map((canvas) => `${canvas.width}x${canvas.height}`)
      .join("|");
    const resultNodes = deepQuerySelectorAll("[data-testid*='image' i], [aria-label*='image' i], [class*='result' i]")
      .filter(isVisible).length;

    return `${images}|${canvases}|${resultNodes}`;
  }

  function findBlockingError() {
    const alerts = deepQuerySelectorAll("[role='alert'], [aria-live='assertive'], [class*='error' i]")
      .filter(isVisible)
      .map((element) => element.textContent.trim())
      .filter(Boolean);

    const message = GenerationResult.blockingErrorFromTexts(alerts);
    return message ? truncate(message, 160) : "";
  }

  async function clickDownloadButtons() {
    await sleep(1200);
    const buttons = deepQuerySelectorAll("button, [role='button'], a, sp-button")
      .filter(isVisible)
      .filter((element) => !isDisabled(element))
      .filter((element) => /download/i.test(elementLabel(element)))
      .slice(0, 6);

    for (const button of buttons) {
      clickElement(button);
      await sleep(450);
    }

    return buttons.length;
  }

  async function preferGridView() {
    const safeGridSelectors = FireflySelectors.GRID_VIEW_SELECTORS
      .filter((selector) => !/history/i.test(selector));
    const button = firstVisible(safeGridSelectors.flatMap((selector) => deepQuerySelectorAll(selector)));
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

  function deepQuerySelectorAll(selector) {
    const results = [];
    const visited = new Set();
    const roots = [document];

    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index];
      if (!root || visited.has(root)) continue;
      visited.add(root);

      try {
        results.push(...Array.from(root.querySelectorAll(selector)));
      } catch (error) {
        // Ignore unsupported selectors in older embedded contexts.
      }

      const allElements = safeQueryAll(root, "*");
      allElements.forEach((element) => {
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
