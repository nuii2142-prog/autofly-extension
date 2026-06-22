const DEFAULT_SETTINGS = globalThis.NuiiShared.DEFAULT_SETTINGS;
const PromptTools = globalThis.NuiiPopupPromptTools;

const elements = {};
let sourceMode = "paste";
let uploadedFiles = [];
let activeTab = null;
let lastState = null;
let renderTimer = null;

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  bindUiEvents();
  await loadDraft();
  await initCustomSound();
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
    "rerun-failed",
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
    "resolution-select",
    "auto-download",
    "zip-download",
    "auto-zip",
    "auto-delete",
    "continue-on-error",
    "sound-on-complete",
    "current-prompt",
    "progress-label",
    "progress-fill",
    "start-btn",
    "pause-btn",
    "stop-btn",
    "activity-list",
    "download-zip-btn",
    "export-log",
    "sound-name",
    "sound-upload",
    "sound-test",
    "sound-reset",
    "sound-file"
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
    handleFiles(event.target.files);
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
    handleFiles(event.dataTransfer.files);
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
    "resolutionSelect",
    "autoDownload",
    "zipDownload",
    "autoZip",
    "autoDelete",
    "continueOnError",
    "soundOnComplete"
  ].forEach((key) => {
    elements[key].addEventListener("change", saveDraftSoon);
  });

  elements.startBtn.addEventListener("click", handleStartOrResume);
  elements.pauseBtn.addEventListener("click", () => sendMessage({ action: "PAUSE_PROCESSING" }));
  elements.stopBtn.addEventListener("click", () => sendMessage({ action: "STOP_PROCESSING" }));
  elements.downloadZipBtn.addEventListener("click", handleDownloadZip);
  elements.exportLog.addEventListener("click", exportRunLog);
  elements.rerunFailed.addEventListener("click", handleRerunFailed);
  elements.soundUpload.addEventListener("click", () => elements.soundFile.click());
  elements.soundFile.addEventListener("change", handleSoundFile);
  elements.soundTest.addEventListener("click", testCustomSound);
  elements.soundReset.addEventListener("click", resetCustomSound);

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
  uploadedFiles = draft && Array.isArray(draft.uploadedFiles) ? draft.uploadedFiles : [];
  elements.promptPrefix.value = settings.prefix;
  elements.promptSuffix.value = settings.suffix;
  elements.dedupePrompts.checked = Boolean(settings.dedupe);
  elements.delaySlider.value = settings.delay;
  elements.timeoutSlider.value = settings.timeout;
  elements.retryLimit.value = String(settings.retryLimit);
  elements.platformMode.value = settings.platform;
  elements.resolutionSelect.value = settings.resolution;
  elements.autoDownload.checked = Boolean(settings.autoDownload);
  elements.zipDownload.checked = Boolean(settings.zipDownload);
  elements.autoZip.checked = settings.autoZipOnComplete !== false;
  elements.autoDelete.checked = Boolean(settings.autoDelete);
  elements.continueOnError.checked = Boolean(settings.continueOnError);
  elements.soundOnComplete.checked = settings.soundOnComplete !== false;
  elements.delayOutput.textContent = `${settings.delay}s`;
  elements.timeoutOutput.textContent = `${settings.timeout}s`;

  if (uploadedFiles.length) {
    renderFileSummary();
  }

  setSourceMode(draft && draft.sourceMode ? draft.sourceMode : "paste");
  updatePromptCount();
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
      uploadedFiles,
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

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  uploadedFiles = await Promise.all(
    files.map(async (file) => ({ name: file.name, text: await file.text() }))
  );
  setSourceMode("file");
  renderFileSummary();
  updatePromptCount();
  saveDraftSoon();
}

