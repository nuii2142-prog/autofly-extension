(function attachPopupPromptTools(root) {
  function parsePromptEntries(text, settings) {
    const options = {
      prefix: "",
      suffix: "",
      dedupe: true,
      ...(settings || {})
    };

    let entries = parsePrompts(text).map((sourcePrompt, index) => {
      const pieces = [options.prefix, sourcePrompt, options.suffix]
        .map((piece) => String(piece || "").trim())
        .filter(Boolean);

      return {
        sourcePrompt,
        prompt: pieces.join(" ").replace(/\{n\}/g, String(index + 1)).trim()
      };
    });

    if (options.dedupe) {
      const seen = new Set();
      entries = entries.filter((entry) => {
        const key = entry.prompt.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    return entries;
  }

  function parsePrompts(text) {
    if (!text || !text.trim()) return [];

    const rows = parseCsvLike(text);
    if (rows.length > 1) {
      const header = rows[0].map((cell) => cell.trim().toLowerCase());
      const promptIndex = header.findIndex((name) => ["prompt", "prompts", "description", "text"].includes(name));
      if (promptIndex >= 0) {
        return rows
          .slice(1)
          .map((row) => row[promptIndex] || "")
          .map(cleanPrompt)
          .filter(Boolean);
      }
    }

    return text
      .replace(/\r/g, "")
      .split("\n")
      .map(cleanPrompt)
      .filter(Boolean);
  }

  function parseCsvLike(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];

      if (char === "\"" && quoted && next === "\"") {
        cell += "\"";
        i += 1;
      } else if (char === "\"") {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        row.push(cell);
        cell = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && next === "\n") i += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }

    row.push(cell);
    rows.push(row);
    return rows.filter((cells) => cells.some((item) => item.trim()));
  }

  function cleanPrompt(value) {
    return String(value || "")
      .replace(/^\uFEFF/, "")
      .replace(/^\s*[-*]\s+/, "")
      .replace(/^\s*\d+[.)]\s+/, "")
      .trim();
  }

  const api = {
    parsePromptEntries,
    parsePrompts,
    parseCsvLike,
    cleanPrompt
  };

  root.NuiiPopupPromptTools = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
