(function attachResolutionControl(root) {
  // Firefly exposes resolution as a single-select Spectrum menu. Each option is
  // an <sp-menu-item data-testid="firefly-menu-item-<value>" role="menuitemradio"
  // aria-checked="true|false">. A full page reload resets the selection to the
  // 1K default, so the runner must re-apply the desired value before every
  // Generate. These helpers stay DOM-free so they can be unit tested.
  const RESOLUTION_VALUES = ["1K", "2K"];
  const DEFAULT_RESOLUTION = "2K";

  // Option items, always present in the picker. The trigger opens the menu when
  // the options are not yet rendered/visible (closed picker after a reload).
  const RESOLUTION_ITEM_SELECTOR = '[data-testid^="firefly-menu-item-"]';
  const RESOLUTION_TRIGGER_SELECTORS = [
    'sp-picker[aria-label="Resolution"]',
    'sp-picker[label="Resolution"]',
    '[role="button"][aria-label="Resolution"]',
    'button[aria-label="Resolution"]'
  ];

  function isSupportedResolution(value) {
    return RESOLUTION_VALUES.includes(value);
  }

  function menuItemTestId(value) {
    return `firefly-menu-item-${value}`;
  }

  function menuItemSelector(value) {
    return `[data-testid="${menuItemTestId(value)}"]`;
  }

  // items: [{ value, checked }] read from the DOM radios. Returns the value of
  // the currently selected option, or null when nothing is checked yet.
  function currentResolution(items) {
    const checked = (items || []).find((item) => item && item.checked);
    return checked ? checked.value : null;
  }

  // True only when the target is supported AND differs from what is selected.
  function needsChange(items, target) {
    if (!isSupportedResolution(target)) return false;
    return currentResolution(items) !== target;
  }

  const api = {
    RESOLUTION_VALUES,
    DEFAULT_RESOLUTION,
    RESOLUTION_ITEM_SELECTOR,
    RESOLUTION_TRIGGER_SELECTORS,
    isSupportedResolution,
    menuItemTestId,
    menuItemSelector,
    currentResolution,
    needsChange
  };

  root.NuiiContentResolution = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
