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

test("isGenerateResultSettled completes via idle Generate button despite signature churn", () => {
  const result = isGenerateResultSettled(
    {
      outputCount: 8,
      outputSignature: "still-churning-2",
      loadingCount: 1,
      skeletonCount: 0,
      generateButtonFound: true,
      generateButtonDisabled: false
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
      idleButtonTicks: 2
    }
  );

  assert.equal(result.complete, true);
  assert.equal(result.stage, "generate-button-idle");
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
