const test = require("node:test");
const assert = require("node:assert/strict");

const { applyPromptResultToItem, canStartNewRun, formatRunSummary, captureGaps } = require("../src/background/queue-state.js");

test("captureGaps names done prompts whose image was not captured; shortfall is the net", () => {
  const queue = [
    { status: "done", prompt: "first prompt", meta: { downloads: 1 } },
    { status: "done", prompt: "second prompt", meta: { downloads: 0 } },
    { status: "done", prompt: "third prompt", meta: { downloads: 2 } },
    { status: "failed", prompt: "failed prompt", meta: { downloads: 0 } }
  ];
  const gaps = captureGaps(queue, true);
  assert.equal(gaps.expected, 3);   // 3 done items
  assert.equal(gaps.captured, 3);   // 1 + 0 + 2 (a straggler counted on #3)
  assert.equal(gaps.shortfall, 0);  // net is whole even though #2 reads 0
  assert.deepEqual(gaps.missing, [{ position: 2, prompt: "second prompt" }]);
});

test("captureGaps shortfall counts the true net of missing images", () => {
  const queue = [
    { status: "done", prompt: "a", meta: { downloads: 1 } },
    { status: "done", prompt: "b", meta: { downloads: 0 } },
    { status: "done", prompt: "c", meta: { downloads: 0 } }
  ];
  const gaps = captureGaps(queue, true);
  assert.equal(gaps.captured, 1);
  assert.equal(gaps.shortfall, 2);
  assert.equal(gaps.missing.length, 2);
});

test("captureGaps lists nothing when ZIP capture is off", () => {
  assert.deepEqual(captureGaps([{ status: "done", prompt: "a", meta: { downloads: 0 } }], false).missing, []);
});

test("canStartNewRun rejects while a run is active or a previous loop is still unwinding", () => {
  assert.deepEqual(
    canStartNewRun({ status: "Running", queueLoopRunning: true }),
    { allowed: false, reason: "A run is already in progress. Stop or pause it before starting a new one." }
  );
  assert.deepEqual(
    canStartNewRun({ status: "Paused", queueLoopRunning: true }),
    { allowed: false, reason: "The previous run is still finishing its current prompt. Wait a moment or stop it first." }
  );
  assert.deepEqual(canStartNewRun({ status: "Paused", queueLoopRunning: false }), { allowed: true, reason: "" });
  assert.deepEqual(canStartNewRun({ status: "Idle", queueLoopRunning: false }), { allowed: true, reason: "" });
  assert.deepEqual(canStartNewRun({ status: "Complete", queueLoopRunning: false }), { allowed: true, reason: "" });
});

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
