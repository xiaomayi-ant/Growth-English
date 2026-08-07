import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const configSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  timeZone: z.string().min(1),
  vocabDir: z.string().min(1),
  databasePath: z.string().min(1),
  reportsDir: z.string().min(1),
  reviewQueuePath: z.string().min(1),
  newWordsPerDay: z.number().int().min(1).max(20),
  reviewLimit: z.number().int().min(1).max(200),
  reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export type AppConfig = z.infer<typeof configSchema>;

// 设置页可编辑的字段；reportsDir / reviewQueuePath / databasePath 不暴露编辑
export const editableSettingsSchema = z.object({
  vocabDir: configSchema.shape.vocabDir,
  newWordsPerDay: configSchema.shape.newWordsPerDay,
  reviewLimit: configSchema.shape.reviewLimit,
  reminderTime: configSchema.shape.reminderTime,
});

export type EditableSettings = z.infer<typeof editableSettingsSchema>;

function defaultDataDir(): string {
  return path.join(os.homedir(), "Library", "Application Support", "En Play");
}

export function defaultEditableSettings(): EditableSettings {
  return {
    vocabDir: path.join(defaultDataDir(), "vault"),
    newWordsPerDay: 6,
    reviewLimit: 30,
    reminderTime: "09:00",
  };
}

export function settingsPathForDatabasePath(databasePath: string): string {
  return path.join(path.dirname(databasePath), "settings.json");
}

// 读取设置文件中的可编辑字段；文件缺失、损坏或字段非法时忽略对应内容
export function readSettingsFile(settingsPath: string): Partial<EditableSettings> {
  try {
    const parsed = editableSettingsSchema
      .partial()
      .safeParse(JSON.parse(readFileSync(settingsPath, "utf8")));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

// 合并写入设置文件，保留文件中未识别的字段（桌面版共用同一文件存放其他覆盖项）
export async function writeSettingsFile(
  settingsPath: string,
  settings: Partial<EditableSettings>,
): Promise<void> {
  let existing: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(settingsPath, "utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    // 文件缺失或损坏时直接覆盖
  }
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(
    settingsPath,
    `${JSON.stringify({ ...existing, ...settings }, null, 2)}\n`,
    "utf8",
  );
}

// 加载优先级：默认值 < 设置文件（databasePath 同目录的 settings.json）< 环境变量
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = defaultDataDir();
  const vaultDir = path.join(dataDir, "vault");
  const databasePath = env.EN_PLAY_DATABASE_PATH ?? path.join(dataDir, "en-play.sqlite3");
  const saved = readSettingsFile(settingsPathForDatabasePath(databasePath));
  return configSchema.parse({
    host: env.EN_PLAY_HOST ?? "127.0.0.1",
    port: Number(env.EN_PLAY_PORT ?? 4173),
    timeZone: env.EN_PLAY_TIMEZONE ?? "Asia/Shanghai",
    vocabDir: env.EN_PLAY_VOCAB_DIR ?? saved.vocabDir ?? vaultDir,
    databasePath,
    reportsDir: env.EN_PLAY_REPORTS_DIR ?? path.join(vaultDir, "study", "reports"),
    reviewQueuePath:
      env.EN_PLAY_REVIEW_QUEUE_PATH ?? path.join(vaultDir, "study", "review-queue.md"),
    newWordsPerDay: Number(env.EN_PLAY_NEW_WORDS_PER_DAY ?? saved.newWordsPerDay ?? 6),
    reviewLimit: Number(env.EN_PLAY_REVIEW_LIMIT ?? saved.reviewLimit ?? 30),
    reminderTime: env.EN_PLAY_REMINDER_TIME ?? saved.reminderTime ?? "09:00",
  });
}

export async function ensureVaultDirectories(config: AppConfig): Promise<void> {
  await mkdir(config.vocabDir, { recursive: true });
  await mkdir(config.reportsDir, { recursive: true });
  await mkdir(path.dirname(config.reviewQueuePath), { recursive: true });
}