function renderFileSummary() {
  if (!uploadedFiles.length) {
    elements.fileTitle.textContent = "Drop .txt or .csv";
    elements.fileSubtitle.textContent = "One or more files — one ZIP per file";
    return;
  }
  const settings = readSettings();
  const total = uploadedFiles.reduce(
    (sum, file) => sum + PromptTools.parsePromptEntries(file.text, settings).length,
    0
  );
  elements.fileTitle.textContent =
    uploadedFiles.length === 1 ? uploadedFiles[0].name : `${uploadedFiles.length} files`;
  elements.fileSubtitle.textContent =
    `${total} prompt${total === 1 ? "" : "s"} • ${uploadedFiles.length} ZIP${uploadedFiles.length === 1 ? "" : "s"}`;
}

function clearPromptInput() {
  if (sourceMode === "paste") {
    elements.promptsTextarea.value = "";
  } else {
    uploadedFiles = [];
    elements.fileInput.value = "";
    renderFileSummary();
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

  const segments = collectSegments();
  const totalPrompts = segments.reduce((sum, segment) => sum + segment.prompts.length, 0);
  if (!totalPrompts) {
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
    segments,
    settings,
    targetTabId: activeTab.id,
    targetUrl: activeTab.url || "",
    targetTitle: activeTab.title || ""
  });

  if (response && response.success === false && response.error) {
    renderNotice(response.error);
  }
}

async function handleDownloadZip() {
  elements.downloadZipBtn.disabled = true;
  try {
    const response = await sendMessage({ action: "DOWNLOAD_ALL_ZIP" });
    if (!response || response.success === false) {
      renderNotice(`Could not build ZIP: ${(response && response.error) || "unknown error"}`);
    } else if (!response.count) {
      renderNotice('No captured images. Turn on "Combine into a single ZIP" before running.');
    } else {
      renderNotice(`Saved ${response.filename} (${response.count} image${response.count > 1 ? "s" : ""})`);
    }
  } finally {
    elements.downloadZipBtn.disabled = false;
  }
}

async function handleRerunFailed() {
  const response = await sendMessage({ action: "RERUN_FAILED" });
  if (response && response.success === false && response.error) {
    renderNotice(response.error);
  }
}

function collectPrompts() {
  return collectSegments().flatMap((segment) => segment.prompts.map((entry) => entry.prompt));
}

function fileStem(name) {
  return String(name || "").replace(/\.[^.]+$/, "").trim() || "prompts";
}

// One segment per source: paste = a single "prompts" segment; file mode = one
// segment per uploaded file (one ZIP each). Dedup applies within each segment.
function collectSegments() {
  const settings = readSettings();
  if (sourceMode === "paste") {
    const prompts = PromptTools.parsePromptEntries(elements.promptsTextarea.value, settings);
    return prompts.length ? [{ name: "prompts", prompts }] : [];
  }
  return uploadedFiles
    .map((file) => ({ name: fileStem(file.name), prompts: PromptTools.parsePromptEntries(file.text, settings) }))
    .filter((segment) => segment.prompts.length);
}

function parsePrompts(text) {
  return PromptTools.parsePrompts(text);
}

function readSettings() {
  return {
    delay: Number(elements.delaySlider.value),
    timeout: Number(elements.timeoutSlider.value),
    retryLimit: Number(elements.retryLimit.value),
    autoDownload: elements.autoDownload.checked,
    zipDownload: elements.zipDownload.checked,
    autoZipOnComplete: elements.autoZip.checked,
    autoDelete: elements.autoDelete.checked,
    continueOnError: elements.continueOnError.checked,
    platform: elements.platformMode.value,
    resolution: elements.resolutionSelect.value,
    dedupe: elements.dedupePrompts.checked,
    prefix: elements.promptPrefix.value.trim(),
    suffix: elements.promptSuffix.value.trim(),
    soundOnComplete: elements.soundOnComplete.checked
  };
}

function updatePromptCount() {
  const count = collectPrompts().length;
  elements.promptCount.textContent = `${count} ready`;
}

