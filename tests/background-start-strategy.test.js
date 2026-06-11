const test = require("node:test");
const assert = require("node:assert/strict");

const { buildStartMethodPlan } = require("../src/background/start-strategy.js");

test("buildStartMethodPlan prefers one DOM click before debugger fallbacks", () => {
  const plan = buildStartMethodPlan({ candidateCount: 2, allowKeyboard: true });

  assert.deepEqual(plan.map((step) => step.kind), [
    "dom-click",
    "cdp-click",
    "cdp-click",
    "keyboard"
  ]);
  assert.equal(plan[0].verifyTimeoutMs > plan[1].verifyTimeoutMs, true);
});

test("buildStartMethodPlan omits keyboard unless explicitly allowed", () => {
  const plan = buildStartMethodPlan({ candidateCount: 1, allowKeyboard: false });

  assert.deepEqual(plan.map((step) => step.kind), ["dom-click", "cdp-click"]);
});
