const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PROMPT_INPUT_SELECTORS,
  GENERATE_BUTTON_SELECTORS,
  GRID_VIEW_SELECTORS,
  OUTPUT_CONTAINER_SELECTORS
} = require("../src/content/firefly-selectors.js");

test("Firefly selectors include exact reference selectors before generic fallbacks", () => {
  assert.equal(PROMPT_INPUT_SELECTORS[0], 'textarea[aria-label="Prompt"]');
  assert.equal(PROMPT_INPUT_SELECTORS[1], 'textarea[placeholder="Describe your image"]');
  assert.equal(GENERATE_BUTTON_SELECTORS[0], 'sp-button[data-testid="generate-image-generate-button"]');
  assert.ok(GRID_VIEW_SELECTORS.includes('[data-testid="view-switch-to-grid"]'));
  assert.ok(OUTPUT_CONTAINER_SELECTORS.includes("firefly-thumbnail"));
});
