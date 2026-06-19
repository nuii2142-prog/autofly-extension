(function attachSharedSettings(root) {
  const shared = root.NuiiShared || {};
  const text = shared.clampNumber ? shared : require("./text.js");
  const clampNumber = text.clampNumber;

  const RESOLUTION_VALUES = ["1K", "2K"];

  const DEFAULT_SETTINGS = {
    delay: 5,
    timeout: 240,
    retryLimit: 1,
    autoDownload: false,
    zipDownload: false,
    autoZipOnComplete: true,
    autoDelete: true,
    continueOnError: true,
    platform: "firefly",
    resolution: "2K",
    stayOnGenerate: true,
    dedupe: true,
    prefix: "",
    suffix: "",
    soundOnComplete: true
  };

  function sanitizeSettings(settings) {
    const input = settings || {};
    return {
      ...DEFAULT_SETTINGS,
      delay: clampNumber(input.delay, 1, 60, DEFAULT_SETTINGS.delay),
      timeout: clampNumber(input.timeout, 60, 600, DEFAULT_SETTINGS.timeout),
      retryLimit: clampNumber(input.retryLimit, 0, 3, DEFAULT_SETTINGS.retryLimit),
      autoDownload: Boolean(input.autoDownload),
      zipDownload: Boolean(input.zipDownload),
      autoZipOnComplete: input.autoZipOnComplete !== false,
      autoDelete: Boolean(input.autoDelete),
      continueOnError: Boolean(input.continueOnError),
      platform: input.platform === "current-tab" ? "current-tab" : "firefly",
      resolution: RESOLUTION_VALUES.includes(input.resolution) ? input.resolution : DEFAULT_SETTINGS.resolution,
      stayOnGenerate: input.stayOnGenerate !== false,
      dedupe: input.dedupe !== false,
      prefix: String(input.prefix || "").trim(),
      suffix: String(input.suffix || "").trim(),
      soundOnComplete: input.soundOnComplete !== false
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
