const DEFAULT_SETTINGS = globalThis.NuiiShared.DEFAULT_SETTINGS;
const PromptTools = globalThis.NuiiPopupPromptTools;

const elements = {};
let sourceMode = "paste";
let uploadedText = "";
let activeTab = null;
let lastState = null;
let renderTimer = null;

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  bindUiEvents();
  await loadDraft();
  await refreshTarget();
  await requestState();

  setInterval(refreshTarget, 3000);
});

function bindElements() {
  [
    "active-target",
    "status-pill",
    "target-host",
    "refresh-target",
    "stat-total",
    "stat-done",
    "stat-failed",
    "stat-left",
    "prompt-count",
    "clear-prompts",
    "source-paste",
    "source-file",
    "paste-view",
    "file-view",
    "prompts-textarea",
    "drop-zone",
    "file-input",
    "file-title",
    "file-subtitle",
    "prompt-prefix",
    "prompt-suffix",
    "dedupe-prompts",
    "delay-slider",
    "delay-output",
    "timeout-slider",
    "timeout-output",
    "retry-limit",
    "platform-mode",
    "auto-download",
    "subfolder-row",
    "download-subfolder",
    "auto-delete",
    "continue-on-error",
    "current-prompt",
    "progress-label",
    "progress-fill",
    "start-btn",
    "pause-btn",
    "stop-btn",
    "activity-list",
    "export-log"
  ].forEach((id) => {
    elements[toCamel(id)] = document.getElementById(id);
  });
}

function bindUiEvents() {
  elements.refreshTarget.addEventListener("click", refreshTarget);
  elements.sourcePaste.addEventListener("click", () => setSourceMode("paste"));
  elements.sourceFile.addEventListener("click", () => setSourceMode("file"));
  elements.clearPrompts.addEventListener("click", clearPromptInput);
  elements.promptsTextarea.addEventListener("input", onPromptInput);

  ["promptPrefix", "promptSuffix", "dedupePrompts"].forEach((key) => {
    elements[key].addEventListener("input", () => {
      updatePromptCount();
      saveDraftSoon();
    });
    elements[key].addEventListener("change", () => {
      updatePromptCount();
      saveDraftSoon();
    });
  });

  elements.fileInput.addEventListener("change", (event) => {
    handleFile(event.target.files && event.target.files[0]);
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("dragover");
    });
  });

  elements.dropZone.addEventListener("drop", (event) => {
    handleFile(event.dataTransfer.files && event.dataTransfer.files[0]);
  });

  elements.delaySlider.addEventListener("input", () => {
    elements.delayOutput.textContent = `${elements.delaySlider.value}s`;
    saveDraftSoon();
  });

  elements.timeoutSlider.addEventListener("input", () => {
    elements.timeoutOutput.textContent = `${elements.timeoutSlider.value}s`;
    saveDraftSoon();
  });

  [
    "retryLimit",
    "platformMode",
    "autoDownload",
    "autoDelete",
    "continueOnError"
  ].forEach((key) => {
    elements[key].addEventListener("change", saveDraftSoon);
  });

  elements.autoDownload.addEventListener("change", updateSubfolderVisibility);
  elements.downloadSubfolder.addEventListener("input", saveDraftSoon);

  elements.startBtn.addEventListener("click", handleStartOrResume);
  elements.pauseBtn.addEventListener("click", () => sendMessage({ action: "PAUSE_PROCESSING" }));
  elements.stopBtn.addEventListener("click", () => sendMessage({ action: "STOP_PROCESSING" }));
  elements.exportLog.addEventListener("click", exportRunLog);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "STATE_UPDATE") {
      renderState(message.state);
    }
  });
}

async function loadDraft() {
  const draft = await storageGet("popupDraft");
  const settings = { ...DEFAULT_SETTINGS, ...(draft && draft.settings) };

  elements.promptsTextarea.value = draft && draft.promptText ? draft.promptText : "";
  uploadedText = draft && draft.uploadedText ? draft.uploadedText : "";
  elements.promptPrefix.value = settings.prefix;
  elements.promptSuffix.value = settings.suffix;
  elements.dedupePrompts.checked = Boolean(settings.dedupe);
  elements.delaySlider.value = settings.delay;
  elements.timeoutSlider.value = settings.timeout;
  elements.retryLimit.value = String(settings.retryLimit);
  elements.platformMode.value = settings.platform;
  elements.autoDownload.checked = Boolean(settings.autoDownload);
  elements.downloadSubfolder.value = settings.downloadSubfolder || "";
  elements.autoDelete.checked = Boolean(settings.autoDelete);
  elements.continueOnError.checked = Boolean(settings.continueOnError);
  elements.delayOutput.textContent = `${settings.delay}s`;
  elements.timeoutOutput.textContent = `${settings.timeout}s`;

  if (uploadedText) {
    const count = parsePrompts(uploadedText).length;
    elements.fileTitle.textContent = "Saved file prompts";
    elements.fileSubtitle.textContent = `${count} prompts loaded`;
  }

  setSourceMode(draft && draft.sourceMode ? draft.sourceMode : "paste");
  updateSubfolderVisibility();
  updatePromptCount();
}

