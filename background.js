importScripts(
  "src/shared/text.js",
  "src/shared/settings.js",
  "src/shared/message.js",
  "src/background/route-policy.js",
  "src/background/queue-state.js",
  "src/background/start-strategy.js"
);

const STORAGE_KEY = "nuiiAutoflyState";
const LOG_LIMIT = 80;
// Reload the Firefly tab after this many Generate clicks (and once at run
// start) so the results feed stays small enough for reliable detection.
const FIREFLY_REFRESH_EVERY = 10;

const DEFAULT_SETTINGS = globalThis.NuiiShared.DEFAULT_SETTINGS;
const RoutePolicy = globalThis.NuiiBackgroundRoutePolicy;
const QueueState = globalThis.NuiiBackgroundQueueState;
const StartStrategy = globalThis.NuiiBackgroundStartStrategy;
const normalizeTabMessageResponse = globalThis.NuiiShared.normalizeTabMessageResponse;

const DEFAULT_STATE = {
  status: "Idle",
  queue: [],
  settings: DEFAULT_SETTINGS,
  targetTabId: null,
  targetUrl: "",
  targetTitle: "",
  currentPrompt: "",
  currentItemId: null,
  waitingForResult: false,
  promptsSinceRefresh: 0,
  runId: null,
  startedAt: null,
  finishedAt: null,
  lastError: "",
  logs: []
};

let appState = clone(DEFAULT_STATE);
let stateReady = loadState();
let queueLoopRunning = false;
let stopRequested = false;
let lastHistoryRedirectAt = 0;
let keepAliveTimer = null;

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!shouldGuardFireflyTab(tabId)) return;
  const nextUrl = changeInfo.url || tab.url || "";
  if (!isFireflyHistoryUrl(nextUrl)) return;

  const now = Date.now();
  if (now - lastHistoryRedirectAt < 1500) return;
  lastHistoryRedirectAt = now;

  chrome.tabs.update(tabId, { url: "https://firefly.adobe.com/generate/image" })
    .then(() => keepTabAwake(tabId))
    .catch(() => {});
  addLog("Returned Firefly to Generate");
  saveAndBroadcast();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    await stateReady;

    if (request.action === "GET_STATE") {
      sendResponse({ success: true, state: publicState() });
      return;
    }

    if (request.action === "START_PROCESSING") {
      const started = startProcessing(request);
      sendResponse({ ...started, state: publicState() });
      return;
    }

    if (request.action === "PAUSE_PROCESSING") {
      pauseProcessing();
      sendResponse({ success: true, state: publicState() });
      return;
    }

    if (request.action === "RESUME_PROCESSING") {
      resumeProcessing();
      sendResponse({ success: true, state: publicState() });
      return;
    }

    if (request.action === "STOP_PROCESSING") {
      stopProcessing();
      sendResponse({ success: true, state: publicState() });
      return;
    }

    sendResponse({ success: false, error: "Unknown action" });
  })().catch((error) => {
    console.error("[Nuii AutoFly] Message error:", error);
    sendResponse({ success: false, error: error.message });
  });

  return true;
});

function startProcessing(request) {
  if (appState.status === "Running") {
    return { success: false, error: "A run is already in progress. Stop or pause it before starting a new one." };
  }

  const prompts = Array.isArray(request.prompts) ? request.prompts : [];
  const requestItems = Array.isArray(request.items) && request.items.length
    ? request.items
    : prompts.map((prompt) => ({ prompt, sourcePrompt: prompt }));
  const settings = sanitizeSettings(request.settings || {});

  appState = {
    ...clone(DEFAULT_STATE),
    status: "Running",
    queue: requestItems.map((item, index) => ({
      id: `${Date.now()}-${index}`,
      prompt: String(item.prompt || "").trim(),
      sourcePrompt: String(item.sourcePrompt || item.prompt || "").trim(),
      status: "pending",
      attempts: 0,
      error: "",
      startedAt: null,
      finishedAt: null
    })),
    settings,
    targetTabId: request.targetTabId || null,
    targetUrl: request.targetUrl || "",
    targetTitle: request.targetTitle || "",
    // Seed at the threshold so the first prompt refreshes the page, clearing
    // any batches left over from a previous run on the same tab.
    promptsSinceRefresh: FIREFLY_REFRESH_EVERY,
    runId: String(Date.now()),
    startedAt: Date.now(),
    logs: []
  };

  stopRequested = false;
  startWorkerKeepAlive();
  addLog(`Loaded ${requestItems.length} prompts`);
  saveAndBroadcast();
  processQueue();
  return { success: true };
}

