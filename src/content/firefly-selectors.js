(function attachFireflySelectors(root) {
  const PROMPT_INPUT_SELECTORS = [
    'textarea[aria-label="Prompt"]',
    'textarea[placeholder="Describe your image"]',
    "textarea.input",
    "textarea",
    "[contenteditable='true']",
    "[role='textbox']",
    "input[type='text']",
    "sp-textfield",
    "sp-textarea",
    "[data-testid*='prompt' i]",
    "[data-test-id*='prompt' i]",
    "[aria-label*='prompt' i]",
    "[aria-label*='describe' i]",
    "[placeholder*='prompt' i]",
    "[placeholder*='describe' i]"
  ];

  const GENERATE_BUTTON_SELECTORS = [
    'sp-button[data-testid="generate-image-generate-button"]',
    "[data-testid='generate-image-generate-button']",
    "button[data-testid*='generate' i]",
    "sp-button[data-testid*='generate' i]",
    "button",
    "[role='button']",
    "sp-button",
    "a"
  ];

  // Grid-view toggles only. History-view toggles must never be listed here:
  // preferGridView clicks the first visible match before every submit.
  const GRID_VIEW_SELECTORS = [
    '[data-testid="view-switch-to-grid"]',
    'sp-action-button[value="grid"]',
    '[aria-label="Grid"]'
  ];

  const OUTPUT_CONTAINER_SELECTORS = [
    '[data-testid="batch-grid-0"]',
    "firefly-collapsible-batch-grid",
    "firefly-thumbnail"
  ];

  // Per-generation batch cards, newest first. Used to track completion of the
  // batch created by the current submission, ignoring the rest of the page.
  const BATCH_CONTAINER_SELECTORS = [
    '[data-testid="batch-grid-0"]',
    "firefly-collapsible-batch-grid"
  ];

  const api = {
    PROMPT_INPUT_SELECTORS,
    GENERATE_BUTTON_SELECTORS,
    GRID_VIEW_SELECTORS,
    OUTPUT_CONTAINER_SELECTORS,
    BATCH_CONTAINER_SELECTORS
  };

  root.NuiiContentSelectors = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
