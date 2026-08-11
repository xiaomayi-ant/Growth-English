import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

// 项目原名 En Play，改名为 EnPet 后仍需接管旧数据目录与旧环境变量
const APP_DIR_NAME = "EnPet";
const LEGACY_APP_DIR_NAME = "En Play";
const DATABASE_FILE = "enpet.sqlite3";
const LEGACY_DATABASE_FILE = "en-play.sqlite3";
const MIGRATION_MARKER = ".migrated-from-en-play";

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

function applicationSupportDir(): string {
  return path.join(os.homedir(), "Library", "Application Support");
}

function defaultDataDir(): string {
  return path.join(applicationSupportDir(), APP_DIR_NAME);
}

function legacyDataDir(): string {
  return path.join(applicationSupportDir(), LEGACY_APP_DIR_NAME);
}

// 改名前的数据目录一次性复制到 EnPet 目录，旧目录原样保留，便于回退到旧版本。
// 必须在 loadConfig 之前调用；标记文件保证只搬一次。
export async function migrateLegacyDataDir(): Promise<void> {
  const dataDir = defaultDataDir();
  const legacyDir = legacyDataDir();
  if (!existsSync(legacyDir) || existsSync(path.join(dataDir, MIGRATION_MARKER))) return;

  await mkdir(dataDir, { recursive: true });

  // WAL 模式下数据主要在 -wal 文件中，三个文件必须一起复制才完整
  for (const suffix of ["", "-wal", "-shm"]) {
    const source = path.join(legacyDir, `${LEGACY_DATABASE_FILE}${suffix}`);
    const target = path.join(dataDir, `${DATABASE_FILE}${suffix}`);
    if (existsSync(source) && !existsSync(target)) {
      await cp(source, target);
    }
  }

  for (const entry of ["settings.json", "vault"]) {
    const source = path.join(legacyDir, entry);
    const target = path.join(dataDir, entry);
    if (existsSync(source) && !existsSync(target)) {
      await cp(source, target, { recursive: true });
    }
  }

  await writeFile(path.join(dataDir, MIGRATION_MARKER), `${new Date().toISOString()}\n`, "utf8");
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
    if (!parsed.success) return {};

    // 过滤掉 undefined 值
    const result: Partial<EditableSettings> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) {
        (result as Record<string, unknown>)[key] = value;
      }
    }
    return result;
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

// 改名前的 EN_PLAY_* 变量作为回退保留，旧 .env 不改也能启动
function readEnv(env: NodeJS.ProcessEnv, suffix: string): string | undefined {
  return env[`ENPET_${suffix}`] ?? env[`EN_PLAY_${suffix}`];
}

// 加载优先级：默认值 < 设置文件（databasePath 同目录的 settings.json）< 环境变量
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = defaultDataDir();
  const vaultDir = path.join(dataDir, "vault");
  const databasePath = readEnv(env, "DATABASE_PATH") ?? path.join(dataDir, DATABASE_FILE);
  const saved = readSettingsFile(settingsPathForDatabasePath(databasePath));

  // 过滤掉 undefined 值，避免类型错误
  const filteredSaved: Partial<EditableSettings> = {};
  for (const [key, value] of Object.entries(saved)) {
    if (value !== undefined) {
      (filteredSaved as Record<string, unknown>)[key] = value;
    }
  }

  return configSchema.parse({
    host: readEnv(env, "HOST") ?? "127.0.0.1",
    port: Number(readEnv(env, "PORT") ?? 4173),
    timeZone: readEnv(env, "TIMEZONE") ?? "Asia/Shanghai",
    vocabDir: readEnv(env, "VOCAB_DIR") ?? filteredSaved.vocabDir ?? vaultDir,
    databasePath,
    reportsDir: readEnv(env, "REPORTS_DIR") ?? path.join(vaultDir, "study", "reports"),
    reviewQueuePath:
      readEnv(env, "REVIEW_QUEUE_PATH") ?? path.join(vaultDir, "study", "review-queue.md"),
    newWordsPerDay: Number(readEnv(env, "NEW_WORDS_PER_DAY") ?? filteredSaved.newWordsPerDay ?? 6),
    reviewLimit: Number(readEnv(env, "REVIEW_LIMIT") ?? filteredSaved.reviewLimit ?? 30),
    reminderTime: readEnv(env, "REMINDER_TIME") ?? filteredSaved.reminderTime ?? "09:00",
  });
}

export async function ensureVaultDirectories(config: AppConfig): Promise<void> {
  await mkdir(config.vocabDir, { recursive: true });
  await mkdir(config.reportsDir, { recursive: true });
  await mkdir(path.dirname(config.reviewQueuePath), { recursive: true });
}
