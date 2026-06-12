(function attachSharedSettings(root) {
  const shared = root.NuiiShared || {};
  const text = shared.clampNumber ? shared : require("./text.js");
  const clampNumber = text.clampNumber;

  const DEFAULT_SETTINGS = {
    delay: 5,
    timeout: 240,
    retryLimit: 1,
    autoDownload: false,
    autoDelete: true,
    continueOnError: true,
    platform: "firefly",
    stayOnGenerate: true,
    dedupe: true,
    prefix: "",
    suffix: "",
    downloadSubfolder: "Firefly-AutoFly"
  };

  function sanitizeSettings(settings) {
    const input = settings || {};
    return {
      ...DEFAULT_SETTINGS,
      delay: clampNumber(input.delay, 1, 60, DEFAULT_SETTINGS.delay),
      timeout: clampNumber(input.timeout, 60, 600, DEFAULT_SETTINGS.timeout),
      retryLimit: clampNumber(input.retryLimit, 0, 3, DEFAULT_SETTINGS.retryLimit),
      autoDownload: Boolean(input.autoDownload),
      autoDelete: Boolean(input.autoDelete),
      continueOnError: Boolean(input.continueOnError),
      platform: input.platform === "current-tab" ? "current-tab" : "firefly",
      stayOnGenerate: input.stayOnGenerate !== false,
      dedupe: input.dedupe !== false,
      prefix: String(input.prefix || "").trim(),
      suffix: String(input.suffix || "").trim(),
      downloadSubfolder: String(input.downloadSubfolder || DEFAULT_SETTINGS.downloadSubfolder).slice(0, 120)
    };
  }

  Object.assign(shared, {
    DEFAULT_SETTINGS,
    sanitizeSettings
  });

  root.NuiiShared = shared;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      DEFAULT_SETTINGS,
      sanitizeSettings
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
