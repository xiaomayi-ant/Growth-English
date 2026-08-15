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

const vocabFieldSchema = z.enum(["word", "meaning", "phonetic"]);

// 词库格式描述符：用户在导入预览里调的就是它，解析器按它工作，不需要改代码
export const vocabFormatSchema = z.object({
  layout: z.enum(["cell", "column"]),
  separator: z.string().min(1),
  fieldOrder: z.array(vocabFieldSchema).min(1),
  columns: z.object({
    word: z.number().int().min(0),
    meaning: z.number().int().min(0),
    phonetic: z.number().int().min(0),
  }),
});

export type VocabFormat = z.infer<typeof vocabFormatSchema>;

// exactOptionalPropertyTypes 下 Partial<T> 不接受显式 undefined，接口入参要用这个
export type VocabFormatInput = { [K in keyof VocabFormat]?: VocabFormat[K] | undefined };

export const DEFAULT_VOCAB_FORMAT: VocabFormat = {
  layout: "cell",
  separator: "<br>",
  fieldOrder: ["word", "meaning", "phonetic"],
  columns: { word: 1, meaning: 2, phonetic: 3 },
};

const configSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  timeZone: z.string().min(1),
  vocabDir: z.string().min(1),
  // 词库文件名前缀；序号后缀（-002）仍决定学习顺序，前缀可自定义
  vocabFilePrefix: z
    .string()
    .min(1)
    .regex(/^[^/\\]+$/, "词库文件名前缀不能包含路径分隔符"),
  // 没有值时由导入器自动探测；用户在预览里确认后才落盘固定下来
  vocabFormat: vocabFormatSchema.optional(),
  databasePath: z.string().min(1),
  reportsDir: z.string().min(1),
  reviewQueuePath: z.string().min(1),
  newWordsPerDay: z.number().int().min(1).max(20),
  reviewLimit: z.number().int().min(1).max(200),
  reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export type AppConfig = z.infer<typeof configSchema>;

export const DEFAULT_VOCAB_FILE_PREFIX = "english-words";

// 设置页可编辑的字段；reportsDir / reviewQueuePath / databasePath 不暴露编辑
export const editableSettingsSchema = z.object({
  vocabDir: configSchema.shape.vocabDir,
  vocabFilePrefix: configSchema.shape.vocabFilePrefix,
  vocabFormat: configSchema.shape.vocabFormat,
  newWordsPerDay: configSchema.shape.newWordsPerDay,
  reviewLimit: configSchema.shape.reviewLimit,
  reminderTime: configSchema.shape.reminderTime,
});

export type EditableSettings = z.infer<typeof editableSettingsSchema>;

function applicationSupportDir(): string {
  return path.join(os.homedir(), "Library", "Application Support");
}

// 数据目录是所有其它路径的源头，整体可被 ENPET_DATA_DIR 覆盖。测试引导流程需要
// 一个「什么都没有」的数据目录，而单独覆盖 databasePath 不够——词库和报告会留在
// 真实目录里被写脏。
function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = readEnv(env, "DATA_DIR");
  return override ? path.resolve(override) : path.join(applicationSupportDir(), APP_DIR_NAME);
}

function legacyDataDir(): string {
  return path.join(applicationSupportDir(), LEGACY_APP_DIR_NAME);
}

// 改名前的数据目录一次性复制到 EnPet 目录，旧目录原样保留，便于回退到旧版本。
// 必须在 loadConfig 之前调用；标记文件保证只搬一次。
export async function migrateLegacyDataDir(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  // 迁移是真实用户升级时的一次性动作。数据目录被显式覆盖时那是个隔离环境，
  // 把旧数据搬进去会让它看起来像老用户，引导就不出现了。
  if (readEnv(env, "DATA_DIR")) return;

  const dataDir = defaultDataDir(env);
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

/**
 * 数据目录指针。settings.json 本身住在数据目录里，所以数据目录的位置不能存在那儿，
 * 只能放一个独立的小文件（桌面版放在 Electron userData 下）。
 */
export const DATA_DIR_POINTER_FILE = "location.json";

export function readDataDirPointer(pointerDir: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(path.join(pointerDir, DATA_DIR_POINTER_FILE), "utf8")) as {
      dataDir?: unknown;
    };
    return typeof raw.dataDir === "string" && raw.dataDir.trim() ? raw.dataDir : null;
  } catch {
    return null;
  }
}

export async function writeDataDirPointer(pointerDir: string, dataDir: string): Promise<void> {
  await mkdir(pointerDir, { recursive: true });
  await writeFile(
    path.join(pointerDir, DATA_DIR_POINTER_FILE),
    `${JSON.stringify({ dataDir }, null, 2)}\n`,
    "utf8",
  );
}

export function databasePathForDataDir(dataDir: string): string {
  return path.join(dataDir, DATABASE_FILE);
}

export function recommendedDataDir(): string {
  return defaultDataDir();
}

export function defaultEditableSettings(): EditableSettings {
  return {
    vocabDir: path.join(defaultDataDir(), "vault"),
    vocabFilePrefix: DEFAULT_VOCAB_FILE_PREFIX,
    vocabFormat: DEFAULT_VOCAB_FORMAT,
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
  const dataDir = defaultDataDir(env);
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
    vocabFilePrefix:
      readEnv(env, "VOCAB_FILE_PREFIX") ??
      filteredSaved.vocabFilePrefix ??
      DEFAULT_VOCAB_FILE_PREFIX,
    vocabFormat: filteredSaved.vocabFormat,
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

  // 词库目录始终保持为 Obsidian vault，无论它是引导创建的还是用户后来改的
  const obsidianDir = path.join(config.vocabDir, ".obsidian");
  if (!existsSync(obsidianDir)) {
    await mkdir(obsidianDir, { recursive: true });
    await writeFile(
      path.join(obsidianDir, "app.json"),
      `${JSON.stringify({ attachmentFolderPath: "attachments" }, null, 2)}\n`,
      "utf8",
    );
  }
}