function updateSubfolderVisibility() {
  elements.subfolderRow.classList.toggle("hidden", !elements.autoDownload.checked);
}

function saveDraftSoon() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(saveDraft, 250);
}

async function saveDraft() {
  const settings = readSettings();
  await storageSet({
    popupDraft: {
      sourceMode,
      promptText: elements.promptsTextarea.value,
      uploadedText,
      settings
    }
  });
}

function setSourceMode(mode) {
  sourceMode = mode;
  elements.sourcePaste.classList.toggle("active", mode === "paste");
  elements.sourceFile.classList.toggle("active", mode === "file");
  elements.pasteView.classList.toggle("hidden", mode !== "paste");
  elements.fileView.classList.toggle("hidden", mode !== "file");
  updatePromptCount();
  saveDraftSoon();
}

function onPromptInput() {
  updatePromptCount();
  saveDraftSoon();
}

async function handleFile(file) {
  if (!file) return;

  const text = await file.text();
  uploadedText = text;
  const count = parsePrompts(text).length;
  elements.fileTitle.textContent = file.name;
  elements.fileSubtitle.textContent = `${count} prompts loaded`;
  setSourceMode("file");
  updatePromptCount();
  saveDraftSoon();
}

function clearPromptInput() {
  if (sourceMode === "paste") {
    elements.promptsTextarea.value = "";
  } else {
    uploadedText = "";
    elements.fileInput.value = "";
    elements.fileTitle.textContent = "Drop .txt or .csv";
    elements.fileSubtitle.textContent = "Prompt column or one prompt per line";
  }
  updatePromptCount();
  saveDraftSoon();
}

async function refreshTarget() {
  try {
    const tabs = await tabsQuery({ active: true, currentWindow: true });
    activeTab = tabs && tabs.length ? tabs[0] : null;
  } catch (error) {
    activeTab = null;
  }

  if (!activeTab || !activeTab.id) {
    elements.targetHost.textContent = "No accessible tab";
    elements.activeTarget.textContent = "Open a target tab";
    return;
  }

  const host = getHost(activeTab.url);
  elements.targetHost.textContent = host || "Restricted page";
  elements.activeTarget.textContent = activeTab.title || activeTab.url || "Current tab";

  if (host && host.includes("firefly.adobe.com")) {
    const ping = await sendTabMessage(activeTab.id, { action: "PING" });
    if (!ping.success) {
      elements.targetHost.textContent = "Firefly tab needs refresh";
      return;
    }

    const diagnostics = ping.diagnostics || {};
    elements.targetHost.textContent = diagnostics.promptInputFound
      ? "Firefly ready"
      : "Firefly connected, prompt not detected";
  }
}

async function requestState() {
  const response = await sendMessage({ action: "GET_STATE" });
  if (response && response.state) {
    renderState(response.state);
  }
}

async function handleStartOrResume() {
  if (lastState && lastState.status === "Paused") {
    await sendMessage({ action: "RESUME_PROCESSING" });
    return;
  }

  const promptEntries = collectPromptEntries();
  if (!promptEntries.length) {
    renderNotice("Add prompts before starting.");
    return;
  }

  await refreshTarget();
  if (!activeTab || !activeTab.id) {
    renderNotice("Open the AI image tab first.");
    return;
  }

  const settings = readSettings();
  await saveDraft();
  const response = await sendMessage({
    action: "START_PROCESSING",
    items: promptEntries,
    prompts: promptEntries.map((entry) => entry.prompt),
    settings,
    targetTabId: activeTab.id,
    targetUrl: activeTab.url || "",
    targetTitle: activeTab.title || ""
  });

  if (response && response.success === false && response.error) {
    renderNotice(response.error);
  }
}

function collectPrompts() {
  return collectPromptEntries().map((entry) => entry.prompt);
}

function collectPromptEntries() {
  const settings = readSettings();
  const sourceText = sourceMode === "paste" ? elements.promptsTextarea.value : uploadedText;
  return PromptTools.parsePromptEntries(sourceText, settings);
}

function parsePrompts(text) {
  return PromptTools.parsePrompts(text);
}

function parseCsvLike(text) {
  return PromptTools.parseCsvLike(text);
}

