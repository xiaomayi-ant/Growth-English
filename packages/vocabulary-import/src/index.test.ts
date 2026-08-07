import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadVocabulary, parseVocabularyMarkdown, VocabImportError } from "./index.js";

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

describe("loadVocabulary", () => {
  it("throws VOCAB_DIR_NOT_FOUND when the directory does not exist", async () => {
    const missing = path.join(tmpdir(), "en-play-test", "no-such-vocab-dir");
    await expect(loadVocabulary(missing)).rejects.toMatchObject({
      name: "VocabImportError",
      code: "VOCAB_DIR_NOT_FOUND",
    });
    await expect(loadVocabulary(missing)).rejects.toBeInstanceOf(VocabImportError);
    await expect(loadVocabulary(missing)).rejects.toThrow(missing);
  });

  it("throws VOCAB_DIR_EMPTY when no english-words*.md files exist", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "en-play-vocab-"));
    try {
      await expect(loadVocabulary(directory)).rejects.toMatchObject({
        name: "VocabImportError",
        code: "VOCAB_DIR_EMPTY",
      });
      await expect(loadVocabulary(directory)).rejects.toThrow(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
