const test = require("node:test");
const assert = require("node:assert/strict");

const Resolution = require("../src/content/resolution-control.js");

test("isSupportedResolution accepts only the known Firefly values", () => {
  assert.equal(Resolution.isSupportedResolution("1K"), true);
  assert.equal(Resolution.isSupportedResolution("2K"), true);
  assert.equal(Resolution.isSupportedResolution("4K"), false);
  assert.equal(Resolution.isSupportedResolution(""), false);
  assert.equal(Resolution.isSupportedResolution(undefined), false);
});

test("menuItemSelector targets the verified Firefly testid", () => {
  assert.equal(Resolution.menuItemSelector("2K"), '[data-testid="firefly-menu-item-2K"]');
  assert.equal(Resolution.menuItemSelector("1K"), '[data-testid="firefly-menu-item-1K"]');
});

test("currentResolution returns the checked option, or null when none is checked", () => {
  assert.equal(
    Resolution.currentResolution([
      { value: "1K", checked: true },
      { value: "2K", checked: false }
    ]),
    "1K"
  );
  assert.equal(
    Resolution.currentResolution([
      { value: "1K", checked: false },
      { value: "2K", checked: true }
    ]),
    "2K"
  );
  assert.equal(Resolution.currentResolution([]), null);
  assert.equal(Resolution.currentResolution(undefined), null);
});

test("needsChange is true only when a supported target differs from the selection", () => {
  // Reload default is 1K — the bug condition: user wants 2K, page shows 1K.
  assert.equal(
    Resolution.needsChange([{ value: "1K", checked: true }, { value: "2K", checked: false }], "2K"),
    true
  );
  // Already on the target — no work to do.
  assert.equal(
    Resolution.needsChange([{ value: "1K", checked: false }, { value: "2K", checked: true }], "2K"),
    false
  );
  // Unsupported target is never actioned.
  assert.equal(
    Resolution.needsChange([{ value: "1K", checked: true }], "4K"),
    false
  );
  // Nothing checked yet still counts as needing the target applied.
  assert.equal(Resolution.needsChange([], "2K"), true);
});
