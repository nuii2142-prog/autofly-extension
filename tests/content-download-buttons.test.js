const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isSafeDownloadCandidate,
  filterDownloadCandidates
} = require("../src/content/download-buttons.js");

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
