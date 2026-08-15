import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AppConfig,
  createDefaultVaultStructure,
  detectOnboardingState,
  type EditableSettings,
  editableSettingsSchema,
  ensureVaultDirectories,
  markOnboardingComplete,
  obsidianVaultLink,
  settingsPathForDatabasePath,
  TaskScheduler,
  todayInTimeZone,
  vocabFormatSchema,
  writeSettingsFile,
} from "@enpet/core";
import { EnPetDatabase } from "@enpet/database";
import {
  type AnswerEvaluator,
  CodexAnswerEvaluator,
  CodexContentGenerator,
  type ContentGenerator,
  DeterministicAnswerEvaluator,
  DeterministicContentGenerator,
} from "@enpet/evaluation";
import { writeDailyReport, writeReviewQueue } from "@enpet/reporting";
import { StudyService } from "@enpet/scheduler";
import { loadVocabulary, normalizeFormat, VocabImportError } from "@enpet/vocabulary-import";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

const dateBodySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
const itemBodySchema = z.object({
  answer: z.string().max(10_000).default(""),
  rating: z.enum(["again", "hard", "good", "easy"]),
  feedback: z.string().max(10_000).default(""),
});

function webDistPath(): string {
  if (process.env.ENPET_WEB_DIST) {
    return path.resolve(process.env.ENPET_WEB_DIST);
  }
  const directory = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(directory, "../../web/dist");
}

