const test = require("node:test");
const assert = require("node:assert/strict");

const { extractOutputs } = require("../src/content/firefly-network-hook.js");

test("extractOutputs pulls url+id+seed for each finished output", () => {
  const out = extractOutputs({
    size: { width: 2688, height: 1536 },
    outputs: [
      { seed: 11, image: { id: "aaa", presignedUrl: "https://s3/a.jpg" } },
      { seed: 22, image: { id: "bbb", presignedUrl: "https://s3/b.jpg" } }
    ]
  });
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { url: "https://s3/a.jpg", id: "aaa", seed: 11 });
  assert.deepEqual(out[1], { url: "https://s3/b.jpg", id: "bbb", seed: 22 });
});

test("extractOutputs returns null for non-result bodies", () => {
  assert.equal(extractOutputs(null), null);
  assert.equal(extractOutputs({}), null);
  assert.equal(extractOutputs({ outputs: [] }), null);
  assert.equal(extractOutputs({ outputs: "nope" }), null);
});

test("extractOutputs skips outputs that are still generating (no presignedUrl)", () => {
  // Intermediate polls (progress < 100) carry outputs without a presignedUrl yet.
  assert.equal(extractOutputs({ outputs: [{ seed: 1, image: { id: "x" } }] }), null);

  const partial = extractOutputs({
    outputs: [
      { seed: 1, image: { id: "x" } },
      { seed: 2, image: { id: "y", presignedUrl: "https://s3/y.jpg" } }
    ]
  });
  assert.equal(partial.length, 1);
  assert.equal(partial[0].url, "https://s3/y.jpg");
});

test("extractOutputs tolerates a missing seed (null)", () => {
  const out = extractOutputs({ outputs: [{ image: { id: "z", presignedUrl: "https://s3/z.jpg" } }] });
  assert.deepEqual(out[0], { url: "https://s3/z.jpg", id: "z", seed: null });
});
