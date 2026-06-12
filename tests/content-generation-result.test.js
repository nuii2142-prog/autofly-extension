const test = require("node:test");
const assert = require("node:assert/strict");

const {
  blockingErrorFromTexts,
  isGenerateBusyState,
  isGenerateResultSettled,
  pageErrorText
} = require("../src/content/generation-result.js");

test("isGenerateResultSettled completes when Generate page becomes idle after a busy run", () => {
  const result = isGenerateResultSettled(
    {
      outputCount: 4,
      outputSignature: "same-grid",
      loadingCount: 0,
      skeletonCount: 0
    },
    {
      outputCount: 4,
      outputSignature: "same-grid"
    },
    3,
    12000,
    {
      busy: false,
      sawBusy: true,
      sawChange: false
    }
  );

  assert.deepEqual(result, {
    complete: true,
    stage: "generate-busy-idle",
    warning: "Completed by Generate page returning idle after a busy state"
  });
});

test("isGenerateResultSettled does not complete by idle state before seeing a busy run", () => {
  const result = isGenerateResultSettled(
    {
      outputCount: 4,
      outputSignature: "same-grid",
      loadingCount: 0,
      skeletonCount: 0
    },
    {
      outputCount: 4,
      outputSignature: "same-grid"
    },
    4,
    16000,
    {
      busy: false,
      sawBusy: false,
      sawChange: false
    }
  );

  assert.equal(result.complete, false);
});

test("isGenerateBusyState only treats generate-specific signals as busy", () => {
  assert.equal(isGenerateBusyState({
    loadingCount: 0,
    skeletonCount: 0,
    generateButtonFound: true,
    generateButtonDisabled: false
  }), false);

  assert.equal(isGenerateBusyState({
    loadingCount: 0,
    skeletonCount: 0,
    generateButtonFound: true,
    generateButtonDisabled: true
  }), true);

  assert.equal(isGenerateBusyState({
    loadingCount: 0,
    skeletonCount: 4,
    generateButtonFound: true,
    generateButtonDisabled: false
  }), true);
});

test("isGenerateResultSettled completes when the newest batch is fully loaded and stable", () => {
  const result = isGenerateResultSettled(
    {
      outputCount: 185,
      outputSignature: "page-churn",
      loadingCount: 2,
      skeletonCount: 1,
      generateButtonFound: true,
      generateButtonDisabled: false,
      batch: {
        found: true,
        signature: "new-batch-4-images",
        imageCount: 4,
        loadedCount: 4,
        busyCount: 0,
        hasPercent: false
      }
    },
    {
      outputCount: 184,
      outputSignature: "baseline",
      batch: { found: true, signature: "previous-batch" }
    },
    0,
    14000,
    {
      busy: true,
      sawBusy: true,
      sawChange: true,
      idleButtonTicks: 9,
      batchStableTicks: 2
    }
  );

  assert.equal(result.complete, true);
  assert.equal(result.stage, "generate-batch-loaded");
});

test("isGenerateResultSettled does not complete while the newest batch is still rendering", () => {
  const stillRendering = {
    outputCount: 185,
    outputSignature: "page-churn",
    loadingCount: 0,
    skeletonCount: 0,
    generateButtonFound: true,
    generateButtonDisabled: false,
    batch: {
      found: true,
      signature: "new-batch-partial",
      imageCount: 4,
      loadedCount: 2,
      busyCount: 1,
      hasPercent: true
    }
  };

  const result = isGenerateResultSettled(
    stillRendering,
    { outputCount: 180, outputSignature: "baseline", batch: { found: true, signature: "previous-batch" } },
    0,
    20000,
    {
      busy: false,
      sawBusy: true,
      sawChange: true,
      idleButtonTicks: 9,
      batchStableTicks: 5
    }
  );

  assert.equal(result.complete, false);
});

