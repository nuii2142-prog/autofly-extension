const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSegmentedQueue,
  segmentComplete,
  nextFailureStreak,
  shouldPauseForFailures,
  zipNameForSegment,
  failedItemsToSegments
} = require("../src/background/queue-state.js");

test("buildSegmentedQueue tags items with segmentIndex and one runId per segment", () => {
  const { queue, segments } = buildSegmentedQueue(
    [
      { name: "cats", prompts: ["a", "b"] },
      { name: "dogs", prompts: [{ prompt: "c", sourcePrompt: "c-src" }] }
    ],
    1000
  );
  assert.equal(queue.length, 3);
  assert.equal(queue[0].segmentIndex, 0);
  assert.equal(queue[2].segmentIndex, 1);
  assert.equal(queue[2].sourcePrompt, "c-src");
  assert.equal(segments.length, 2);
  assert.notEqual(segments[0].runId, segments[1].runId);
  assert.equal(segments[0].name, "cats");
  assert.ok(queue.every((i) => i.status === "pending" && i.attempts === 0));
});

test("buildSegmentedQueue drops empty prompts but keeps segment indexing", () => {
  const { queue } = buildSegmentedQueue([{ name: "a", prompts: ["x", "  ", ""] }], 1);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].prompt, "x");
});

test("segmentComplete is true only when no item in the segment is pending or running", () => {
  const queue = [
    { segmentIndex: 0, status: "done" },
    { segmentIndex: 0, status: "failed" },
    { segmentIndex: 1, status: "pending" }
  ];
  assert.equal(segmentComplete(queue, 0), true);
  assert.equal(segmentComplete(queue, 1), false);
});

test("segmentComplete is false for an unknown segment with no items", () => {
  assert.equal(segmentComplete([{ segmentIndex: 0, status: "done" }], 9), false);
});

test("nextFailureStreak resets on done, increments on failed, holds on retry", () => {
  assert.equal(nextFailureStreak(3, "done"), 0);
  assert.equal(nextFailureStreak(3, "failed"), 4);
  assert.equal(nextFailureStreak(3, "retry"), 3);
});

test("shouldPauseForFailures triggers at or above the limit", () => {
  assert.equal(shouldPauseForFailures(4, 5), false);
  assert.equal(shouldPauseForFailures(5, 5), true);
});

test("zipNameForSegment sanitizes the file name and appends the timestamp", () => {
  assert.equal(zipNameForSegment("cats/run:1", "20260622-101010"), "cats_run_1-20260622-101010.zip");
  assert.equal(zipNameForSegment("", "T"), "segment-T.zip");
});

test("failedItemsToSegments groups failed items by their segment name, order preserved", () => {
  const segs = failedItemsToSegments(
    [
      { status: "failed", segmentIndex: 0, sourcePrompt: "a" },
      { status: "done", segmentIndex: 0, sourcePrompt: "b" },
      { status: "failed", segmentIndex: 1, sourcePrompt: "c" }
    ],
    [{ name: "cats" }, { name: "dogs" }]
  );
  assert.deepEqual(segs, [
    { name: "cats", prompts: [{ prompt: "a", sourcePrompt: "a" }] },
    { name: "dogs", prompts: [{ prompt: "c", sourcePrompt: "c" }] }
  ]);
});

test("buildSegmentedQueue round-trips through failedItemsToSegments", () => {
  // A built queue whose items are all failed reproduces the original segments.
  const { queue, segments } = buildSegmentedQueue(
    [{ name: "f1", prompts: ["a", "b"] }, { name: "f2", prompts: ["c"] }],
    7
  );
  queue.forEach((i) => (i.status = "failed"));
  const segs = failedItemsToSegments(queue, segments);
  assert.deepEqual(segs, [
    { name: "f1", prompts: [{ prompt: "a", sourcePrompt: "a" }, { prompt: "b", sourcePrompt: "b" }] },
    { name: "f2", prompts: [{ prompt: "c", sourcePrompt: "c" }] }
  ]);
});
