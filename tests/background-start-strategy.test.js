const test = require("node:test");
const assert = require("node:assert/strict");

const { buildStartMethodPlan } = require("../src/background/start-strategy.js");

test("buildStartMethodPlan prefers one DOM click before debugger fallbacks", () => {
  const plan = buildStartMethodPlan({ candidateCount: 2, allowKeyboard: true });

  assert.deepEqual(plan.map((step) => step.kind), [
    "dom-click",
    "cdp-click",
    "cdp-click",
    "keyboard",
    "keyboard"
  ]);
  assert.equal(plan[0].verifyTimeoutMs > plan[1].verifyTimeoutMs, true);
});

test("buildStartMethodPlan splits keyboard submits so each key is verified before the next", () => {
  const plan = buildStartMethodPlan({ candidateCount: 0, allowKeyboard: true });
  const keyboardSteps = plan.filter((step) => step.kind === "keyboard");

  assert.deepEqual(keyboardSteps.map((step) => step.key), ["ctrl-enter", "enter"]);
  keyboardSteps.forEach((step) => assert.equal(step.verifyTimeoutMs > 0, true));
});

test("buildStartMethodPlan omits keyboard unless explicitly allowed", () => {
  const plan = buildStartMethodPlan({ candidateCount: 1, allowKeyboard: false });

  assert.deepEqual(plan.map((step) => step.kind), ["dom-click", "cdp-click"]);
});
