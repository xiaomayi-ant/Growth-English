import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AppConfig,
  DEFAULT_VOCAB_FORMAT,
  type ScenarioContent,
  type SourceEntry,
  todayInTimeZone,
} from "@enpet/core";
import { type ContentGenerator, DeterministicAnswerEvaluator } from "@enpet/evaluation";
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

/**
 * 测试必须自带评测器。不传的话 buildApp 会去探测本机的 codex CLI，装了 codex 的
 * 机器上每次评分都真的调用它，一轮 6 个词远超默认超时——而 CI 上没装 codex，
 * 走的是确定性实现，于是这条测试「本地红、CI 绿」，谁也不会去修。
 * 测试用哪个实现应该由测试自己决定，不能交给机器环境。
 */
function buildTestApp(
  config: AppConfig,
  generator: ContentGenerator = new TestGenerator(),
): Promise<EnPetApp> {
  return buildApp(config, generator, new DeterministicAnswerEvaluator());
}

describe("API", () => {
  let app: EnPetApp;

  beforeEach(async () => {
    app = await buildTestApp({ ...baseConfig }, new TestGenerator());
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
    const empty = await buildTestApp({ ...baseConfig, vocabDir: directory }, new TestGenerator());
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

  // 用户设置里存的格式可能是旧的 cell 堆叠格式，示例词库却是一词一行的表格，
  // 拿存量格式去解析会把 6 个词拆成 21 条垃圾——所以这条路径必须自己探测格式
  it("imports the sample vocabulary regardless of the stored format", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "enpet-sample-"));
    const vocabDir = path.join(directory, "vault");
    const scoped = await buildTestApp({
      ...baseConfig,
      vocabDir,
      databasePath: path.join(directory, "enpet.sqlite3"),
    });
    try {
      const response = await scoped.inject({ method: "POST", url: "/api/vault/sample" });
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
    const scoped = await buildTestApp({
      ...baseConfig,
      vocabDir,
      databasePath: path.join(directory, "enpet.sqlite3"),
    });
    try {
      await scoped.inject({ method: "POST", url: "/api/vault/sample" });
      expect(existsSync(path.join(vocabDir, ".obsidian", "app.json"))).toBe(true);

      const health = (await scoped.inject({ method: "GET", url: "/api/health" })).json();
      expect(health.obsidianLink).toBe(`obsidian://open?path=${encodeURIComponent(vocabDir)}`);
    } finally {
      await scoped.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  // 创建学习任务返回 200 + session:null 时，前端只 catch 异常不看响应体，就会
  // 把「什么都没发生」当成功。要让每种拒绝都带上可分辨的原因，界面才能说清楚。
  describe("refusing to create a session", () => {
    // 周末照常开工：想学的时候就该能学，日历上是星期几不该拦人
    it("creates sessions on weekends like any other day", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/sessions/new/today",
        payload: { date: "2026-07-11" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().session).not.toBeNull();
      expect(response.json().reason).toBeNull();
    });

    it("reports an empty vocabulary as its own reason", async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "enpet-no-vocab-"));
      const scoped = await buildTestApp(
        { ...baseConfig, databasePath: path.join(directory, "enpet.sqlite3") },
        new TestGenerator(),
      );
      try {
        const response = await scoped.inject({
          method: "POST",
          url: "/api/sessions/new/today",
          payload: { date: "2026-07-06" },
        });
        expect(response.json()).toMatchObject({ session: null, reason: "no-vocabulary" });
      } finally {
        await scoped.close();
        await rm(directory, { recursive: true, force: true });
      }
    });

    // 词条要评过分才算学过（创建会话只写 session_items，learning_items 是评分时建的），
    // 所以这里必须真的把一整轮走完
    it("reports a finished vocabulary as its own reason", async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "enpet-all-learned-"));
      const scoped = await buildTestApp({
        ...baseConfig,
        databasePath: path.join(directory, "enpet.sqlite3"),
      });
      try {
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

        const created = await scoped.inject({
          method: "POST",
          url: "/api/sessions/new/today",
          payload: { date: "2026-07-06" },
        });
        const session = created.json().session;
        for (const item of session.items) {
          await scoped.inject({
            method: "POST",
            url: `/api/sessions/${session.id}/items/${item.sourceEntry.id}`,
            payload: { answer: item.sourceEntry.meaning, rating: "good" },
          });
        }

        const response = await scoped.inject({
          method: "POST",
          url: "/api/sessions/new/today",
          payload: { date: "2026-07-07" },
        });
        expect(response.json()).toMatchObject({ session: null, reason: "all-learned" });
      } finally {
        await scoped.close();
        await rm(directory, { recursive: true, force: true });
      }
    });

    it("carries no reason when the session is actually created", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/sessions/new/today",
        payload: { date: "2026-07-06" },
      });
      expect(response.json().session).not.toBeNull();
      expect(response.json().reason).toBeNull();
    });

    it("creates review sessions on weekends too", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/sessions/review/today",
        payload: { date: "2026-07-11" },
      });
      expect(response.json().session).not.toBeNull();
      expect(response.json().reason).toBeNull();
    });
  });

  // 双击启动的应用没有终端，stdout 直接被系统丢掉。出错时用户手上什么都没有，
  // 只能靠猜——这组测试保证日志同时落到数据目录里，事后还能查。
  describe("log files", () => {
    let directory: string;
    let scoped: EnPetApp;

    beforeEach(async () => {
      directory = await mkdtemp(path.join(tmpdir(), "enpet-logs-"));
    });

    afterEach(async () => {
      await scoped?.close();
      await rm(directory, { recursive: true, force: true });
    });

    it("records the reason behind a 500 in the data directory", async () => {
      scoped = await buildTestApp({
        ...baseConfig,
        databasePath: path.join(directory, "enpet.sqlite3"),
      });

      // 词库目录不存在时导入会失败，正好produces一条错误日志
      await scoped.inject({ method: "POST", url: "/api/import" });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const logDir = path.join(directory, "logs");
      const files = await readdir(logDir);
      expect(files).toHaveLength(1);

      const contents = await readFile(path.join(logDir, files[0] as string), "utf8");
      expect(contents).toContain("VOCAB_DIR_NOT_FOUND");
    });

    it("drops logs older than a week so they cannot pile up forever", async () => {
      const logDir = path.join(directory, "logs");
      await mkdir(logDir, { recursive: true });
      const stale = path.join(logDir, "enpet-2020-01-01.log");
      const recent = path.join(logDir, `enpet-${todayInTimeZone("Asia/Shanghai")}.log`);
      await writeFile(stale, "old\n");
      await writeFile(recent, "new\n");

      scoped = await buildTestApp({
        ...baseConfig,
        databasePath: path.join(directory, "enpet.sqlite3"),
      });

      const files = await readdir(logDir);
      expect(files).not.toContain("enpet-2020-01-01.log");
      expect(files).toContain(path.basename(recent));
    });

    // 测试和临时场景用的是内存数据库，不该在项目目录里散落日志
    it("writes no log files for an in-memory database", async () => {
      scoped = await buildTestApp({ ...baseConfig });
      await scoped.inject({ method: "GET", url: "/api/health" });
      expect(existsSync(path.join(process.cwd(), "logs"))).toBe(false);
    });
  });

  // 空词库时主界面给的是「用示例词先试试」一个按钮，它背后就是这个接口：
  // 建词库文件再导入，一步到位，用户不需要先懂什么是 vault。
  describe("sample vault", () => {
    let directory: string;
    let scoped: EnPetApp;

    beforeEach(async () => {
      directory = await mkdtemp(path.join(tmpdir(), "enpet-sample-vault-"));
      scoped = await buildTestApp(
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
      scoped = await buildTestApp(
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

    // 字段问的是「词库目录」，但人的第一反应往往是给出词库文件的位置。
    // 这时候要直接告诉他该填哪个目录，而不是丢一句 mkdir EEXIST。
    it("points at the parent directory when given a vocabulary file", async () => {
      const file = path.join(directory, "english-words.md");
      await writeFile(file, "# 词库\n");

      const response = await scoped.inject({
        method: "PUT",
        url: "/api/settings",
        payload: { vocabDir: file },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain(directory);
      expect(response.json().error).not.toContain("EEXIST");
    });

    // 用户在设置里填了一个建不出来的目录时，得到的应该是一句能看懂的话，
    // 而不是 Internal server error
    it("explains why a vocabulary directory cannot be used", async () => {
      // 父路径是个文件，任何平台上 mkdir 都会失败
      const blocker = path.join(directory, "not-a-directory");
      await writeFile(blocker, "");
      const unusable = path.join(blocker, "vault");

      const response = await scoped.inject({
        method: "PUT",
        url: "/api/settings",
        payload: { vocabDir: unusable },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain(unusable);
    });

    // 落盘在验证之前的话，一次失败的保存就会把用不了的路径留在 settings.json 里，
    // 下次启动应用带着它走——错误从一次点击升级成持续故障
    it("leaves the saved settings untouched when the directory is unusable", async () => {
      await scoped.inject({
        method: "PUT",
        url: "/api/settings",
        payload: { vocabDir: path.join(directory, "good-vault") },
      });

      const blocker = path.join(directory, "blocker");
      await writeFile(blocker, "");
      await scoped.inject({
        method: "PUT",
        url: "/api/settings",
        payload: { vocabDir: path.join(blocker, "vault") },
      });

      const onDisk = JSON.parse(await readFile(path.join(directory, "settings.json"), "utf8"));
      expect(onDisk.vocabDir).toBe(path.join(directory, "good-vault"));

      const current = (await scoped.inject({ method: "GET", url: "/api/settings" })).json();
      expect(current.vocabDir).toBe(path.join(directory, "good-vault"));
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

  it("limits new learning sessions to the configured newWordsPerDay", async () => {
    const limited = await buildTestApp({ ...baseConfig, newWordsPerDay: 3 }, new TestGenerator());
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
