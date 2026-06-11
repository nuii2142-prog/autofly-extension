const test = require("node:test");
const assert = require("node:assert/strict");

const {
  choosePromptInputCandidate,
  promptValueMatches
} = require("../src/content/prompt-control.js");

test("choosePromptInputCandidate skips visible prompt labels that are not editable", () => {
  assert.equal(
    choosePromptInputCandidate([
      { element: "result prompt text", target: null, visible: true, disabled: false },
      { element: "textarea", target: "textarea", visible: true, disabled: false }
    ]),
    "textarea"
  );
});

test("choosePromptInputCandidate ignores disabled or hidden editables", () => {
  assert.equal(
    choosePromptInputCandidate([
      { element: "hidden textarea", target: "hidden textarea", visible: false, disabled: false },
      { element: "disabled textarea", target: "disabled textarea", visible: true, disabled: true },
      { element: "active textarea", target: "active textarea", visible: true, disabled: false }
    ]),
    "active textarea"
  );
});

test("promptValueMatches compares normalized prompt box values", () => {
  assert.equal(promptValueMatches("  first prompt\nwith spacing  ", "first prompt with spacing"), true);
  assert.equal(promptValueMatches("old prompt", "new prompt"), false);
});