function cleanPrompt(value) {
  return PromptTools.cleanPrompt(value);
}

function readSettings() {
  return {
    delay: Number(elements.delaySlider.value),
    timeout: Number(elements.timeoutSlider.value),
    retryLimit: Number(elements.retryLimit.value),
    autoDownload: elements.autoDownload.checked,
    autoDelete: elements.autoDelete.checked,
    continueOnError: elements.continueOnError.checked,
    platform: elements.platformMode.value,
    dedupe: elements.dedupePrompts.checked,
    prefix: elements.promptPrefix.value.trim(),
    suffix: elements.promptSuffix.value.trim(),
    downloadSubfolder: elements.downloadSubfolder.value.trim()
  };
}

function updatePromptCount() {
  const count = collectPrompts().length;
  elements.promptCount.textContent = `${count} ready`;
}

function renderState(state) {
  lastState = state || {};
  const stats = state.stats || computeStats(state.queue || []);
  const total = stats.total || 0;
  const completed = stats.done || 0;
  const failed = stats.failed || 0;
  const left = Math.max(total - completed - failed, 0);
  const percent = total ? Math.round(((completed + failed) / total) * 100) : 0;
  const normalizedStatus = String(state.status || "Idle").toLowerCase();

  elements.statusPill.textContent = state.status || "Idle";
  elements.statusPill.className = `status-pill ${normalizedStatus}`;
  elements.statTotal.textContent = String(total);
  elements.statDone.textContent = String(completed);
  elements.statFailed.textContent = String(failed);
  elements.statLeft.textContent = String(left);
  elements.progressLabel.textContent = `${percent}%`;
  elements.progressFill.style.width = `${percent}%`;
  elements.currentPrompt.textContent = state.currentPrompt || state.lastError || statusCopy(state.status);

  const isRunning = state.status === "Running";
  const isPaused = state.status === "Paused";
  elements.startBtn.querySelector("span").textContent = isPaused ? "Resume" : "Start";
  elements.startBtn.disabled = isRunning;
  elements.pauseBtn.disabled = !isRunning;
  elements.stopBtn.disabled = !isRunning && !isPaused;

  if (state.settings && state.settings.autoDelete && sourceMode === "paste" && document.activeElement !== elements.promptsTextarea) {
    const pending = (state.queue || [])
      .filter((item) => item.status === "pending" || item.status === "retry")
      .map((item) => item.sourcePrompt || item.prompt);
    if (state.status === "Running" && pending.length) {
      elements.promptsTextarea.value = pending.join("\n");
      updatePromptCount();
      saveDraftSoon();
    }
  }

  renderActivity(state);
}

function renderActivity(state) {
  const logs = (state.logs || []).slice(-7).reverse();
  elements.activityList.textContent = "";

  if (!logs.length) {
    const li = document.createElement("li");
    li.className = "empty-activity";
    li.textContent = "No activity yet";
    elements.activityList.appendChild(li);
    return;
  }

  logs.forEach((entry) => {
    const li = document.createElement("li");
    const time = document.createElement("strong");
    const message = document.createElement("span");
    time.textContent = formatTime(entry.time);
    message.textContent = entry.message;
    li.append(time, message);
    elements.activityList.appendChild(li);
  });
}

function renderNotice(message) {
  renderActivity({
    logs: [{ time: Date.now(), message }]
  });
}

function exportRunLog() {
  const payload = {
    exportedAt: new Date().toISOString(),
    state: lastState || {}
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `nuii-autofly-log-${Date.now()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function computeStats(queue) {
  return queue.reduce(
    (stats, item) => {
      stats.total += 1;
      stats[item.status] = (stats[item.status] || 0) + 1;
      if (item.status === "done") stats.done += 1;
      if (item.status === "failed") stats.failed += 1;
      return stats;
    },
    { total: 0, done: 0, failed: 0 }
  );
}

function statusCopy(status) {
  if (status === "Complete") return "Queue complete";
  if (status === "Paused") return "Paused";
  if (status === "Stopped") return "Stopped";
  if (status === "Error") return "Needs attention";
  return "Ready";
}

function formatTime(value) {
  if (!value) return "--:--";
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getHost(url) {
  try {
    return new URL(url).host;
  } catch (error) {
    return "";
  }
}

function toCamel(id) {
  return id.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function sendMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || {});
      });
    } catch (error) {
      resolve({ success: false, error: error.message });
    }
  });
}

function tabsQuery(query) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(query, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tabs);
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { success: false });
      });
    } catch (error) {
      resolve({ success: false, error: error.message });
    }
  });
}

function storageGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (items) => resolve(items[key]));
  });
}

function storageSet(items) {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, resolve);
  });
}