function pauseProcessing() {
  if (appState.status !== "Running") return;
  appState.status = "Paused";
  appState.waitingForResult = false;
  stopWorkerKeepAlive();
  addLog("Pause requested");
  saveAndBroadcast();
}

function resumeProcessing() {
  if (appState.status !== "Paused") return;
  appState.status = "Running";
  stopRequested = false;
  startWorkerKeepAlive();
  addLog("Resumed queue");
  saveAndBroadcast();
  processQueue();
}

function stopProcessing() {
  stopRequested = true;
  if (appState.currentItemId) {
    const active = appState.queue.find((item) => item.id === appState.currentItemId);
    if (active && active.status === "running") {
      active.status = "pending";
      active.error = "Stopped by user";
    }
  }
  appState.status = "Stopped";
  appState.currentPrompt = "";
  appState.currentItemId = null;
  appState.waitingForResult = false;
  appState.finishedAt = Date.now();
  stopWorkerKeepAlive();
  addLog("Stopped queue");
  saveAndBroadcast();
}

async function processQueue() {
  if (queueLoopRunning) return;
  queueLoopRunning = true;

  try {
    while (appState.status === "Running" && !stopRequested) {
      const item = nextQueueItem();

      if (!item) {
        appState.status = "Complete";
        appState.currentPrompt = "";
        appState.currentItemId = null;
        appState.waitingForResult = false;
        appState.finishedAt = Date.now();
        stopWorkerKeepAlive();
        addLog("Queue complete");
        addRunSummary();
        await saveAndBroadcast();
        await playCompletionSound("complete");
        break;
      }

      item.status = "running";
      item.attempts += 1;
      item.startedAt = Date.now();
      item.submittedAt = null;
      item.error = "";
      appState.currentPrompt = item.prompt;
      appState.currentItemId = item.id;
      appState.lastError = "";
      addLog(`Running prompt ${positionOf(item)} of ${appState.queue.length}`);
      await saveAndBroadcast();

      const response = await runPrompt(item);
      appState.promptsSinceRefresh += 1;

      if (appState.status !== "Running" || stopRequested) {
        if (item.status === "running") item.status = "pending";
        await saveAndBroadcast();
        break;
      }

      const transition = QueueState.applyPromptResultToItem(item, appState, response);

      if (transition.action === "done") {
        addLog(`Done: ${truncate(item.prompt, 52)}`);
        if (response.route) addLog(`Completed on ${response.route}`);
        if (response.stage) addLog(`Complete stage: ${response.stage}${response.finalState ? ` (${response.finalState.outputCount} outputs)` : ""}`);
        if (response.warning) addLog(`Notice: ${response.warning}`);
        if (transition.warning) addLog(`Notice: ${transition.warning}`);
        if (response.diag) addWaitDiagnostics(response.diag);
        if (appState.settings.autoDownload && response.downloads) {
          addLog(`Downloaded ${response.downloads} image${response.downloads > 1 ? "s" : ""}`);
        }
      } else if (transition.action === "retry") {
        addLog(`Retry ${item.attempts}/${appState.settings.retryLimit}: ${item.error}`);
      } else {
        addLog(`Failed: ${item.error}`);

        if (!appState.settings.continueOnError) {
          appState.status = "Error";
          appState.currentPrompt = "";
          appState.currentItemId = null;
          appState.waitingForResult = false;
          appState.finishedAt = Date.now();
          stopWorkerKeepAlive();
          await saveAndBroadcast();
          await playCompletionSound("error");
          break;
        }
      }

      appState.currentPrompt = "";
      appState.currentItemId = null;
      await saveAndBroadcast();

      if (appState.status === "Running" && hasPendingWork()) {
        await delay(appState.settings.delay * 1000);
      }
    }
  } catch (error) {
    appState.status = "Error";
    appState.lastError = error.message;
    appState.currentPrompt = "";
    appState.currentItemId = null;
    appState.waitingForResult = false;
    appState.finishedAt = Date.now();
    stopWorkerKeepAlive();
    addLog(`Error: ${error.message}`);
    await saveAndBroadcast();
    await playCompletionSound("error");
  } finally {
    queueLoopRunning = false;
    if (appState.status !== "Running") {
      stopWorkerKeepAlive();
    }
  }
}

