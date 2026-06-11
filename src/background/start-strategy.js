(function attachBackgroundStartStrategy(root) {
  function buildStartMethodPlan(options) {
    const candidateCount = Math.max(0, Number(options && options.candidateCount) || 0);
    const allowKeyboard = Boolean(options && options.allowKeyboard);
    const plan = [
      {
        kind: "dom-click",
        verifyTimeoutMs: 9000
      }
    ];

    for (let index = 0; index < candidateCount; index += 1) {
      plan.push({
        kind: "cdp-click",
        candidateIndex: index,
        verifyTimeoutMs: 6500
      });
    }

    if (allowKeyboard) {
      plan.push({
        kind: "keyboard",
        verifyTimeoutMs: 6500
      });
    }

    return plan;
  }

  const api = {
    buildStartMethodPlan
  };

  root.NuiiBackgroundStartStrategy = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