function renderState(state) {
  lastState = state || {};
  renderRunTimer();
  updateRunTimerTicker(state.status);
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
  elements.downloadZipBtn.disabled = isRunning;

  if (elements.rerunFailed) {
    const canRerun = failed > 0 && !isRunning && !isPaused;
    elements.rerunFailed.hidden = !canRerun;
    elements.rerunFailed.textContent = `Re-run failed (${failed})`;
  }

  // Show which segment (file) is running for multi-file runs.
  if (state.segments && state.segments.length > 1 && state.currentItemId) {
    const current = (state.queue || []).find((item) => item.id === state.currentItemId);
    const segment = current && state.segments[current.segmentIndex];
    if (segment) {
      elements.currentPrompt.textContent =
        `[${current.segmentIndex + 1}/${state.segments.length} ${segment.name}] ${current.prompt || ""}`.slice(0, 110);
    }
  }

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
  anchor.download = `nuii-auto-bulk-log-${Date.now()}.json`;
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

// Whole-run elapsed clock for the popup: ticks live while Running, freezes at the
// final total once the run Completes or is Stopped (both set finishedAt), and
// shows the last run's total when idle so it stays available to read off later.
let runTimerInterval = null;

function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function renderRunTimer() {
  const el = document.getElementById("run-timer");
  if (!el) return;
  const state = lastState || {};
  if (!state.startedAt) {
    el.textContent = "⏱ 00:00";
    return;
  }
  const end = state.status === "Running" ? Date.now() : state.finishedAt || Date.now();
  el.textContent = `⏱ ${formatDuration(end - state.startedAt)}`;
}

function updateRunTimerTicker(status) {
  if (status === "Running") {
    if (!runTimerInterval) runTimerInterval = setInterval(renderRunTimer, 1000);
  } else if (runTimerInterval) {
    clearInterval(runTimerInterval);
    runTimerInterval = null;
  }
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

const CUSTOM_SOUND_KEY = "nuiiCustomSound";
const MAX_SOUND_BYTES = 1024 * 1024; // 1 MB is plenty for a notification sound.

async function initCustomSound() {
  const custom = await storageGet(CUSTOM_SOUND_KEY);
  setSoundName(custom && custom.name);
}

function setSoundName(name) {
  elements.soundName.textContent = name ? name : "Built-in notification";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

async function handleSoundFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = ""; // allow re-picking the same file later
  if (!file) return;

  if (!/^audio\//i.test(file.type)) {
    renderNotice("Please choose an audio file (.mp3, .wav, .ogg).");
    return;
  }
  if (file.size > MAX_SOUND_BYTES) {
    renderNotice(`That sound is too large (${Math.round(file.size / 1024)} KB). Max 1 MB.`);
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    await storageSet({ [CUSTOM_SOUND_KEY]: { name: file.name, dataUrl } });
    setSoundName(file.name);
    renderNotice(`Completion sound set: ${file.name}`);
  } catch (error) {
    renderNotice("Could not load that sound file.");
  }
}

async function testCustomSound() {
  const custom = await storageGet(CUSTOM_SOUND_KEY);
  const src = custom && custom.dataUrl ? custom.dataUrl : chrome.runtime.getURL("sounds/notification.mp3");
  try {
    await new Audio(src).play();
  } catch (error) {
    renderNotice("Could not play the sound in this view.");
  }
}

async function resetCustomSound() {
  await new Promise((resolve) => chrome.storage.local.remove(CUSTOM_SOUND_KEY, () => resolve()));
  setSoundName("");
  renderNotice("Reverted to the built-in notification sound.");
}

function storageGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (items) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
        return;
      }
      resolve(items[key]);
    });
  });
}

function storageSet(items) {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) {
        // Draft persistence is best-effort (e.g. a too-large imported file);
        // surface it in the console instead of failing silently.
        console.warn("[Nuii Auto Bulk] Draft not saved:", chrome.runtime.lastError.message);
      }
      resolve();
    });
  });
}
