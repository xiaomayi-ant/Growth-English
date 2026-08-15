import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultEditableSettings,
  loadConfig,
  migrateLegacyDataDir,
  readSettingsFile,
  settingsPathForDatabasePath,
  writeSettingsFile,
} from "./config.js";

const dataDir = path.join(os.homedir(), "Library", "Application Support", "EnPet");
const vaultDir = path.join(dataDir, "vault");

// 指向不存在的临时目录，避免读到本机真实的 settings.json
const isolatedEnv = { ENPET_DATABASE_PATH: "/tmp/enpet-config-test-missing/enpet.sqlite3" };

describe("loadConfig", () => {
  it("defaults to the per-user vault under Application Support", () => {
    const config = loadConfig(isolatedEnv);
    expect(config.vocabDir).toBe(vaultDir);
    expect(config.reportsDir).toBe(path.join(vaultDir, "study", "reports"));
    expect(config.reviewQueuePath).toBe(path.join(vaultDir, "study", "review-queue.md"));
    expect(loadConfig({}).databasePath).toBe(path.join(dataDir, "enpet.sqlite3"));
  });

  // 本地应用的「今天」就该是用户日历上的今天。硬编码某个时区，对不在那个时区的
  // 用户来说，学习记录和复习到期日会整体偏一天。
  it("follows the system timezone by default", () => {
    expect(loadConfig(isolatedEnv).timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("still lets ENPET_TIMEZONE override the system one", () => {
    expect(loadConfig({ ...isolatedEnv, ENPET_TIMEZONE: "Asia/Shanghai" }).timeZone).toBe(
      "Asia/Shanghai",
    );
  });

  it("defaults study parameters and reminder time", () => {
    const config = loadConfig(isolatedEnv);
    expect(config.newWordsPerDay).toBe(6);
    expect(config.reviewLimit).toBe(30);
    expect(config.reminderTime).toBe("09:00");
  });

  it("honors ENPET_* overrides", () => {
    const config = loadConfig({
      ENPET_VOCAB_DIR: "/custom/vocab",
      ENPET_DATABASE_PATH: "/custom/enpet.sqlite3",
      ENPET_REPORTS_DIR: "/custom/reports",
      ENPET_REVIEW_QUEUE_PATH: "/custom/review-queue.md",
      ENPET_NEW_WORDS_PER_DAY: "10",
      ENPET_REVIEW_LIMIT: "50",
      ENPET_REMINDER_TIME: "21:30",
    });
    expect(config.vocabDir).toBe("/custom/vocab");
    expect(config.databasePath).toBe("/custom/enpet.sqlite3");
    expect(config.reportsDir).toBe("/custom/reports");
    expect(config.reviewQueuePath).toBe("/custom/review-queue.md");
    expect(config.newWordsPerDay).toBe(10);
    expect(config.reviewLimit).toBe(50);
    expect(config.reminderTime).toBe("21:30");
  });

  it("rejects a malformed reminder time", () => {
    expect(() => loadConfig({ ENPET_REMINDER_TIME: "9点" })).toThrow();
  });

  // 改名前的变量名，旧 .env 不改也要能启动
  it("falls back to the legacy EN_PLAY_* variables", () => {
    const config = loadConfig({
      EN_PLAY_VOCAB_DIR: "/legacy/vocab",
      EN_PLAY_DATABASE_PATH: "/legacy/en-play.sqlite3",
      EN_PLAY_NEW_WORDS_PER_DAY: "8",
    });
    expect(config.vocabDir).toBe("/legacy/vocab");
    expect(config.databasePath).toBe("/legacy/en-play.sqlite3");
    expect(config.newWordsPerDay).toBe(8);
  });

  it("prefers ENPET_* over the legacy variable of the same field", () => {
    const config = loadConfig({
      ENPET_DATABASE_PATH: "/new/enpet.sqlite3",
      EN_PLAY_DATABASE_PATH: "/legacy/en-play.sqlite3",
    });
    expect(config.databasePath).toBe("/new/enpet.sqlite3");
  });

  // 引导流程只能靠「数据目录里什么都没有」来触发，所以测试要能把整个数据目录
  // 挪到临时位置。只覆盖 databasePath 不够：词库和报告会留在真实目录里被写脏。
  it("derives every path from ENPET_DATA_DIR when it is set", () => {
    const config = loadConfig({ ENPET_DATA_DIR: "/tmp/enpet-isolated" });
    expect(config.databasePath).toBe("/tmp/enpet-isolated/enpet.sqlite3");
    expect(config.vocabDir).toBe("/tmp/enpet-isolated/vault");
    expect(config.reportsDir).toBe("/tmp/enpet-isolated/vault/study/reports");
    expect(config.reviewQueuePath).toBe("/tmp/enpet-isolated/vault/study/review-queue.md");
  });

  it("resolves a relative ENPET_DATA_DIR to an absolute path", () => {
    const config = loadConfig({ ENPET_DATA_DIR: "./enpet-relative" });
    expect(config.databasePath).toBe(path.resolve("./enpet-relative/enpet.sqlite3"));
  });

  // 更具体的覆盖仍然赢，否则既有的 ENPET_VOCAB_DIR 用法会被这个新变量夺走
  it("lets the more specific overrides win over ENPET_DATA_DIR", () => {
    const config = loadConfig({
      ENPET_DATA_DIR: "/tmp/enpet-isolated",
      ENPET_VOCAB_DIR: "/custom/vocab",
      ENPET_DATABASE_PATH: "/custom/enpet.sqlite3",
    });
    expect(config.vocabDir).toBe("/custom/vocab");
    expect(config.databasePath).toBe("/custom/enpet.sqlite3");
    // 未被单独指定的路径继续跟随 ENPET_DATA_DIR
    expect(config.reportsDir).toBe("/tmp/enpet-isolated/vault/study/reports");
  });
});

describe("migrateLegacyDataDir", () => {
  let home: string;
  let originalHome: string | undefined;
  let legacyDir: string;
  let dataDir: string;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    home = await mkdtemp(path.join(os.tmpdir(), "enpet-home-"));
    process.env.HOME = home;
    legacyDir = path.join(home, "Library", "Application Support", "En Play");
    dataDir = path.join(home, "Library", "Application Support", "EnPet");
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(home, { recursive: true, force: true });
  });

  it("does nothing when there is no legacy directory", async () => {
    await migrateLegacyDataDir();
    expect(existsSync(dataDir)).toBe(false);
  });

  it("copies the database, settings and vault, keeping the legacy copy", async () => {
    await mkdir(path.join(legacyDir, "vault", "study"), { recursive: true });
    await writeFile(path.join(legacyDir, "en-play.sqlite3"), "db", "utf8");
    await writeFile(path.join(legacyDir, "en-play.sqlite3-wal"), "wal", "utf8");
    await writeFile(path.join(legacyDir, "settings.json"), '{"newWordsPerDay":9}', "utf8");
    await writeFile(path.join(legacyDir, "vault", "english-words.md"), "table", "utf8");

    await migrateLegacyDataDir();

    expect(await readFile(path.join(dataDir, "enpet.sqlite3"), "utf8")).toBe("db");
    expect(await readFile(path.join(dataDir, "enpet.sqlite3-wal"), "utf8")).toBe("wal");
    expect(await readFile(path.join(dataDir, "settings.json"), "utf8")).toBe(
      '{"newWordsPerDay":9}',
    );
    expect(await readFile(path.join(dataDir, "vault", "english-words.md"), "utf8")).toBe("table");
    expect(existsSync(path.join(legacyDir, "en-play.sqlite3"))).toBe(true);
  });

  it("runs only once and never overwrites newer data", async () => {
    await mkdir(legacyDir, { recursive: true });
    await writeFile(path.join(legacyDir, "en-play.sqlite3"), "old", "utf8");

    await migrateLegacyDataDir();
    await writeFile(path.join(dataDir, "enpet.sqlite3"), "new", "utf8");
    await migrateLegacyDataDir();

    expect(await readFile(path.join(dataDir, "enpet.sqlite3"), "utf8")).toBe("new");
  });

  // 迁移是给真实用户升级用的一次性动作。隔离出来的数据目录如果也被填上旧数据，
  // 它就成了「老用户」，引导又不会出现，测试隔离等于白做。
  it("skips migration entirely when the data dir is overridden", async () => {
    const isolated = path.join(home, "isolated");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(path.join(legacyDir, "en-play.sqlite3"), "old", "utf8");

    await migrateLegacyDataDir({ ENPET_DATA_DIR: isolated });

    expect(existsSync(path.join(isolated, "enpet.sqlite3"))).toBe(false);
    expect(existsSync(dataDir)).toBe(false);
  });
});

describe("settings file", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "enpet-config-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("applies settings file values above defaults", () => {
    const databasePath = path.join(tempDir, "enpet.sqlite3");
    expect(defaultEditableSettings().newWordsPerDay).toBe(6);
    const config = loadConfig({ ENPET_DATABASE_PATH: databasePath });
    expect(config.newWordsPerDay).toBe(6);
  });

  it("loads editable fields from the settings file next to the database", async () => {
    const databasePath = path.join(tempDir, "enpet.sqlite3");
    await writeSettingsFile(settingsPathForDatabasePath(databasePath), {
      vocabDir: "/saved/vocab",
      newWordsPerDay: 9,
      reviewLimit: 45,
      reminderTime: "21:30",
    });
    const config = loadConfig({ ENPET_DATABASE_PATH: databasePath });
    expect(config.vocabDir).toBe("/saved/vocab");
    expect(config.newWordsPerDay).toBe(9);
    expect(config.reviewLimit).toBe(45);
    expect(config.reminderTime).toBe("21:30");
  });

  it("lets environment variables override the settings file", async () => {
    const databasePath = path.join(tempDir, "enpet.sqlite3");
    await writeSettingsFile(settingsPathForDatabasePath(databasePath), {
      newWordsPerDay: 9,
      reminderTime: "21:30",
    });
    const config = loadConfig({
      ENPET_DATABASE_PATH: databasePath,
      ENPET_NEW_WORDS_PER_DAY: "12",
    });
    expect(config.newWordsPerDay).toBe(12);
    expect(config.reminderTime).toBe("21:30");
  });

  it("ignores a corrupt settings file", async () => {
    const databasePath = path.join(tempDir, "enpet.sqlite3");
    await writeFile(settingsPathForDatabasePath(databasePath), "not json{", "utf8");
    expect(readSettingsFile(settingsPathForDatabasePath(databasePath))).toEqual({});
    expect(loadConfig({ ENPET_DATABASE_PATH: databasePath }).newWordsPerDay).toBe(6);
  });

  it("ignores invalid fields in the settings file", async () => {
    const databasePath = path.join(tempDir, "enpet.sqlite3");
    await writeFile(
      settingsPathForDatabasePath(databasePath),
      JSON.stringify({ newWordsPerDay: 999 }),
      "utf8",
    );
    expect(loadConfig({ ENPET_DATABASE_PATH: databasePath }).newWordsPerDay).toBe(6);
  });

  it("preserves unknown keys when writing the settings file", async () => {
    const settingsPath = settingsPathForDatabasePath(path.join(tempDir, "enpet.sqlite3"));
    await writeFile(settingsPath, JSON.stringify({ reportsDir: "/custom/reports" }), "utf8");
    await writeSettingsFile(settingsPath, { newWordsPerDay: 9 });
    const raw = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    expect(raw.reportsDir).toBe("/custom/reports");
    expect(raw.newWordsPerDay).toBe(9);
  });
});
