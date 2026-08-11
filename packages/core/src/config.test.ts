import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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