// 用户在输入框里写 ~/… 是很自然的事，但它只是 shell 的约定，Node 不认
function expandHome(targetPath: string): string {
  return targetPath.replace(/^~/, process.env.HOME || process.env.USERPROFILE || "");
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function refreshDerivedFiles(
  config: AppConfig,
  database: EnPetDatabase,
  date: string,
): Promise<void> {
  await writeReviewQueue(config.reviewQueuePath, database.getReviewQueue(date));
  const sessions = database.listRecentSessions(100).filter((session) => session.date === date);
  if (sessions.length > 0) {
    await writeDailyReport(config.reportsDir, date, sessions);
  }
}

export interface EnPetApp extends FastifyInstance {
  enPetDatabase: EnPetDatabase;
}

export async function buildApp(
  config: AppConfig,
  contentGenerator?: ContentGenerator,
  answerEvaluator?: AnswerEvaluator,
): Promise<EnPetApp> {
  // 如果没有提供contentGenerator，尝试使用Codex，否则回退到确定性实现
  let generator: ContentGenerator;
  if (!contentGenerator) {
    try {
      const codexGenerator = new CodexContentGenerator();
      const available = await codexGenerator.checkAvailability();
      generator = available ? codexGenerator : new DeterministicContentGenerator();
      console.log(`Using ${available ? "Codex" : "Deterministic"} content generator`);
    } catch {
      generator = new DeterministicContentGenerator();
      console.log("Using Deterministic content generator (Codex check failed)");
    }
  } else {
    generator = contentGenerator;
  }

  // 如果没有提供answerEvaluator，尝试使用Codex，否则回退到确定性实现
  let evaluator: AnswerEvaluator;
  if (!answerEvaluator) {
    try {
      const codexEvaluator = new CodexAnswerEvaluator();
      const available = await codexEvaluator.checkAvailability();
      evaluator = available ? codexEvaluator : new DeterministicAnswerEvaluator();
      console.log(`Using ${available ? "Codex" : "Deterministic"} answer evaluator`);
    } catch {
      evaluator = new DeterministicAnswerEvaluator();
      console.log("Using Deterministic answer evaluator (Codex check failed)");
    }
  } else {
    evaluator = answerEvaluator;
  }
  const app = Fastify({ logger: true }) as unknown as EnPetApp;
  const database = await EnPetDatabase.open(config.databasePath);
  app.enPetDatabase = database;
  const taskScheduler = new TaskScheduler(config);
  // config 本身就是活的上限来源：设置页改完就地更新它，下一次会话立刻按新值走
  const studyService = new StudyService(database, generator, evaluator, config);

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed"), false);
    },
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof VocabImportError) {
      reply.status(400).send({
        error: error.message,
        code: error.code,
        suggestions: error.suggestions,
      });
      return;
    }
    const statusCode =
      error instanceof z.ZodError
        ? 400
        : typeof error === "object" && error !== null && "statusCode" in error
          ? Number(error.statusCode)
          : 500;
    const message = error instanceof Error ? error.message : "Unknown error";
    reply.status(statusCode).send({
      error: statusCode === 500 ? "Internal server error" : message,
      details: error instanceof z.ZodError ? error.issues : undefined,
    });
  });

  app.get("/api/health", async () => ({
    status: "ok",
    // 桌面版由 Electron 注入真实版本；从源码跑时就是 dev，这本来也不是某个已发布版本
    version: process.env.ENPET_APP_VERSION ?? "dev",
    today: todayInTimeZone(config.timeZone),
    sourceEntries: database.countSourceEntries(),
    currentFileIndex: database.getCurrentFileIndex(),
    vocabDir: config.vocabDir,
    obsidianLink: obsidianVaultLink(config.vocabDir),
  }));

  app.get("/api/settings", async () => ({
    vocabDir: config.vocabDir,
    vocabFilePrefix: config.vocabFilePrefix,
    vocabFormat: config.vocabFormat,
    newWordsPerDay: config.newWordsPerDay,
    reviewLimit: config.reviewLimit,
    reminderTime: config.reminderTime,
  }));

  app.put("/api/settings", async (request) => {
    // 校验先于落盘：非法值直接 400，settings.json 不会被写坏
    const parsed = editableSettingsSchema.partial().parse(request.body ?? {});

    // exactOptionalPropertyTypes 下 Partial<T> 不接受显式 undefined，先滤掉
    const patch: Partial<EditableSettings> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== undefined) {
        (patch as Record<string, unknown>)[key] = value;
      }
    }
    if (patch.vocabDir) {
      patch.vocabDir = expandHome(patch.vocabDir);
    }

    await writeSettingsFile(settingsPathForDatabasePath(config.databasePath), patch);

    // 就地更新，运行中的服务立刻按新配置工作，不需要重启
    Object.assign(config, patch);
    if (patch.vocabDir) {
      // 报告和复习快照住在 vault 里，词库搬家时必须跟着搬
      config.reportsDir = path.join(patch.vocabDir, "study", "reports");
      config.reviewQueuePath = path.join(patch.vocabDir, "study", "review-queue.md");
      // 只在词库搬家时建目录：没动过位置就不该凭空造出一个目录来
      await ensureVaultDirectories(config);
    }

    return { success: true };
  });

  app.get("/api/onboarding", async () => {
    return detectOnboardingState(config);
  });

  app.post("/api/onboarding/setup-vault", async (request) => {
    const body = z
      .object({ vaultPath: z.string().optional(), withSample: z.boolean().optional() })
      .parse(request.body || {});
    const vaultPath = body.vaultPath || config.vocabDir;

    try {
      const expandedPath = expandHome(vaultPath);
      await createDefaultVaultStructure(
        { ...config, vocabDir: expandedPath },
        body.withSample ?? true,
      );
      // 必须落盘，否则 loadConfig 下次仍然读默认目录，导入会找不到刚创建的词库
      await writeSettingsFile(settingsPathForDatabasePath(config.databasePath), {
        vocabDir: expandedPath,
      });
      config.vocabDir = expandedPath;
      return {
        success: true,
        message: "词库目录已创建",
        vocabDir: expandedPath,
        obsidianLink: obsidianVaultLink(expandedPath),
      };
    } catch (error) {
      throw new Error(
        `设置词库目录失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  app.post("/api/onboarding/complete", async () => {
    await markOnboardingComplete(config);
    return { success: true };
  });

  // 定时任务管理端点
  app.get("/api/tasks", async () => {
    return await taskScheduler.getDefaultTasks();
  });

  app.post("/api/tasks/:taskId/run", async (request) => {
    const { taskId } = z.object({ taskId: z.string() }).parse(request.params);
    const task = (await taskScheduler.getDefaultTasks()).find((t) => t.id === taskId);
    if (!task) {
      return { error: "Task not found" };
    }

    try {
      const outcome =
        task.type === "new_learning"
          ? await studyService.createNewLearningSession(todayInTimeZone(config.timeZone))
          : studyService.createReviewSession(todayInTimeZone(config.timeZone));
      return {
        taskId,
        runAt: new Date().toISOString(),
        success: true,
        sessionId: outcome.session?.id,
        reason: outcome.reason,
      };
    } catch (error) {
      return {
        taskId,
        runAt: new Date().toISOString(),
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // 预览只解析不写库，用户在这里调格式、改词条，确认后才走 /api/import
  app.post("/api/import/preview", async (request) => {
    const body = z
      .object({ format: vocabFormatSchema.partial().optional(), limit: z.number().optional() })
      .parse(request.body || {});
    const vocabulary = await loadVocabulary(
      config.vocabDir,
      config.vocabFilePrefix,
      body.format ?? config.vocabFormat,
    );
    const limit = body.limit ?? 50;
    return {
      files: vocabulary.files,
      total: vocabulary.entries.length,
      format: vocabulary.format,
      issues: vocabulary.issues.slice(0, 20),
      entries: vocabulary.entries.slice(0, limit),
      vocabDir: config.vocabDir,
    };
  });

  app.put("/api/entries/:id", async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const fields = z
      .object({
        word: z.string().min(1).optional(),
        meaning: z.string().optional(),
        phonetic: z.string().optional(),
      })
      .parse(request.body || {});
    const entry = database.setEntryOverride(id, fields);
    if (!entry) {
      const error = new Error("词条不存在") as Error & { statusCode: number };
      error.statusCode = 404;
      throw error;
    }
    return entry;
  });

  app.delete("/api/entries/:id/override", async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    database.clearEntryOverride(id);
    return { success: true };
  });

  // /api/import 和「用示例词先试试」走的是同一段导入逻辑。
  // detectFormat 用于后者：示例词库是我们自己写的一词一行表格，格式确定，
  // 不能拿用户存量的 vocabFormat 去套——老用户存的可能是旧的 cell 堆叠格式，
  // 用它解析会把 6 个词拆成 21 条垃圾。
  async function importFromVault({ detectFormat = false } = {}) {
    const vocabulary = await loadVocabulary(
      config.vocabDir,
      config.vocabFilePrefix,
      detectFormat ? undefined : config.vocabFormat,
    );
    // 没有词库文件时不写库，直接回报 0，让前端提示而不是当成失败
    if (vocabulary.files === 0) {
      return {
        files: 0,
        parsed: 0,
        inserted: 0,
        updated: 0,
        issues: [],
        vocabDir: config.vocabDir,
        message: `词库目录中还没有 ${config.vocabFilePrefix}*.md 文件`,
      };
    }
    const summary = database.importEntries(vocabulary.entries, vocabulary.files, vocabulary.issues);
    await writeReviewQueue(
      config.reviewQueuePath,
      database.getReviewQueue(todayInTimeZone(config.timeZone)),
    );
    return summary;
  }

  // 空词库的用户点「用示例词先试试」：建词库文件再导入，一步到位。
  // createDefaultVaultStructure 遇到已存在的词库文件会跳过，不会冲掉用户自己的词库。
  app.post("/api/vault/sample", async () => {
    await createDefaultVaultStructure(config, true);
    return importFromVault({ detectFormat: true });
  });

  app.post("/api/import", async (request) => {
    const body = z
      .object({ format: vocabFormatSchema.partial().optional() })
      .parse(request.body || {});
    // 导入时确认的格式要存下来，下次同步词库不用重新选
    if (body.format) {
      await writeSettingsFile(settingsPathForDatabasePath(config.databasePath), {
        vocabFormat: normalizeFormat(body.format),
      });
      config.vocabFormat = normalizeFormat(body.format);
    }
    return importFromVault();
  });

  app.post("/api/backup", async () => {
    const date = todayInTimeZone(config.timeZone);
    const targetPath = path.resolve(
      path.dirname(config.databasePath),
      "../backups",
      `enpet-${date}.sqlite3`,
    );
    const pages = await database.createBackup(targetPath);
    return { targetPath, pages };
  });

  app.post("/api/sessions/new/today", async (request) => {
    const { date = todayInTimeZone(config.timeZone) } = dateBodySchema.parse(request.body ?? {});
    return studyService.createNewLearningSession(date);
  });

  app.get("/api/sessions/new/today", async (request) => {
    const query = z
      .object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(request.query);
    const date = query.date ?? todayInTimeZone(config.timeZone);
    return { session: database.getSessionByDate(date, "new_learning") };
  });

  app.post("/api/sessions/review/today", async (request) => {
    const { date = todayInTimeZone(config.timeZone) } = dateBodySchema.parse(request.body ?? {});
    return studyService.createReviewSession(date);
  });

  app.get("/api/sessions/review/today", async (request) => {
    const query = z
      .object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(request.query);
    const date = query.date ?? todayInTimeZone(config.timeZone);
    return { session: database.getSessionByDate(date, "review") };
  });

  app.get("/api/reviews/queue", async (request) => {
    const query = z
      .object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(request.query);
    const date = query.date ?? todayInTimeZone(config.timeZone);
    return database.getReviewQueue(date);
  });

  app.post("/api/sessions/:sessionId/items/:sourceEntryId", async (request) => {
    const parameters = z
      .object({ sessionId: z.string().min(1), sourceEntryId: z.string().min(1) })
      .parse(request.params);
    const body = itemBodySchema.parse(request.body);
    const session = await studyService.submitItem(
      parameters.sessionId,
      parameters.sourceEntryId,
      body.answer,
      body.rating,
      body.feedback,
    );
    await refreshDerivedFiles(config, database, session.date);
    return { session };
  });

  app.post("/api/sessions/:sessionId/complete", async (request) => {
    const { sessionId } = z.object({ sessionId: z.string().min(1) }).parse(request.params);
    const session = studyService.completeNewLearningSession(sessionId);
    await refreshDerivedFiles(config, database, session.date);
    return { session };
  });

  app.get("/api/history", async (request) => {
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(30) })
      .parse(request.query);
    return { sessions: database.listRecentSessions(query.limit) };
  });

  const staticRoot = webDistPath();
  if (await exists(path.join(staticRoot, "index.html"))) {
    await app.register(fastifyStatic, {
      root: staticRoot,
      prefix: "/",
      // 必须关掉插件自带的 cacheControl，否则它会在 setHeaders 之后覆盖 Cache-Control
      cacheControl: false,
      // 标准的两层缓存策略：构建产物文件名带内容哈希，可以永久缓存，换版本时文件名自然变；
      // index.html 文件名固定，必须每次回源校验，否则新版发布后浏览器会一直复用旧外壳，
      // 旧外壳又引用旧哈希资源，整个界面就停在上一个版本。
      setHeaders(response, filePath) {
        const immutable = filePath.includes(`${path.sep}assets${path.sep}`);
        response.setHeader(
          "Cache-Control",
          immutable ? "public, max-age=31536000, immutable" : "no-cache, must-revalidate",
        );
      },
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        reply.status(404).send({ error: "API route not found" });
        return;
      }
      reply.sendFile("index.html");
    });
  }

  app.addHook("onClose", async () => database.close());
  return app;
}
