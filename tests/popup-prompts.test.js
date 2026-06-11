const test = require("node:test");
const assert = require("node:assert/strict");

const { parsePromptEntries } = require("../src/popup/prompt-tools.js");

test("parsePromptEntries reads prompt column from CSV and applies prefix suffix numbering", () => {
  const entries = parsePromptEntries(
    "id,prompt,notes\n1,\"red fox, watercolor\",first\n2,blue whale,second",
    {
      prefix: "studio shot {n}",
      suffix: "high detail",
      dedupe: true
    }
  );

  assert.deepEqual(entries, [
    {
      sourcePrompt: "red fox, watercolor",
      prompt: "studio shot 1 red fox, watercolor high detail"
    },
    {
      sourcePrompt: "blue whale",
      prompt: "studio shot 2 blue whale high detail"
    }
  ]);
});

test("parsePromptEntries removes duplicate final prompts when dedupe is enabled", () => {
  const entries = parsePromptEntries("cat\nCat\n dog ", {
    prefix: "",
    suffix: "",
    dedupe: true
  });

  assert.deepEqual(entries, [
    { sourcePrompt: "cat", prompt: "cat" },
    { sourcePrompt: "dog", prompt: "dog" }
  ]);
});
