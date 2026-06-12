const test = require("node:test");
const assert = require("node:assert/strict");

const {
  chooseResultWaitStrategy,
  shouldGuardFireflyRedirect,
  shouldReturnToGenerateAfterWait,
  shouldRefreshFireflyPage
} = require("../src/background/route-policy.js");

test("shouldRefreshFireflyPage refreshes only Firefly runs at the configured interval", () => {
  assert.equal(
    shouldRefreshFireflyPage({ platform: "firefly", promptsSinceRefresh: 10, refreshEvery: 10 }),
    true
  );
  assert.equal(
    shouldRefreshFireflyPage({ platform: "firefly", promptsSinceRefresh: 14, refreshEvery: 10 }),
    true
  );
  assert.equal(
    shouldRefreshFireflyPage({ platform: "firefly", promptsSinceRefresh: 3, refreshEvery: 10 }),
    false
  );
  assert.equal(
    shouldRefreshFireflyPage({ platform: "current-tab", promptsSinceRefresh: 99, refreshEvery: 10 }),
    false
  );
});
const { applyPromptResultToItem } = require("../src/background/queue-state.js");

test("chooseResultWaitStrategy waits on Generate or History based on current Firefly route", () => {
  assert.deepEqual(
    chooseResultWaitStrategy("https://firefly.adobe.com/generate/image"),
    { kind: "generate", action: "WAIT_FOR_RESULT", routeLabel: "Generate" }
  );

  assert.deepEqual(
    chooseResultWaitStrategy("https://firefly.adobe.com/your-stuff?generationHistory=true"),
    { kind: "history", action: "WAIT_FOR_HISTORY_RESULT", routeLabel: "History" }
  );

  assert.deepEqual(
    chooseResultWaitStrategy("https://example.com/elsewhere"),
    { kind: "recover", action: null, routeLabel: "Other" }
  );
});

test("shouldGuardFireflyRedirect does not force History back while a submitted prompt is waiting", () => {
  assert.equal(
    shouldGuardFireflyRedirect({
      status: "Running",
      stayOnGenerate: true,
      targetTabId: 7,
      tabId: 7,
      waitingForResult: true
    }),
    false
  );

  assert.equal(
    shouldGuardFireflyRedirect({
      status: "Running",
      stayOnGenerate: true,
      targetTabId: 7,
      tabId: 7,
      waitingForResult: false
    }),
    true
  );
});

test("history waits return to Generate after result resolution", () => {
  assert.equal(shouldReturnToGenerateAfterWait({ kind: "history", success: true }), true);
  assert.equal(shouldReturnToGenerateAfterWait({ kind: "history", success: false }), true);
  assert.equal(shouldReturnToGenerateAfterWait({ kind: "generate", success: true }), false);
});

test("applyPromptResultToItem marks retryable failures pending and final failures failed", () => {
  const retryItem = { status: "running", attempts: 1, error: "" };
  const retryState = { status: "Running", settings: { retryLimit: 1 }, lastError: "" };
  const retryResult = applyPromptResultToItem(retryItem, retryState, {
    success: false,
    error: "Timed out"
  });

  assert.equal(retryItem.status, "pending");
  assert.equal(retryItem.error, "Timed out");
  assert.equal(retryState.lastError, "Timed out");
  assert.equal(retryResult.action, "retry");

  const failedItem = { status: "running", attempts: 2, error: "" };
  const failedState = { status: "Running", settings: { retryLimit: 1, continueOnError: true }, lastError: "" };
  const failedResult = applyPromptResultToItem(failedItem, failedState, {
    success: false,
    error: "Timed out"
  });

  assert.equal(failedItem.status, "failed");
  assert.equal(failedResult.action, "failed");
});