test("isGenerateResultSettled suppresses the button-idle rule when a batch container exists", () => {
  const result = isGenerateResultSettled(
    {
      outputCount: 8,
      outputSignature: "churn",
      loadingCount: 0,
      skeletonCount: 0,
      generateButtonFound: true,
      generateButtonDisabled: false,
      batch: {
        found: true,
        signature: "new-batch-unsettled",
        imageCount: 4,
        loadedCount: 4,
        busyCount: 0,
        hasPercent: false
      }
    },
    { outputCount: 4, outputSignature: "baseline", batch: { found: true, signature: "previous-batch" } },
    0,
    20000,
    {
      busy: false,
      sawBusy: true,
      sawChange: true,
      idleButtonTicks: 9,
      batchStableTicks: 1
    }
  );

  assert.equal(result.complete, false);
});

test("isGenerateResultSettled falls back to button-idle when a batch card exposes no images", () => {
  const result = isGenerateResultSettled(
    {
      outputCount: 8,
      outputSignature: "churn",
      loadingCount: 0,
      skeletonCount: 0,
      generateButtonFound: true,
      generateButtonDisabled: false,
      batch: { found: true, signature: "card", imageCount: 0, loadedCount: 0, busyCount: 0, hasPercent: false }
    },
    { outputCount: 4, outputSignature: "baseline", batch: { found: false } },
    0,
    26000,
    {
      busy: true,
      sawBusy: true,
      sawChange: true,
      idleButtonTicks: 3,
      batchStableTicks: 5
    }
  );

  assert.equal(result.complete, true);
  assert.equal(result.stage, "generate-button-idle");
});

test("isGenerateResultSettled does not complete a loaded batch until a busy phase was observed", () => {
  const result = isGenerateResultSettled(
    {
      outputCount: 185,
      outputSignature: "page-churn",
      loadingCount: 0,
      skeletonCount: 0,
      generateButtonFound: true,
      generateButtonDisabled: false,
      batch: { found: true, signature: "already-loaded", imageCount: 4, loadedCount: 4, busyCount: 0, hasPercent: false }
    },
    { outputCount: 184, outputSignature: "baseline", batch: { found: false } },
    0,
    14000,
    {
      busy: false,
      sawBusy: false,
      sawChange: true,
      idleButtonTicks: 9,
      batchStableTicks: 5
    }
  );

  assert.equal(result.complete, false);
});

test("isGenerateResultSettled completes via idle Generate button only when no batch container exists", () => {
  const result = isGenerateResultSettled(
    {
      outputCount: 8,
      outputSignature: "still-churning-2",
      loadingCount: 1,
      skeletonCount: 0,
      generateButtonFound: true,
      generateButtonDisabled: false,
      batch: { found: false }
    },
    {
      outputCount: 4,
      outputSignature: "baseline"
    },
    0,
    26000,
    {
      busy: true,
      sawBusy: true,
      sawChange: true,
      idleButtonTicks: 3
    }
  );

  assert.equal(result.complete, true);
  assert.equal(result.stage, "generate-button-idle");
});

test("isGenerateResultSettled completes when new images have loaded and stabilized after a busy phase", () => {
  const result = isGenerateResultSettled(
    {
      outputCount: 188,
      outputSignature: "churn",
      loadingCount: 0,
      skeletonCount: 0,
      generateButtonFound: true,
      generateButtonDisabled: false,
      batch: { found: false }
    },
    { outputCount: 184, outputSignature: "baseline", batch: { found: false } },
    0,
    26000,
    {
      busy: false,
      sawBusy: true,
      sawChange: true,
      newLoadedCount: 4,
      newStableTicks: 4,
      idleButtonTicks: 9
    }
  );

  assert.equal(result.complete, true);
  assert.equal(result.stage, "generate-new-images-loaded");
});

test("isGenerateResultSettled does not complete on new images until they stop arriving", () => {
  const result = isGenerateResultSettled(
    { outputCount: 186, outputSignature: "churn", loadingCount: 0, skeletonCount: 0, generateButtonFound: true, generateButtonDisabled: false, batch: { found: false } },
    { outputCount: 184, outputSignature: "baseline", batch: { found: false } },
    0,
    15000,
    { busy: false, sawBusy: true, sawChange: true, newLoadedCount: 2, newStableTicks: 1, idleButtonTicks: 9 }
  );

  assert.equal(result.complete, false);
});

