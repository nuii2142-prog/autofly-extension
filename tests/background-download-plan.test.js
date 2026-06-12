const test = require("node:test");
const assert = require("node:assert/strict");

const {
  sanitizeSubfolder,
  promptSlug,
  extensionFromUrl,
  buildDownloadPlan
} = require("../src/background/download-plan.js");

test("sanitizeSubfolder falls back to a default for empty input", () => {
  assert.equal(sanitizeSubfolder(""), "Firefly-AutoFly");
  assert.equal(sanitizeSubfolder("   "), "Firefly-AutoFly");
  assert.equal(sanitizeSubfolder(null), "Firefly-AutoFly");
});

test("sanitizeSubfolder strips path traversal and absolute roots", () => {
  assert.equal(sanitizeSubfolder("../../etc"), "etc");
  assert.equal(sanitizeSubfolder("/var/www"), "var/www");
  assert.equal(sanitizeSubfolder("..\\..\\windows"), "windows");
  assert.equal(sanitizeSubfolder("a/../b"), "a/b");
});

test("sanitizeSubfolder keeps nested folders and cleans illegal characters", () => {
  assert.equal(sanitizeSubfolder("My Images/Firefly"), "My-Images/Firefly");
  assert.equal(sanitizeSubfolder('bad:*?"<>|name'), "bad-name");
  assert.equal(sanitizeSubfolder("trailing.dots..."), "trailing.dots");
});

test("promptSlug drops stopwords and keeps the first meaningful words", () => {
  assert.equal(
    promptSlug("A young couple at a kitchen table sorting household bills"),
    "young-couple-kitchen-table-sorting"
  );
  assert.equal(promptSlug(""), "image");
  assert.equal(promptSlug("the of at in on"), "image");
});

test("promptSlug is filename-safe and bounded", () => {
  const slug = promptSlug("Über-detailed, hyper realistic!!! photo (8k) of a CAT");
  assert.match(slug, /^[a-z0-9-]+$/);
  assert.ok(slug.length <= 48);
});

test("extensionFromUrl reads the image extension or defaults to jpg", () => {
  assert.equal(extensionFromUrl("https://cdn.firefly.com/abc.png?sig=1"), ".png");
  assert.equal(extensionFromUrl("https://cdn.firefly.com/abc.JPEG"), ".jpeg");
  assert.equal(extensionFromUrl("https://cdn.firefly.com/abc.webp#frag"), ".webp");
  assert.equal(extensionFromUrl("https://cdn.firefly.com/no-extension"), ".jpg");
});

test("extensionFromUrl reads the mime type from a data URL", () => {
  assert.equal(extensionFromUrl("data:image/png;base64,AAAA"), ".png");
  assert.equal(extensionFromUrl("data:image/webp;base64,AAAA"), ".webp");
  assert.equal(extensionFromUrl("data:image/jpeg;base64,AAAA"), ".jpg");
});

test("buildDownloadPlan accepts data URLs as well as http(s)", () => {
  const plan = buildDownloadPlan({
    urls: ["data:image/png;base64,AAAA", "blob:nope", "https://cdn/ok.jpg"],
    index: 2,
    prompt: "two images",
    subfolder: "x"
  });

  assert.equal(plan.length, 2);
  assert.equal(plan[0].filename, "x/002-two-images-1.png");
  assert.equal(plan[1].filename, "x/002-two-images-2.jpg");
});

test("buildDownloadPlan names a single image by position and prompt slug", () => {
  const plan = buildDownloadPlan({
    urls: ["https://cdn.firefly.com/img1.jpg?x=1"],
    index: 1,
    prompt: "A young couple at a kitchen table",
    subfolder: "Firefly-AutoFly"
  });

  assert.deepEqual(plan, [
    { url: "https://cdn.firefly.com/img1.jpg?x=1", filename: "Firefly-AutoFly/001-young-couple-kitchen-table.jpg" }
  ]);
});

test("buildDownloadPlan suffixes multiple images per prompt", () => {
  const plan = buildDownloadPlan({
    urls: [
      "https://cdn.firefly.com/a.png",
      "https://cdn.firefly.com/b.png"
    ],
    index: 12,
    prompt: "Close-up of diverse hands",
    subfolder: "shots"
  });

  assert.equal(plan.length, 2);
  assert.equal(plan[0].filename, "shots/012-close-up-diverse-hands-1.png");
  assert.equal(plan[1].filename, "shots/012-close-up-diverse-hands-2.png");
});

test("buildDownloadPlan drops blob urls but keeps http(s) and data urls", () => {
  const plan = buildDownloadPlan({
    urls: ["blob:https://firefly.adobe.com/abc", "data:image/png;base64,xxxx", "https://cdn/ok.jpg"],
    index: 3,
    prompt: "test prompt",
    subfolder: "x"
  });

  assert.equal(plan.length, 2);
  assert.equal(plan[0].url, "data:image/png;base64,xxxx");
  assert.equal(plan[1].url, "https://cdn/ok.jpg");
});

test("buildDownloadPlan returns an empty plan when no usable urls exist", () => {
  assert.deepEqual(
    buildDownloadPlan({ urls: ["blob:foo"], index: 1, prompt: "p", subfolder: "x" }),
    []
  );
  assert.deepEqual(
    buildDownloadPlan({ urls: [], index: 1, prompt: "p", subfolder: "x" }),
    []
  );
});
