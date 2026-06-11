const test = require("node:test");
const assert = require("node:assert/strict");

const { applyPromptResultToItem } = require("../src/background/queue-state.js");

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
