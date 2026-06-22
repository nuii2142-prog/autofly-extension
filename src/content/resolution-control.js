(function attachResolutionControl(root) {
  // Firefly exposes resolution as an sp-picker that carries the current selection
  // in its `value` attribute ("1K"/"2K"); each option is an
  // <sp-menu-item data-testid="firefly-menu-item-<value>" role="option">. Reading
  // the picker's value is exact, so the runner does not infer the selection from
  // menu-item state. A full page reload resets the picker to the 1K default, so
  // the runner re-applies the desired value before every Generate. Models without
  // a resolution control (e.g. Firefly Image 4, fixed size) have no such picker.
  // These helpers stay DOM-free so they can be unit tested.
  const RESOLUTION_VALUES = ["1K", "2K"];
  const DEFAULT_RESOLUTION = "2K";

  // The resolution picker itself (stable testid). Its `value` attribute holds the
  // current selection; clicking it opens the 1K/2K options.
  const RESOLUTION_PICKER_SELECTOR = 'sp-picker[data-testid="firefly-picker-output-resolution"]';
  // Option items, present in the DOM but only visible once the picker is open.
  const RESOLUTION_ITEM_SELECTOR = '[data-testid^="firefly-menu-item-"]';
  const RESOLUTION_TRIGGER_SELECTORS = [
    RESOLUTION_PICKER_SELECTOR,
    'sp-picker[aria-label="Resolution"]',
    'sp-picker[label="Resolution"]',
    '[role="button"][aria-label="Resolution"]',
    'button[aria-label="Resolution"]'
  ];

  // Reduce any raw selection signal to a comparable token. The DOM exposes the
  // value in several shapes depending on the model UI: a "value" attribute
  // ("2K"), the testid fallback ("firefly-menu-item-2K"), or the visible label
  // ("2K"). Normalizing strips the testid prefix and uppercases so all three
  // compare equal. Without this, a model whose menu item lacks a value attribute
  // (e.g. Firefly Image 5) never confirms and silently stays at 1K.
  function normalizeResolution(value) {
    return String(value == null ? "" : value)
      .trim()
      .replace(/^firefly-menu-item-/i, "")
      .toUpperCase();
  }

  function isSupportedResolution(value) {
    return RESOLUTION_VALUES.includes(normalizeResolution(value));
  }

  function menuItemTestId(value) {
    return `firefly-menu-item-${value}`;
  }

  function menuItemSelector(value) {
    return `[data-testid="${menuItemTestId(value)}"]`;
  }

  // items: [{ value, checked }] read from the DOM radios. Returns the normalized
  // value of the currently selected option, or null when nothing is checked yet.
  function currentResolution(items) {
    const checked = (items || []).find((item) => item && item.checked);
    return checked ? normalizeResolution(checked.value) : null;
  }

  // True if an item's value/label/testid resolves to the target resolution.
  function itemMatchesResolution(item, target) {
    if (!item) return false;
    const wanted = normalizeResolution(target);
    return [item.value, item.label, item.testid].some(
      (candidate) => candidate != null && normalizeResolution(candidate) === wanted
    );
  }

  // True only when the target is supported AND differs from what is selected.
  function needsChange(items, target) {
    if (!isSupportedResolution(target)) return false;
    return currentResolution(items) !== normalizeResolution(target);
  }

  const api = {
    RESOLUTION_VALUES,
    DEFAULT_RESOLUTION,
    RESOLUTION_PICKER_SELECTOR,
    RESOLUTION_ITEM_SELECTOR,
    RESOLUTION_TRIGGER_SELECTORS,
    isSupportedResolution,
    normalizeResolution,
    menuItemTestId,
    menuItemSelector,
    currentResolution,
    itemMatchesResolution,
    needsChange
  };

  root.NuiiContentResolution = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
