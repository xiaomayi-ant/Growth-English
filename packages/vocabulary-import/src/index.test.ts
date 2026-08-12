import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadVocabulary, parseVocabularyMarkdown, VocabImportError } from "./index.js";

const TABLE = `| 1 | 2 |
| --- | --- |
| alpha<br>甲<br>/a/ | beta<br>乙<br>/b/ |
`;

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
    const missing = path.join(tmpdir(), "enpet-test", "no-such-vocab-dir");
    await expect(loadVocabulary(missing)).rejects.toMatchObject({
      name: "VocabImportError",
      code: "VOCAB_DIR_NOT_FOUND",
    });
    await expect(loadVocabulary(missing)).rejects.toBeInstanceOf(VocabImportError);
    await expect(loadVocabulary(missing)).rejects.toThrow(missing);
  });

  // 首次使用时词库目录必然是空的，这是正常状态而不是错误
  it("returns an empty result when no vocabulary files exist", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "enpet-vocab-"));
    try {
      await expect(loadVocabulary(directory)).resolves.toEqual({
        entries: [],
        issues: [],
        files: 0,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("custom file prefix", () => {
  it("discovers files under a custom prefix and keeps the suffix as fileIndex", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "enpet-prefix-"));
    try {
      await writeFile(path.join(directory, "我的词库.md"), TABLE, "utf8");
      await writeFile(path.join(directory, "我的词库-002.md"), TABLE, "utf8");
      // 默认前缀的文件此时不应被收进来
      await writeFile(path.join(directory, "english-words.md"), TABLE, "utf8");

      const result = await loadVocabulary(directory, "我的词库");

      expect(result.files).toBe(2);
      expect(result.entries.map((entry) => entry.id)).toEqual([
        "f001-r001-c01",
        "f001-r001-c02",
        "f002-r001-c01",
        "f002-r001-c02",
      ]);
      expect(result.entries.every((entry) => entry.sourcePath.includes("我的词库"))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("treats prefix regex characters literally", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "enpet-prefix-"));
    try {
      await writeFile(path.join(directory, "a.b.md"), TABLE, "utf8");
      await writeFile(path.join(directory, "axbxmd.md"), TABLE, "utf8");

      const result = await loadVocabulary(directory, "a.b");

      expect(result.files).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