function nextQueueItem() {
  return appState.queue.find((item) => item.status === "pending");
}

function hasPendingWork() {
  return appState.queue.some((item) => item.status === "pending");
}

async function runPrompt(item) {
  const prompt = item.prompt;
  const tabId = await resolveTargetTabId();
  if (!tabId) {
    return { success: false, error: "No target tab found" };
  }

  if (appState.settings.platform === "firefly") {
    await keepTabAwake(tabId);

    if (RoutePolicy.shouldRefreshFireflyPage({
      platform: appState.settings.platform,
      promptsSinceRefresh: appState.promptsSinceRefresh,
      refreshEvery: FIREFLY_REFRESH_EVERY
    })) {
      const refreshed = await refreshFireflyTab(tabId);
      if (refreshed) {
        appState.promptsSinceRefresh = 0;
        addLog("Refreshed Firefly page to keep result detection reliable");
        await saveAndBroadcast();
      }
    }

    const navigation = await navigateToFireflyGenerate(tabId);
    if (!navigation.success) return navigation;
  }

  const ready = await ensureContentReady(tabId);
  if (!ready.success) return ready;

  const submitResponse = await sendTabMessage(tabId, {
    action: "SUBMIT_PROMPT",
    prompt,
    settings: {
      timeout: appState.settings.timeout,
      autoDownload: appState.settings.autoDownload,
      platform: appState.settings.platform
    }
  });

  if (!submitResponse.success) {
    const tab = await safeGetTab(tabId);
    const likelySubmitted = shouldRecoverWaitError(submitResponse.error) || (tab && isFireflyHistoryUrl(tab.url || ""));
    if (!likelySubmitted) {
      return submitResponse;
    }
  } else {
    const clickResponse = await startGenerationWithFallbacks(tabId, prompt, submitResponse);
    if (!clickResponse.success) return clickResponse;
    if (clickResponse.stage) addLog(`Generation ${clickResponse.stage}`);
  }

  const submittedAt = Date.now();
  item.submittedAt = submittedAt;
  addLog(`Clicked Generate: ${truncate(prompt, 52)}`);
  appState.waitingForResult = true;
  await saveAndBroadcast();

  try {
    return await waitForSubmittedPrompt(tabId, prompt, submittedAt, submitResponse.state || null);
  } finally {
    appState.waitingForResult = false;
    await saveAndBroadcast();
  }
}

async function startGenerationWithFallbacks(tabId, prompt, submitResponse) {
  const baseline = submitResponse.state || null;
  const candidates = normalizeGenerateCandidates(submitResponse);
  const plan = StartStrategy.buildStartMethodPlan({
    candidateCount: candidates.length,
    allowKeyboard: true
  });

  await sendTabMessage(tabId, { action: "FOCUS_PROMPT" });

  for (const step of plan) {
    if (step.kind === "dom-click") {
      const clickResponse = await sendTabMessage(tabId, { action: "CLICK_GENERATE_DOM" });
      if (!clickResponse.success) {
        addLog("DOM click failed");
        continue;
      }

      const started = await waitForGenerationStart(tabId, prompt, baseline, step.verifyTimeoutMs);
      if (started.success) return started;
      addLog("DOM click did not start generation");
      continue;
    }

    if (step.kind === "cdp-click") {
      const candidate = candidates[step.candidateIndex];
      if (!candidate) continue;

      const clickResponse = await clickGenerateButton(tabId, candidate.rect);
      if (!clickResponse.success) {
        addLog(`Click attempt ${step.candidateIndex + 1} failed`);
        continue;
      }

      const started = await waitForGenerationStart(tabId, prompt, baseline, step.verifyTimeoutMs);
      if (started.success) return started;
      addLog(`Click attempt ${step.candidateIndex + 1} did not start: ${truncate(candidate.label || "button", 28)}`);
      continue;
    }

    if (step.kind === "keyboard") {
      const keyboardResponse = await sendGenerateKeyboardShortcut(tabId);
      if (!keyboardResponse.success) {
        addLog("Keyboard submit failed");
        continue;
      }

      const started = await waitForGenerationStart(tabId, prompt, baseline, step.verifyTimeoutMs);
      if (started.success) return started;
      addLog("Keyboard submit did not start generation");
    }
  }

  return {
    success: false,
    error: "Generate button did not start after DOM, click, and keyboard attempts"
  };
}

