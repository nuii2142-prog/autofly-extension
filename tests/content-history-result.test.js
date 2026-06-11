const test = require("node:test");
const assert = require("node:assert/strict");

const { isHistoryResultSettled } = require("../src/content/history-result.js");

test("isHistoryResultSettled accepts already-visible stable history output with warning", () => {
  const result = isHistoryResultSettled(
    {
      outputCount: 4,
      loadingCount: 0,
      skeletonCount: 0,
      textHash: "same"
    },
    {
      outputCount: 4,
      textHash: "same"
    },
    4,
    16000,
    false
  );

  assert.deepEqual(result, {
    complete: true,
    stage: "history-output-existing",
    warning: "Completed by stable existing history output; no baseline growth was detected"
  });
});
