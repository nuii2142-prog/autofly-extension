const test = require("node:test");
const assert = require("node:assert/strict");

const {
  blockingErrorFromTexts,
  isGenerateBusyState,
  isGenerateResultSettled
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
