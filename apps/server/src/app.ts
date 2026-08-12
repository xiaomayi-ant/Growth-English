import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AppConfig,
  todayInTimeZone,
  createDefaultVaultStructure,
  detectOnboardingState,
  markOnboardingComplete,
  settingsPathForDatabasePath,
  writeSettingsFile,
  TaskScheduler,
} from "@enpet/core";
import { EnPetDatabase } from "@enpet/database";
import {
  type AnswerEvaluator,
  type ContentGenerator,
  CodexContentGenerator,
  CodexAnswerEvaluator,
  DeterministicAnswerEvaluator,
  DeterministicContentGenerator,
} from "@enpet/evaluation";
import { writeDailyReport, writeReviewQueue } from "@enpet/reporting";
import { StudyService } from "@enpet/scheduler";
import { loadVocabulary, VocabImportError } from "@enpet/vocabulary-import";
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
  const studyService = new StudyService(
    database,
    generator,
    evaluator,
    config.newWordsPerDay,
    config.reviewLimit,
  );

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
    today: todayInTimeZone(config.timeZone),
    sourceEntries: database.countSourceEntries(),
    currentFileIndex: database.getCurrentFileIndex(),
  }));

  app.get("/api/onboarding", async () => {
    return detectOnboardingState(config);
  });

  app.post("/api/onboarding/setup-vault", async (request) => {
    const body = z
      .object({ vaultPath: z.string().optional(), withSample: z.boolean().optional() })
      .parse(request.body || {});
    const vaultPath = body.vaultPath || config.vocabDir;

    try {
      // 展开用户提供的路径
      const expandedPath = vaultPath.replace(
        /^~/,
        process.env.HOME || process.env.USERPROFILE || "",
      );
      await createDefaultVaultStructure(
        { ...config, vocabDir: expandedPath },
        body.withSample ?? true,
      );
      // 必须落盘，否则 loadConfig 下次仍然读默认目录，导入会找不到刚创建的词库
      await writeSettingsFile(settingsPathForDatabasePath(config.databasePath), {
        vocabDir: expandedPath,
      });
      config.vocabDir = expandedPath;
      return { success: true, message: "词库目录已创建", vocabDir: expandedPath };
    } catch (error) {
      throw new Error(`设置词库目录失败: ${error instanceof Error ? error.message : String(error)}`);
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
    const task = (await taskScheduler.getDefaultTasks()).find(t => t.id === taskId);
    if (!task) {
      return { error: "Task not found" };
    }

    try {
      let result;
      if (task.type === "new_learning") {
        const session = await studyService.createNewLearningSession(todayInTimeZone(config.timeZone));
        result = { taskId, runAt: new Date().toISOString(), success: true, sessionId: session?.id };
      } else {
        const session = studyService.createReviewSession(todayInTimeZone(config.timeZone));
        result = { taskId, runAt: new Date().toISOString(), success: true, sessionId: session?.id };
      }
      return result;
    } catch (error) {
      return {
        taskId,
        runAt: new Date().toISOString(),
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });

  app.post("/api/import", async () => {
    const vocabulary = await loadVocabulary(config.vocabDir, config.vocabFilePrefix);
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
    const session = await studyService.createNewLearningSession(date);
    return { session, reason: session ? null : "No new learning task for this date" };
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
    const session = studyService.createReviewSession(date);
    return { session, reason: session ? null : "No review task for this date" };
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
    await app.register(fastifyStatic, { root: staticRoot, prefix: "/" });
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
