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

test("RESOLUTION_PICKER_SELECTOR targets the verified Firefly Image 5 picker", () => {
  // Empirically confirmed on the live page: the resolution control is an
  // sp-picker carrying value="1K"/"2K"; the prior aria-label selector matched
  // nothing, which is why setting 2K silently failed.
  assert.equal(
    Resolution.RESOLUTION_PICKER_SELECTOR,
    'sp-picker[data-testid="firefly-picker-output-resolution"]'
  );
  assert.equal(Resolution.RESOLUTION_TRIGGER_SELECTORS[0], Resolution.RESOLUTION_PICKER_SELECTOR);
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

test("normalizeResolution strips the testid prefix and uppercases", () => {
  assert.equal(Resolution.normalizeResolution("2K"), "2K");
  assert.equal(Resolution.normalizeResolution("firefly-menu-item-2K"), "2K");
  assert.equal(Resolution.normalizeResolution("firefly-menu-item-1k"), "1K");
  assert.equal(Resolution.normalizeResolution(" 2k "), "2K");
  assert.equal(Resolution.normalizeResolution(undefined), "");
});

test("currentResolution normalizes a testid-only value (Firefly Image 5 shape)", () => {
  assert.equal(
    Resolution.currentResolution([
      { value: "firefly-menu-item-1K", checked: false },
      { value: "firefly-menu-item-2K", checked: true }
    ]),
    "2K"
  );
});

test("needsChange handles testid-only values without a value attribute", () => {
  // The bug: a menu item exposes only data-testid, so the raw value is
  // "firefly-menu-item-2K". It must still compare equal to the "2K" target.
  assert.equal(
    Resolution.needsChange([{ value: "firefly-menu-item-2K", checked: true }], "2K"),
    false
  );
  assert.equal(
    Resolution.needsChange([{ value: "firefly-menu-item-1K", checked: true }], "2K"),
    true
  );
});

test("itemMatchesResolution matches on value, label, or testid", () => {
  assert.equal(Resolution.itemMatchesResolution({ value: "2K" }, "2K"), true);
  assert.equal(Resolution.itemMatchesResolution({ label: "2K" }, "2K"), true);
  assert.equal(Resolution.itemMatchesResolution({ testid: "firefly-menu-item-2K" }, "2K"), true);
  assert.equal(Resolution.itemMatchesResolution({ value: "1K" }, "2K"), false);
  assert.equal(Resolution.itemMatchesResolution(null, "2K"), false);
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