test("isGenerateResultSettled does not complete on new images before the time floor", () => {
  const result = isGenerateResultSettled(
    { outputCount: 188, outputSignature: "churn", loadingCount: 0, skeletonCount: 0, generateButtonFound: true, generateButtonDisabled: false, batch: { found: false } },
    { outputCount: 184, outputSignature: "baseline", batch: { found: false } },
    0,
    7000,
    { busy: false, sawBusy: true, sawChange: true, newLoadedCount: 4, newStableTicks: 6, idleButtonTicks: 9 }
  );

  assert.equal(result.complete, false);
});

test("isGenerateResultSettled does not complete on new images without an observed busy phase", () => {
  const result = isGenerateResultSettled(
    { outputCount: 188, outputSignature: "churn", loadingCount: 0, skeletonCount: 0, generateButtonFound: true, generateButtonDisabled: false, batch: { found: false } },
    { outputCount: 184, outputSignature: "baseline", batch: { found: false } },
    0,
    30000,
    { busy: false, sawBusy: false, sawChange: true, newLoadedCount: 4, newStableTicks: 6, idleButtonTicks: 9 }
  );

  assert.equal(result.complete, false);
});

test("isGenerateResultSettled does not complete via button-idle at the old premature elapsed", () => {
  const result = isGenerateResultSettled(
    { outputCount: 8, outputSignature: "churn", loadingCount: 0, skeletonCount: 0, generateButtonFound: true, generateButtonDisabled: false, batch: { found: false } },
    { outputCount: 4, outputSignature: "baseline", batch: { found: false } },
    0,
    7000,
    { busy: true, sawBusy: true, sawChange: true, idleButtonTicks: 5 }
  );

  assert.equal(result.complete, false);
});

test("isGenerateResultSettled does not complete by button signal while button is disabled", () => {
  const result = isGenerateResultSettled(
    {
      outputCount: 8,
      outputSignature: "still-churning-2",
      loadingCount: 1,
      skeletonCount: 2,
      generateButtonFound: true,
      generateButtonDisabled: true
    },
    {
      outputCount: 4,
      outputSignature: "baseline"
    },
    0,
    20000,
    {
      busy: true,
      sawBusy: true,
      sawChange: true,
      idleButtonTicks: 0
    }
  );

  assert.equal(result.complete, false);
});

test("blockingErrorFromTexts ignores Firefly history-save notices", () => {
  assert.equal(
    blockingErrorFromTexts(["Can't save some items to generation history Download"]),
    ""
  );

  assert.equal(
    blockingErrorFromTexts(["Generation failed. Please try again."]),
    "Generation failed. Please try again."
  );
});

test("blockingErrorFromTexts ignores marketing copy containing unlimited", () => {
  assert.equal(
    blockingErrorFromTexts([
      "Get unlimited image generations in Firefly for a full year with select credit subscriptions."
    ]),
    ""
  );
});

test("blockingErrorFromTexts still detects real limit and quota alerts", () => {
  assert.equal(
    blockingErrorFromTexts(["You've reached your generation limit."]),
    "You've reached your generation limit."
  );
  assert.equal(
    blockingErrorFromTexts(["Quota exceeded for this account."]),
    "Quota exceeded for this account."
  );
});

test("pageErrorText ignores the unlimited-generations promo banner", () => {
  assert.equal(
    pageErrorText("Get unlimited image generations in Firefly for a full year with select credit subscriptions."),
    ""
  );
});

test("pageErrorText ignores generic page copy without error phrasing", () => {
  assert.equal(pageErrorText("Generate images from text prompts. Limited time offer on premium plans."), "");
  assert.equal(pageErrorText(""), "");
});

test("pageErrorText detects genuine generation errors with trailing context", () => {
  assert.equal(
    pageErrorText("Prompt declined. Try rewording your prompt."),
    "Prompt declined. Try rewording your prompt."
  );
  assert.equal(
    pageErrorText("Unable to generate. Please try again later."),
    "Unable to generate. Please try again later."
  );
  assert.equal(
    pageErrorText("Header text\nYou've reached your generation limit for today.\nFooter"),
    "reached your generation limit for today."
  );
  assert.equal(
    pageErrorText("Quota exceeded for this account."),
    "Quota exceeded for this account."
  );
  assert.equal(
    pageErrorText("You are out of generative credits."),
    "out of generative credits."
  );
});
