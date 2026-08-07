import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type AppConfig, todayInTimeZone } from "@en-play/core";
import { EnPlayDatabase } from "@en-play/database";
import {
  type AnswerEvaluator,
  type ContentGenerator,
  DeterministicAnswerEvaluator,
  DeterministicContentGenerator,
} from "@en-play/evaluation";
import { writeDailyReport, writeReviewQueue } from "@en-play/reporting";
import { StudyService } from "@en-play/scheduler";
import { loadVocabulary, VocabImportError } from "@en-play/vocabulary-import";
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
  if (process.env.EN_PLAY_WEB_DIST) {
    return path.resolve(process.env.EN_PLAY_WEB_DIST);
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
  database: EnPlayDatabase,
  date: string,
): Promise<void> {
  await writeReviewQueue(config.reviewQueuePath, database.getReviewQueue(date));
  const sessions = database.listRecentSessions(100).filter((session) => session.date === date);
  if (sessions.length > 0) {
    await writeDailyReport(config.reportsDir, date, sessions);
  }
}

export interface EnPlayApp extends FastifyInstance {
  enPlayDatabase: EnPlayDatabase;
}

export async function buildApp(
  config: AppConfig,
  contentGenerator: ContentGenerator = new DeterministicContentGenerator(),
  answerEvaluator: AnswerEvaluator = new DeterministicAnswerEvaluator(),
): Promise<EnPlayApp> {
  const app = Fastify({ logger: true }) as unknown as EnPlayApp;
  const database = await EnPlayDatabase.open(config.databasePath);
  app.enPlayDatabase = database;
  const studyService = new StudyService(
    database,
    contentGenerator,
    answerEvaluator,
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
      reply.status(400).send({ error: error.message, code: error.code });
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

  app.post("/api/import", async () => {
    const vocabulary = await loadVocabulary(config.vocabDir);
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
      `en-play-${date}.sqlite3`,
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
