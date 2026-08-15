import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AppConfig,
  DEFAULT_VOCAB_FORMAT,
  type ScenarioContent,
  type SourceEntry,
} from "@enpet/core";
import type { ContentGenerator } from "@enpet/evaluation";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type EnPetApp } from "./app.js";

const baseConfig: AppConfig = {
  host: "127.0.0.1",
  port: 4173,
  timeZone: "Asia/Shanghai",
  vocabDir: "/tmp/does-not-matter",
  vocabFilePrefix: "english-words",
  vocabFormat: DEFAULT_VOCAB_FORMAT,
  databasePath: ":memory:",
  reportsDir: "/tmp/enpet-test/reports",
  reviewQueuePath: "/tmp/enpet-test/review-queue.md",
  newWordsPerDay: 6,
  reviewLimit: 30,
  reminderTime: "09:00",
};

class TestGenerator implements ContentGenerator {
  async generateScenario(candidates: SourceEntry[], count: number): Promise<ScenarioContent> {
    const selected = candidates.slice(0, count);
    return {
      selectedEntryIds: selected.map((entry) => entry.id),
      theme: "test",
      passage: "test passage",
      referenceTranslation: "测试短文",
    };
  }
}

describe("API", () => {
  let app: EnPetApp;

  beforeEach(async () => {
    app = await buildApp({ ...baseConfig }, new TestGenerator());
    app.enPetDatabase.importEntries(
      Array.from({ length: 6 }, (_, index) => ({
        id: `f001-r001-c0${index + 1}`,
        fileIndex: 1,
        rowIndex: 1,
        columnIndex: index + 1,
        sourcePath: "/vault/english-words.md",
        word: `word-${index + 1}`,
        meaning: `meaning-${index + 1}`,
        phonetic: "-",
        sourceOrder: 100_000 + index,
      })),
      1,
      [],
    );
  });

  afterEach(async () => app.close());

  // 目录存在但还没有词库文件是首次使用的正常状态，不能当成失败
  it("reports an empty import instead of failing when the directory has no vocabulary files", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "enpet-empty-vocab-"));
    const empty = await buildApp({ ...baseConfig, vocabDir: directory }, new TestGenerator());
    try {
      const response = await empty.inject({ method: "POST", url: "/api/import" });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.files).toBe(0);
      expect(body.inserted).toBe(0);
      expect(body.message).toContain("english-words");
    } finally {
      await empty.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  // 引导创建的示例词库必须能被原样导入：格式探测不能被"已存默认格式"挡住
  it("imports the sample vocabulary the wizard just created", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "enpet-sample-"));
    const vocabDir = path.join(directory, "vault");
    const { vocabFormat: _ignored, ...withoutFormat } = baseConfig;
    const scoped = await buildApp(
      { ...withoutFormat, vocabDir, databasePath: path.join(directory, "enpet.sqlite3") },
      new TestGenerator(),
    );
    try {
      await scoped.inject({
        method: "POST",
        url: "/api/onboarding/setup-vault",
        payload: { vaultPath: vocabDir, withSample: true },
      });
      const response = await scoped.inject({ method: "POST", url: "/api/import" });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.files).toBe(1);
      expect(body.inserted).toBe(6);
      expect(body.issues).toEqual([]);
    } finally {
      await scoped.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  // 词库目录必须是可以被 Obsidian 直接打开的 vault
  it("makes the vocabulary directory an Obsidian vault", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "enpet-vault-"));
    const vocabDir = path.join(directory, "vault");
    const scoped = await buildApp(
      { ...baseConfig, vocabDir, databasePath: path.join(directory, "enpet.sqlite3") },
      new TestGenerator(),
    );
    try {
      const response = await scoped.inject({
        method: "POST",
        url: "/api/onboarding/setup-vault",
        payload: { vaultPath: vocabDir, withSample: true },
      });
      expect(response.statusCode).toBe(200);
      expect(existsSync(path.join(vocabDir, ".obsidian", "app.json"))).toBe(true);
      expect(response.json().obsidianLink).toBe(
        `obsidian://open?path=${encodeURIComponent(vocabDir)}`,
      );
    } finally {
      await scoped.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("writes the onboarding marker so the wizard stops replaying", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "enpet-onboarding-"));
    const databasePath = path.join(directory, "enpet.sqlite3");
    const scoped = await buildApp({ ...baseConfig, databasePath }, new TestGenerator());
    try {
      expect((await scoped.inject({ method: "GET", url: "/api/onboarding" })).json().step).not.toBe(
        "complete",
      );
      const response = await scoped.inject({ method: "POST", url: "/api/onboarding/complete" });
      expect(response.statusCode).toBe(200);
      expect(existsSync(path.join(directory, ".onboarding-complete"))).toBe(true);
    } finally {
      await scoped.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  // 空词库时主界面给的是「用示例词先试试」一个按钮，它背后就是这个接口：
  // 建词库文件再导入，一步到位，用户不需要先懂什么是 vault。
  describe("sample vault", () => {
    let directory: string;
    let scoped: EnPetApp;

    beforeEach(async () => {
      directory = await mkdtemp(path.join(tmpdir(), "enpet-sample-vault-"));
      scoped = await buildApp(
        {
          ...baseConfig,
          vocabDir: path.join(directory, "vault"),
          databasePath: path.join(directory, "enpet.sqlite3"),
        },
        new TestGenerator(),
      );
    });

    afterEach(async () => {
      await scoped.close();
      await rm(directory, { recursive: true, force: true });
    });

    it("creates the sample vocabulary and imports it in one step", async () => {
      const response = await scoped.inject({ method: "POST", url: "/api/vault/sample" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ files: 1, inserted: 6, issues: [] });

      expect(existsSync(path.join(directory, "vault", "english-words.md"))).toBe(true);
      // 词库目录同时要是个能被 Obsidian 直接打开的 vault
      expect(existsSync(path.join(directory, "vault", ".obsidian", "app.json"))).toBe(true);

      const health = (await scoped.inject({ method: "GET", url: "/api/health" })).json();
      expect(health.sourceEntries).toBe(6);
    });

    // 用户已经有词库时误点了这个按钮，不能把人家的文件冲掉
    it("never overwrites an existing vocabulary file", async () => {
      await scoped.inject({ method: "POST", url: "/api/vault/sample" });
      const samplePath = path.join(directory, "vault", "english-words.md");
      await writeFile(samplePath, "# 我自己的词库\n\n| 单词 | 音标 | 释义 |\n| :- | :- | :- |\n");

      await scoped.inject({ method: "POST", url: "/api/vault/sample" });

      expect(await readFile(samplePath, "utf8")).toContain("我自己的词库");
    });
  });

  // 设置页此前只是个壳：读的是硬编码默认值，保存则是一个假的 setTimeout。
  // 这组测试钉住「存得下、读得回、当场生效」三件事。
  describe("settings", () => {
    let directory: string;
    let scoped: EnPetApp;

    beforeEach(async () => {
      directory = await mkdtemp(path.join(tmpdir(), "enpet-settings-"));
      scoped = await buildApp(
        { ...baseConfig, databasePath: path.join(directory, "enpet.sqlite3") },
        new TestGenerator(),
      );
    });

    afterEach(async () => {
      await scoped.close();
      await rm(directory, { recursive: true, force: true });
    });

    it("returns the editable settings currently in effect", async () => {
      const response = await scoped.inject({ method: "GET", url: "/api/settings" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        vocabDir: baseConfig.vocabDir,
        vocabFilePrefix: baseConfig.vocabFilePrefix,
        newWordsPerDay: 6,
        reviewLimit: 30,
        reminderTime: "09:00",
      });
    });

    it("persists an update to settings.json and reads it back", async () => {
      const response = await scoped.inject({
        method: "PUT",
        url: "/api/settings",
        payload: { newWordsPerDay: 3, reminderTime: "21:30" },
      });
      expect(response.statusCode).toBe(200);

      const onDisk = JSON.parse(await readFile(path.join(directory, "settings.json"), "utf8"));
      expect(onDisk).toMatchObject({ newWordsPerDay: 3, reminderTime: "21:30" });

      const reread = await scoped.inject({ method: "GET", url: "/api/settings" });
      expect(reread.json()).toMatchObject({ newWordsPerDay: 3, reminderTime: "21:30" });
    });

    it("leaves untouched fields alone instead of resetting them to defaults", async () => {
      await scoped.inject({ method: "PUT", url: "/api/settings", payload: { reviewLimit: 50 } });
      await scoped.inject({
        method: "PUT",
        url: "/api/settings",
        payload: { reminderTime: "07:15" },
      });

      const settings = (await scoped.inject({ method: "GET", url: "/api/settings" })).json();
      expect(settings.reviewLimit).toBe(50);
      expect(settings.reminderTime).toBe("07:15");
    });

    it("rejects invalid values without writing anything", async () => {
      const response = await scoped.inject({
        method: "PUT",
        url: "/api/settings",
        payload: { reminderTime: "9点" },
      });
      expect(response.statusCode).toBe(400);
      expect(existsSync(path.join(directory, "settings.json"))).toBe(false);
    });

    // 报告和复习快照是 vault 的一部分，词库搬家时它们必须一起搬，
    // 否则数据被劈成两半：词库在新目录，报告还写在旧目录里
    it("moves the derived vault paths along with the vocabulary directory", async () => {
      const moved = path.join(directory, "moved-vault");
      await scoped.inject({ method: "PUT", url: "/api/settings", payload: { vocabDir: moved } });

      const settings = (await scoped.inject({ method: "GET", url: "/api/settings" })).json();
      expect(settings.vocabDir).toBe(moved);

      const health = (await scoped.inject({ method: "GET", url: "/api/health" })).json();
      expect(health.vocabDir).toBe(moved);
    });

    // StudyService 拿的是构造时传入的数字，改配置对它不可见——这条钉住那个坑
    it("applies a new daily limit to the very next session", async () => {
      scoped.enPetDatabase.importEntries(
        Array.from({ length: 6 }, (_, index) => ({
          id: `f001-r001-c0${index + 1}`,
          fileIndex: 1,
          rowIndex: 1,
          columnIndex: index + 1,
          sourcePath: "/vault/english-words.md",
          word: `word-${index + 1}`,
          meaning: `meaning-${index + 1}`,
          phonetic: "-",
          sourceOrder: 100_000 + index,
        })),
        1,
        [],
      );

      await scoped.inject({ method: "PUT", url: "/api/settings", payload: { newWordsPerDay: 2 } });

      const session = await scoped.inject({
        method: "POST",
        url: "/api/sessions/new/today",
        payload: { date: "2026-07-06" },
      });
      expect(session.json().session.items).toHaveLength(2);
    });
  });

  it("returns 400 with a readable message when the vocabulary directory is missing", async () => {
    const response = await app.inject({ method: "POST", url: "/api/import" });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.code).toBe("VOCAB_DIR_NOT_FOUND");
    expect(body.error).toContain("/tmp/does-not-matter");
  });

  it("creates an idempotent new learning session", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/sessions/new/today",
      payload: { date: "2026-07-06" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/sessions/new/today",
      payload: { date: "2026-07-06" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().session.id).toBe("new_learning:2026-07-06");
    expect(second.json().session.id).toBe(first.json().session.id);
  });

  it("does not create weekday tasks on weekends", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/sessions/new/today",
      payload: { date: "2026-07-11" },
    });
    expect(response.json().session).toBeNull();
  });

  it("limits new learning sessions to the configured newWordsPerDay", async () => {
    const limited = await buildApp({ ...baseConfig, newWordsPerDay: 3 }, new TestGenerator());
    limited.enPetDatabase.importEntries(
      Array.from({ length: 6 }, (_, index) => ({
        id: `f001-r001-c0${index + 1}`,
        fileIndex: 1,
        rowIndex: 1,
        columnIndex: index + 1,
        sourcePath: "/vault/english-words.md",
        word: `word-${index + 1}`,
        meaning: `meaning-${index + 1}`,
        phonetic: "-",
        sourceOrder: 100_000 + index,
      })),
      1,
      [],
    );
    const response = await limited.inject({
      method: "POST",
      url: "/api/sessions/new/today",
      payload: { date: "2026-07-06" },
    });
    expect(response.json().session.items).toHaveLength(3);
    await limited.close();
  });

  it("auto evaluates items and completes new learning after the last rating", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions/new/today",
      payload: { date: "2026-07-06" },
    });
    const session = created.json().session;

    let latest = session;
    for (const item of session.items) {
      const response = await app.inject({
        method: "POST",
        url: `/api/sessions/${encodeURIComponent(session.id)}/items/${encodeURIComponent(
          item.sourceEntry.id,
        )}`,
        payload: { answer: item.sourceEntry.meaning, rating: "good" },
      });
      latest = response.json().session;
    }

    expect(latest.status).toBe("completed");
    expect(
      latest.items.every((item: { feedback: string | null }) =>
        item.feedback?.includes("自动批改"),
      ),
    ).toBe(true);
    expect(app.enPetDatabase.getReviewQueue("2026-07-07").dueToday).toHaveLength(6);
  });
});
