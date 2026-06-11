const test = require("node:test");
const assert = require("node:assert/strict");

const { recoverRunningItemsAfterRestart } = require("../src/background/queue-state.js");

test("recoverRunningItemsAfterRestart marks submitted running item failed to avoid duplicate Generate clicks", () => {
  const state = {
    status: "Running",
    currentItemId: "item-1",
    currentPrompt: "prompt one",
    queue: [
      {
        id: "item-1",
        prompt: "prompt one",
        status: "running",
        attempts: 1,
        submittedAt: 1000,
        error: ""
      },
      {
        id: "item-2",
        prompt: "prompt two",
        status: "pending",
        attempts: 0,
        error: ""
      }
    ]
  };

  const result = recoverRunningItemsAfterRestart(state, 2000);

  assert.equal(result.recovered, 1);
  assert.equal(state.status, "Paused");
  assert.equal(state.currentPrompt, "");
  assert.equal(state.currentItemId, null);
  assert.equal(state.queue[0].status, "failed");
  assert.equal(state.queue[0].error, "Service worker restarted after prompt submission; skipped to avoid duplicate Generate click");
  assert.equal(state.queue[0].finishedAt, 2000);
});

test("recoverRunningItemsAfterRestart returns not-yet-submitted running item to pending", () => {
  const state = {
    status: "Running",
    currentItemId: "item-1",
    currentPrompt: "prompt one",
    queue: [
      {
        id: "item-1",
        prompt: "prompt one",
        status: "running",
        attempts: 1,
        error: ""
      }
    ]
  };

  const result = recoverRunningItemsAfterRestart(state, 2000);

  assert.equal(result.recovered, 1);
  assert.equal(state.queue[0].status, "pending");
  assert.equal(state.queue[0].error, "Service worker restarted before prompt submission");
});
