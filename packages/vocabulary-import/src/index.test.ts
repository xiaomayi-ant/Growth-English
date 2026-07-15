import { describe, expect, it } from "vitest";
import { parseVocabularyMarkdown } from "./index.js";

describe("parseVocabularyMarkdown", () => {
  it("parses table cells in stable row and column order", () => {
    const result = parseVocabularyMarkdown(
      "/vault/english-words-002.md",
      2,
      `#english #word

| 1 | 2 | 3 |
| --- | --- | --- |
| archive<br>归档<br>/a/ | durable<br>持久的<br>/d/ | phrase here<br>短语<br>- |
`,
    );

    expect(result.entries.map((entry) => entry.id)).toEqual([
      "f002-r001-c01",
      "f002-r001-c02",
      "f002-r001-c03",
    ]);
    expect(result.entries[0]?.word).toBe("archive");
    expect(result.issues).toEqual([]);
  });

  it("keeps duplicate words as separate source entries", () => {
    const result = parseVocabularyMarkdown(
      "/vault/english-words.md",
      1,
      `| 1 | 2 |
| --- | --- |
| repeat<br>重复<br>- | repeat<br>再次<br>- |`,
    );
    expect(result.entries).toHaveLength(2);
    expect(new Set(result.entries.map((entry) => entry.id)).size).toBe(2);
  });
});
