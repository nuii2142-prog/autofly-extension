const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isSafeDownloadCandidate,
  filterDownloadCandidates,
  resolveDownloadLimit,
  selectFreshDownloads
} = require("../src/content/download-buttons.js");

test("resolveDownloadLimit skips downloads when the new-image count is unknown or zero", () => {
  assert.equal(resolveDownloadLimit(0), 0);
  assert.equal(resolveDownloadLimit(undefined), 0);
  assert.equal(resolveDownloadLimit(null), 0);
  assert.equal(resolveDownloadLimit(-2), 0);
  assert.equal(resolveDownloadLimit("garbage"), 0);
});

test("resolveDownloadLimit caps a known image count at 8", () => {
  assert.equal(resolveDownloadLimit(1), 1);
  assert.equal(resolveDownloadLimit(4), 4);
  assert.equal(resolveDownloadLimit(8), 8);
  assert.equal(resolveDownloadLimit(20), 8);
});

test("isSafeDownloadCandidate accepts a real download button", () => {
  assert.equal(
    isSafeDownloadCandidate({
      label: "Download",
      tagName: "BUTTON",
      hasDownloadAttr: false,
      inNavigation: false
    }),
    true
  );
});

test("isSafeDownloadCandidate accepts a class-labelled download control", () => {
  assert.equal(
    isSafeDownloadCandidate({
      label: "download-button icon-action",
      tagName: "SP-BUTTON",
      hasDownloadAttr: false,
      inNavigation: false
    }),
    true
  );
});

test("isSafeDownloadCandidate rejects labels without the word download", () => {
  assert.equal(
    isSafeDownloadCandidate({
      label: "Save to gallery",
      tagName: "BUTTON",
      hasDownloadAttr: false,
      inNavigation: false
    }),
    false
  );
});

test("isSafeDownloadCandidate rejects navigation and marketing controls", () => {
  assert.equal(
    isSafeDownloadCandidate({
      label: "Download",
      tagName: "BUTTON",
      hasDownloadAttr: false,
      inNavigation: true
    }),
    false
  );
  assert.equal(
    isSafeDownloadCandidate({
      label: "Download the app",
      tagName: "BUTTON",
      hasDownloadAttr: false,
      inNavigation: false
    }),
    false
  );
});

test("isSafeDownloadCandidate rejects plain links but allows download links", () => {
  assert.equal(
    isSafeDownloadCandidate({
      label: "Download",
      tagName: "A",
      hasDownloadAttr: false,
      inNavigation: false
    }),
    false
  );
  assert.equal(
    isSafeDownloadCandidate({
      label: "Download",
      tagName: "A",
      hasDownloadAttr: true,
      inNavigation: false
    }),
    true
  );
});

test("filterDownloadCandidates filters by descriptor and applies the limit", () => {
  const safe = (index) => ({
    element: `button-${index}`,
    descriptor: { label: "Download", tagName: "BUTTON", hasDownloadAttr: false, inNavigation: false }
  });
  const unsafe = {
    element: "footer-link",
    descriptor: { label: "Download the app", tagName: "A", hasDownloadAttr: false, inNavigation: true }
  };

  const result = filterDownloadCandidates([unsafe, safe(1), safe(2), safe(3)], 2);
  assert.equal(result.length, 2);
  assert.equal(result[0].element, "button-1");
  assert.equal(result[1].element, "button-2");
});

test("selectFreshDownloads returns only controls absent from the snapshot", () => {
  const a = { element: "a" };
  const b = { element: "b" };
  const c = { element: "c" };
  const known = new Set(["a", "b"]); // a, b existed before this prompt
  const result = selectFreshDownloads([a, b, c], known, { cap: 12, fallbackLimit: 4 });
  assert.equal(result.strategy, "fresh");
  assert.deepEqual(result.items, [c]);
  assert.equal(result.fresh, 1);
});

test("selectFreshDownloads downloads nothing when no control is new", () => {
  const a = { element: "a" };
  const result = selectFreshDownloads([a], new Set(["a"]), { cap: 12, fallbackLimit: 4 });
  assert.equal(result.strategy, "none");
  assert.deepEqual(result.items, []);
});

test("selectFreshDownloads falls back to top-N when too many look fresh", () => {
  // Snapshot empty (e.g. it failed) and the whole accumulated feed looks new:
  // cap the damage to the detected count instead of grabbing everything.
  const many = Array.from({ length: 20 }, (_, i) => ({ element: `e${i}` }));
  const result = selectFreshDownloads(many, new Set(), { cap: 12, fallbackLimit: 4 });
  assert.equal(result.strategy, "fallback");
  assert.equal(result.items.length, 4);
  assert.equal(result.fresh, 20);
});