function normalizeGenerateCandidates(submitResponse) {
  const candidates = Array.isArray(submitResponse.generateButtons)
    ? submitResponse.generateButtons
    : [];

  if (submitResponse.generateButton) {
    candidates.unshift({
      score: 999,
      label: "primary",
      rect: submitResponse.generateButton
    });
  }

  const seen = new Set();
  return candidates
    .filter((candidate) => candidate && candidate.rect)
    .filter((candidate) => {
      const key = `${Math.round(candidate.rect.centerX)}:${Math.round(candidate.rect.centerY)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

async function waitForGenerationStart(tabId, prompt, baseline, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await delay(500);

    const tab = await safeGetTab(tabId);
    if (!tab) return { success: false, error: "Target Firefly tab closed" };
    if (isFireflyHistoryUrl(tab.url || "")) {
      return { success: true, stage: "started-history" };
    }

    const response = await sendTabMessage(tabId, {
      action: "GET_GENERATION_STATE",
      prompt
    });

    if (!response.success) {
      if (shouldRecoverWaitError(response.error)) {
        return { success: true, stage: "started-navigation" };
      }
      continue;
    }

    if (generationAppearsStarted(response.state, baseline)) {
      return { success: true, stage: "started-generate" };
    }
  }

  return { success: false, error: "Generation did not start" };
}

function generationAppearsStarted(state, baseline) {
  if (!state) return false;
  if (state.loadingCount > 0 || state.skeletonCount > 0) return true;
  if (state.generateButtonFound && state.generateButtonDisabled) return true;

  const promptStillInBox = baseline
    && baseline.promptValue
    && state.promptValue
    && normalizeText(state.promptValue).includes(normalizeText(baseline.promptValue).slice(0, 60));

  if (promptStillInBox && state.generateButtonFound && !state.generateButtonDisabled && !state.loadingCount && !state.skeletonCount) {
    return false;
  }

  if (baseline && state.outputCount > baseline.outputCount && (state.loadingCount > 0 || state.skeletonCount > 0 || state.generateButtonDisabled)) {
    return true;
  }

  return false;
}

async function clickGenerateButton(tabId, rect) {
  if (!rect || !Number.isFinite(rect.centerX) || !Number.isFinite(rect.centerY)) {
    return { success: false, error: "Generate button coordinates not found" };
  }

  const point = {
    x: Math.round(rect.centerX),
    y: Math.round(rect.centerY)
  };

  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button: "none"
    });
    await delay(80);
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      clickCount: 1
    });
    await delay(90);
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 0,
      clickCount: 1
    });
    await delay(500);
    return { success: true };
  } catch (error) {
    return { success: false, error: `Debugger click failed: ${error.message}` };
  } finally {
    try {
      await chrome.debugger.detach({ tabId });
    } catch (error) {
      // It may already be detached.
    }
  }
}

async function sendGenerateKeyboardShortcut(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await sendKey(tabId, "Enter", "Enter", 13, { ctrl: true });
    await delay(300);
    await sendKey(tabId, "Enter", "Enter", 13, {});
    await delay(500);
    return { success: true };
  } catch (error) {
    return { success: false, error: `Keyboard generate failed: ${error.message}` };
  } finally {
    try {
      await chrome.debugger.detach({ tabId });
    } catch (error) {
      // It may already be detached.
    }
  }
}

async function sendKey(tabId, key, code, windowsVirtualKeyCode, options) {
  const modifierFlags = (options.ctrl ? 2 : 0)
    + (options.alt ? 1 : 0)
    + (options.meta ? 4 : 0)
    + (options.shift ? 8 : 0);
  const base = {
    key,
    code,
    windowsVirtualKeyCode,
    nativeVirtualKeyCode: windowsVirtualKeyCode,
    modifiers: modifierFlags
  };

  if (!modifierFlags) {
    base.unmodifiedText = key === "Enter" ? "\r" : key;
    base.text = key === "Enter" ? "\r" : key;
  }

  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyDown",
    ...base
  });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyUp",
    ...base
  });
}

async function waitForSubmittedPrompt(tabId, prompt, submittedAt, baselineState) {
  const timeoutMs = appState.settings.timeout * 1000;
  let lastRecoveryAt = 0;
  let lastRouteLabel = "";

  while (Date.now() - submittedAt < timeoutMs) {
    if (appState.status !== "Running" || stopRequested) {
      return { success: false, error: "Run stopped before result completed" };
    }

    await keepTabAwake(tabId);
    const tab = await safeGetTab(tabId);
    if (!tab) {
      return { success: false, error: "Target Firefly tab closed" };
    }

    const strategy = RoutePolicy.chooseResultWaitStrategy(tab.url || "");
    if (strategy.routeLabel !== lastRouteLabel) {
      addLog(`Waiting on ${strategy.routeLabel} route`);
      lastRouteLabel = strategy.routeLabel;
    }

    if (strategy.kind === "recover") {
      const now = Date.now();
      if (now - lastRecoveryAt > 1000) {
        addLog("Keeping Firefly on Generate");
        lastRecoveryAt = now;
      }

      const navigation = await navigateToFireflyGenerate(tabId);
      if (!navigation.success) return navigation;
      await delay(1200);
      continue;
    }

    const ready = await ensureContentReady(tabId);
    if (!ready.success) return ready;

    const remainingSeconds = Math.max(60, Math.ceil((timeoutMs - (Date.now() - submittedAt)) / 1000));
    const waitResponse = await sendTabMessage(tabId, {
      action: strategy.action,
      prompt,
      settings: {
        timeout: remainingSeconds,
        autoDownload: appState.settings.autoDownload,
        platform: appState.settings.platform,
        baselineState
      }
    });
    const responseWithRoute = {
      ...waitResponse,
      route: strategy.routeLabel
    };

    if (waitResponse.success) {
      if (RoutePolicy.shouldReturnToGenerateAfterWait({ kind: strategy.kind, success: true })) {
        const navigation = await navigateToFireflyGenerate(tabId);
        if (!navigation.success) return navigation;
      }
      return responseWithRoute;
    }

    if (
      waitResponse.code === "NAVIGATED_HISTORY"
      || waitResponse.code === "LEFT_HISTORY"
      || shouldRecoverWaitError(waitResponse.error)
    ) {
      await delay(800);
      continue;
    }

    if (RoutePolicy.shouldReturnToGenerateAfterWait({ kind: strategy.kind, success: false })) {
      const navigation = await navigateToFireflyGenerate(tabId);
      if (!navigation.success) return navigation;
    }

    return responseWithRoute;
  }

  return { success: false, code: "RESULT_TIMEOUT", error: "Timed out waiting for Firefly result" };
}

async function playCompletionSound(tone) {
  if (!appState.settings.soundOnComplete) return;
  if (!chrome.offscreen) return;

  try {
    const hasDocument = await chrome.offscreen.hasDocument();
    if (!hasDocument) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Play a short chime when the prompt queue finishes."
      });
    }
    chrome.runtime.sendMessage({ action: "PLAY_COMPLETION_SOUND", tone }, () => {
      if (chrome.runtime.lastError) {
        // No receiver yet; ignore.
      }
    });
  } catch (error) {
    // Offscreen audio unavailable; a missing chime must never break a run.
  }
}

async function refreshFireflyTab(tabId) {
  try {
    await chrome.tabs.reload(tabId);
  } catch (error) {
    return false;
  }

  // Wait for the reload to finish: leave "complete" first, then return to it.
  // If the loading phase was too fast to observe, accept a completed tab after
  // a short grace period instead of waiting out the whole window.
  const startedAt = Date.now();
  let sawLoading = false;

  while (Date.now() - startedAt < 20000) {
    await delay(500);
    const tab = await safeGetTab(tabId);
    if (!tab) return false;

    if (tab.status !== "complete") {
      sawLoading = true;
    } else if (sawLoading || Date.now() - startedAt > 4000) {
      break;
    }
  }

  await delay(1500);
  return true;
}

async function navigateToFireflyGenerate(tabId) {
  const tab = await safeGetTab(tabId);
  if (!tab) {
    return { success: false, error: "Target Firefly tab closed" };
  }

  const url = tab.url || "";
  if (isFireflyGenerateUrl(url)) {
    return { success: true };
  }

  addLog("Opening Firefly generate page");
  await chrome.tabs.update(tabId, { url: "https://firefly.adobe.com/generate/image" });
  await keepTabAwake(tabId);
  const loaded = await waitForTabUrl(tabId, (nextUrl) => isFireflyGenerateUrl(nextUrl), 45000);

  if (!loaded) {
    return { success: false, error: "Firefly generate page did not load" };
  }

  await delay(1200);
  return { success: true };
}

async function keepTabAwake(tabId) {
  try {
    await chrome.tabs.update(tabId, { autoDiscardable: false });
  } catch (error) {
    // Some Chrome versions ignore this update property.
  }
}

async function safeGetTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch (error) {
    return null;
  }
}

async function resolveTargetTabId() {
  if (appState.targetTabId) {
    try {
      await chrome.tabs.get(appState.targetTabId);
      return appState.targetTabId;
    } catch (error) {
      appState.targetTabId = null;
    }
  }

  if (appState.settings.platform === "firefly") {
    const tabs = await chrome.tabs.query({ url: "*://firefly.adobe.com/*" });
    if (tabs && tabs.length) {
      appState.targetTabId = tabs[0].id;
      appState.targetUrl = tabs[0].url || "";
      appState.targetTitle = tabs[0].title || "";
      return tabs[0].id;
    }
  }

  return null;
}

async function ensureContentReady(tabId) {
  const ping = await sendTabMessage(tabId, { action: "PING" });
  if (ping.success) return { success: true };

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "src/shared/text.js",
        "src/shared/message.js",
        "src/content/firefly-selectors.js",
        "src/content/generation-result.js",
        "src/content/history-result.js",
        "src/content/prompt-control.js",
        "src/content/download-buttons.js",
        "content.js"
      ]
    });
    await delay(250);
  } catch (error) {
    return { success: false, error: `Cannot inject automation: ${error.message}` };
  }

  const secondPing = await sendTabMessage(tabId, { action: "PING" });
  if (!secondPing.success) {
    return { success: false, error: secondPing.error || "Automation script not ready" };
  }

  return { success: true };
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(normalizeTabMessageResponse(response, chrome.runtime.lastError.message));
        return;
      }
      resolve(normalizeTabMessageResponse(response, ""));
    });
  });
}

function waitForTabUrl(tabId, predicate, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;

    const finish = (value) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(value);
    };

    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId) return;
      const nextUrl = changeInfo.url || tab.url || "";
      if (predicate(nextUrl) && (!changeInfo.status || changeInfo.status === "complete")) {
        finish(true);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
    timer = setTimeout(() => finish(false), timeoutMs);

    chrome.tabs.get(tabId)
      .then((tab) => {
        if (predicate(tab.url || "") && tab.status === "complete") {
          finish(true);
        }
      })
      .catch(() => finish(false));
  });
}

function isFireflyGenerateUrl(url) {
  return RoutePolicy.isFireflyGenerateUrl(url);
}

function isFireflyHistoryUrl(url) {
  return RoutePolicy.isFireflyHistoryUrl(url);
}

function shouldGuardFireflyTab(tabId) {
  return appState.settings.platform === "firefly"
    && RoutePolicy.shouldGuardFireflyRedirect({
      status: appState.status,
      stayOnGenerate: appState.settings.stayOnGenerate,
      targetTabId: appState.targetTabId,
      tabId,
      waitingForResult: appState.waitingForResult
    });
}

function shouldRecoverWaitError(error) {
  return RoutePolicy.shouldRecoverWaitError(error);
}

function startWorkerKeepAlive() {
  if (keepAliveTimer) return;
  chrome.runtime.getPlatformInfo(() => {});
  keepAliveTimer = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 20000);
}

function stopWorkerKeepAlive() {
  if (!keepAliveTimer) return;
  clearInterval(keepAliveTimer);
  keepAliveTimer = null;
}

function sanitizeSettings(settings) {
  return globalThis.NuiiShared.sanitizeSettings(settings);
}

function computeStats() {
  return QueueState.computeStats(appState.queue);
}

function publicState() {
  return {
    ...appState,
    stats: computeStats()
  };
}

async function loadState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (stored && stored[STORAGE_KEY]) {
    appState = {
      ...clone(DEFAULT_STATE),
      ...stored[STORAGE_KEY],
      settings: {
        ...DEFAULT_SETTINGS,
        ...(stored[STORAGE_KEY].settings || {})
      }
    };
    appState.waitingForResult = false;

    if (appState.status === "Running") {
      const recovery = QueueState.recoverRunningItemsAfterRestart(appState, Date.now());
      if (recovery.recovered > 0) {
        addLog("Service worker restarted; active item recovered and queue paused");
      } else {
        addLog("Service worker restarted; queue paused");
      }
      await chrome.storage.local.set({ [STORAGE_KEY]: appState });
    }
  }
}

async function saveAndBroadcast() {
  await chrome.storage.local.set({ [STORAGE_KEY]: appState });
  try {
    chrome.runtime.sendMessage({ action: "STATE_UPDATE", state: publicState() }, () => {
      if (chrome.runtime.lastError) {
        // The popup may be closed.
      }
    });
  } catch (error) {
    // The popup may be closed.
  }
}

function addRunSummary() {
  const downloads = appState.queue.reduce(
    (sum, item) => sum + ((item.meta && Number(item.meta.downloads)) || 0),
    0
  );
  const elapsedMs = appState.startedAt ? Date.now() - appState.startedAt : 0;
  addLog(`Run summary: ${QueueState.formatRunSummary(computeStats(), downloads, elapsedMs)}`);
}

function addWaitDiagnostics(diag) {
  addLog(`Wait diagnostics: outputs ${diag.baselineOutputs}->${diag.lastOutputs}, newImages ${diag.newLoadedCount} (stable ${diag.newStableTicks}, baseline ${diag.baselineImages}), batch ${diag.batchFound ? `${diag.batchImages} busy ${diag.batchBusy} pct ${diag.batchPercent} stable ${diag.batchStableTicks}` : "missing"}, button ${diag.buttonFound ? (diag.buttonDisabled ? "disabled" : "idle") : "missing"}, idleTicks ${diag.idleButtonTicks}, sawBusy ${diag.sawBusy}`);

  const probe = diag.probe;
  if (probe) {
    const top = Array.isArray(probe.topImgs)
      ? probe.topImgs.map((img) => `${img.w}x${img.h}${img.loaded ? "L" : "-"}`).join(" ")
      : "";
    addLog(`DOM probe: batchGrid0=${probe.batchGrid0} collapsible=${probe.collapsible} anyBatch=${probe.anyBatchTestid} thumb=${probe.fireflyThumb} progress=${probe.progress} bigImgs=${probe.bigImgCount} top=[${top}]`);
  }
}

function addLog(message) {
  appState.logs = [
    ...(appState.logs || []),
    {
      time: Date.now(),
      message
    }
  ].slice(-LOG_LIMIT);
}

function positionOf(item) {
  return appState.queue.findIndex((entry) => entry.id === item.id) + 1;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function truncate(value, length) {
  const text = String(value || "");
  if (text.length <= length) return text;
  return `${text.slice(0, length - 1)}...`;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
