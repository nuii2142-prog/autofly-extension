const test = require("node:test");
const assert = require("node:assert/strict");

const { sanitizeSettings } = require("../src/shared/settings.js");
const { isControlSenderAllowed, normalizeTabMessageResponse } = require("../src/shared/message.js");

test("isControlSenderAllowed accepts extension pages and rejects content-script senders", () => {
  assert.equal(isControlSenderAllowed({ id: "ext-id" }), true);
  assert.equal(isControlSenderAllowed({ id: "ext-id", tab: { id: 12 } }), false);
  assert.equal(isControlSenderAllowed(undefined), false);
  assert.equal(isControlSenderAllowed(null), false);
});

test("sanitizeSettings clamps numeric controls and preserves booleans", () => {
  const settings = sanitizeSettings({
    delay: 0,
    timeout: 999,
    retryLimit: 9,
    autoDownload: 1,
    autoDelete: 0,
    continueOnError: "",
    platform: "current-tab",
    stayOnGenerate: false
  });

  assert.equal(settings.delay, 1);
  assert.equal(settings.timeout, 600);
  assert.equal(settings.retryLimit, 3);
  assert.equal(settings.autoDownload, true);
  assert.equal(settings.autoDelete, false);
  assert.equal(settings.continueOnError, false);
  assert.equal(settings.platform, "current-tab");
  assert.equal(settings.stayOnGenerate, false);
});

test("normalizeTabMessageResponse turns missing content responses into explicit failures", () => {
  assert.deepEqual(
    normalizeTabMessageResponse(undefined, "Could not establish connection. Receiving end does not exist."),
    {
      success: false,
      error: "Could not establish connection. Receiving end does not exist."
    }
  );

  assert.deepEqual(
    normalizeTabMessageResponse({ success: true, value: 3 }, ""),
    { success: true, value: 3 }
  );
});
