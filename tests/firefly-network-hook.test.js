const test = require("node:test");
const assert = require("node:assert/strict");

const { rewriteResolutionLevel } = require("../src/content/firefly-network-hook.js");

const BODY_1MP =
  '{"prompt":"x","modelVersion":"image5","resolutionLevel":"1MP","aspectRatio":"16:9"}';

test("rewriteResolutionLevel forces 2K (4MP) on a Firefly Image 5 request body", () => {
  // Confirmed live: image5 with resolutionLevel "4MP" returns 2688x1536 (2K),
  // while the web app always sends "1MP" regardless of the 2K picker.
  const out = rewriteResolutionLevel(BODY_1MP, "2K");
  assert.match(out, /"resolutionLevel":"4MP"/);
  assert.doesNotMatch(out, /"1MP"/);
  // everything else is left intact
  assert.match(out, /"aspectRatio":"16:9"/);
  assert.match(out, /"modelVersion":"image5"/);
});

test("rewriteResolutionLevel maps 1K to 1MP", () => {
  assert.match(rewriteResolutionLevel(BODY_1MP, "1K"), /"resolutionLevel":"1MP"/);
});

test("rewriteResolutionLevel leaves the body unchanged for unknown/empty targets", () => {
  assert.equal(rewriteResolutionLevel(BODY_1MP, ""), BODY_1MP);
  assert.equal(rewriteResolutionLevel(BODY_1MP, "4K"), BODY_1MP);
  assert.equal(rewriteResolutionLevel(BODY_1MP, undefined), BODY_1MP);
});

test("rewriteResolutionLevel tolerates a body with no resolutionLevel field", () => {
  const body = '{"prompt":"x","aspectRatio":"1:1"}';
  assert.equal(rewriteResolutionLevel(body, "2K"), body);
});
