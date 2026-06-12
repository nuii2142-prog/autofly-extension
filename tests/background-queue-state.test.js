const test = require("node:test");
const assert = require("node:assert/strict");

const { applyPromptResultToItem, formatRunSummary } = require("../src/background/queue-state.js");

test("formatRunSummary renders counts, image word, and mm:ss", () => {
  assert.equal(
    formatRunSummary({ done: 6, failed: 0 }, 24, 154000),
    "6 done, 0 failed, 24 images, 2:34"
  );
  assert.equal(
    formatRunSummary({ done: 1, failed: 2 }, 1, 9000),
    "1 done, 2 failed, 1 image, 0:09"
  );
  assert.equal(
    formatRunSummary({}, 0, 0),
    "0 done, 0 failed, 0 images, 0:00"
  );
});

function makeAppState() {
  return {
    settings: { retryLimit: 1 },
    lastError: ""
  };
}

test("applyPromptResultToItem does not retry a result timeout after confirmed submission", () => {
  const item = {
    id: "item-1",
    status: "running",
    attempts: 1,
    submittedAt: 1000,
    error: ""
  };

  const transition = applyPromptResultToItem(item, makeAppState(), {
    success: false,
    code: "RESULT_TIMEOUT",
    error: "Timed out before Generate page output settled"
  });

  assert.equal(transition.action, "done");
  assert.equal(item.status, "done");
  assert.equal(item.meta.unverified, true);
  assert.ok(transition.warning.includes("not retried"));
});

test("applyPromptResultToItem still retries a timeout when submission was never confirmed", () => {
  const item = {
    id: "item-1",
    status: "running",
    attempts: 1,
    submittedAt: null,
    error: ""
  };

  const transition = applyPromptResultToItem(item, makeAppState(), {
    success: false,
    code: "RESULT_TIMEOUT",
    error: "Timed out waiting for Firefly result"
  });

  assert.equal(transition.action, "retry");
  assert.equal(item.status, "pending");
});

test("applyPromptResultToItem still retries ordinary failures", () => {
  const item = {
    id: "item-1",
    status: "running",
    attempts: 1,
    submittedAt: 1000,
    error: ""
  };

  const transition = applyPromptResultToItem(item, makeAppState(), {
    success: false,
    error: "Prompt input not found"
  });

  assert.equal(transition.action, "retry");
  assert.equal(item.status, "pending");
});

test("applyPromptResultToItem marks success done with metadata", () => {
  const item = {
    id: "item-1",
    status: "running",
    attempts: 1,
    submittedAt: 1000,
    error: ""
  };

  const transition = applyPromptResultToItem(item, makeAppState(), {
    success: true,
    downloads: 2,
    warning: "",
    stage: "generate-output-increased",
    route: "Generate",
    finalState: { outputCount: 8 }
  });

  assert.equal(transition.action, "done");
  assert.equal(item.status, "done");
  assert.equal(item.meta.outputCount, 8);
});
