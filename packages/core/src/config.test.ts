import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultEditableSettings,
  loadConfig,
  readSettingsFile,
  settingsPathForDatabasePath,
  writeSettingsFile,
} from "./config.js";

const dataDir = path.join(os.homedir(), "Library", "Application Support", "En Play");
const vaultDir = path.join(dataDir, "vault");

// 指向不存在的临时目录，避免读到本机真实的 settings.json
const isolatedEnv = { EN_PLAY_DATABASE_PATH: "/tmp/en-play-config-test-missing/en-play.sqlite3" };

describe("loadConfig", () => {
  it("defaults to the per-user vault under Application Support", () => {
    const config = loadConfig(isolatedEnv);
    expect(config.vocabDir).toBe(vaultDir);
    expect(config.reportsDir).toBe(path.join(vaultDir, "study", "reports"));
    expect(config.reviewQueuePath).toBe(path.join(vaultDir, "study", "review-queue.md"));
    expect(loadConfig({}).databasePath).toBe(path.join(dataDir, "en-play.sqlite3"));
  });

  it("defaults study parameters and reminder time", () => {
    const config = loadConfig(isolatedEnv);
    expect(config.newWordsPerDay).toBe(6);
    expect(config.reviewLimit).toBe(30);
    expect(config.reminderTime).toBe("09:00");
  });

  it("honors EN_PLAY_* overrides", () => {
    const config = loadConfig({
      EN_PLAY_VOCAB_DIR: "/custom/vocab",
      EN_PLAY_DATABASE_PATH: "/custom/en-play.sqlite3",
      EN_PLAY_REPORTS_DIR: "/custom/reports",
      EN_PLAY_REVIEW_QUEUE_PATH: "/custom/review-queue.md",
      EN_PLAY_NEW_WORDS_PER_DAY: "10",
      EN_PLAY_REVIEW_LIMIT: "50",
      EN_PLAY_REMINDER_TIME: "21:30",
    });
    expect(config.vocabDir).toBe("/custom/vocab");
    expect(config.databasePath).toBe("/custom/en-play.sqlite3");
    expect(config.reportsDir).toBe("/custom/reports");
    expect(config.reviewQueuePath).toBe("/custom/review-queue.md");
    expect(config.newWordsPerDay).toBe(10);
    expect(config.reviewLimit).toBe(50);
    expect(config.reminderTime).toBe("21:30");
  });

  it("rejects a malformed reminder time", () => {
    expect(() => loadConfig({ EN_PLAY_REMINDER_TIME: "9点" })).toThrow();
  });
});

describe("settings file", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "en-play-config-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("applies settings file values above defaults", () => {
    const databasePath = path.join(tempDir, "en-play.sqlite3");
    expect(defaultEditableSettings().newWordsPerDay).toBe(6);
    const config = loadConfig({ EN_PLAY_DATABASE_PATH: databasePath });
    expect(config.newWordsPerDay).toBe(6);
  });

  it("loads editable fields from the settings file next to the database", async () => {
    const databasePath = path.join(tempDir, "en-play.sqlite3");
    await writeSettingsFile(settingsPathForDatabasePath(databasePath), {
      vocabDir: "/saved/vocab",
      newWordsPerDay: 9,
      reviewLimit: 45,
      reminderTime: "21:30",
    });
    const config = loadConfig({ EN_PLAY_DATABASE_PATH: databasePath });
    expect(config.vocabDir).toBe("/saved/vocab");
    expect(config.newWordsPerDay).toBe(9);
    expect(config.reviewLimit).toBe(45);
    expect(config.reminderTime).toBe("21:30");
  });

  it("lets environment variables override the settings file", async () => {
    const databasePath = path.join(tempDir, "en-play.sqlite3");
    await writeSettingsFile(settingsPathForDatabasePath(databasePath), {
      newWordsPerDay: 9,
      reminderTime: "21:30",
    });
    const config = loadConfig({
      EN_PLAY_DATABASE_PATH: databasePath,
      EN_PLAY_NEW_WORDS_PER_DAY: "12",
    });
    expect(config.newWordsPerDay).toBe(12);
    expect(config.reminderTime).toBe("21:30");
  });

  it("ignores a corrupt settings file", async () => {
    const databasePath = path.join(tempDir, "en-play.sqlite3");
    await writeFile(settingsPathForDatabasePath(databasePath), "not json{", "utf8");
    expect(readSettingsFile(settingsPathForDatabasePath(databasePath))).toEqual({});
    expect(loadConfig({ EN_PLAY_DATABASE_PATH: databasePath }).newWordsPerDay).toBe(6);
  });

  it("ignores invalid fields in the settings file", async () => {
    const databasePath = path.join(tempDir, "en-play.sqlite3");
    await writeFile(
      settingsPathForDatabasePath(databasePath),
      JSON.stringify({ newWordsPerDay: 999 }),
      "utf8",
    );
    expect(loadConfig({ EN_PLAY_DATABASE_PATH: databasePath }).newWordsPerDay).toBe(6);
  });

  it("preserves unknown keys when writing the settings file", async () => {
    const settingsPath = settingsPathForDatabasePath(path.join(tempDir, "en-play.sqlite3"));
    await writeFile(settingsPath, JSON.stringify({ reportsDir: "/custom/reports" }), "utf8");
    await writeSettingsFile(settingsPath, { newWordsPerDay: 9 });
    const raw = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    expect(raw.reportsDir).toBe("/custom/reports");
    expect(raw.newWordsPerDay).toBe(9);
  });
});
