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
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse({
    host: env.EN_PLAY_HOST ?? "127.0.0.1",
    port: Number(env.EN_PLAY_PORT ?? 4173),
    timeZone: env.EN_PLAY_TIMEZONE ?? "Asia/Shanghai",
    vocabDir: env.EN_PLAY_VOCAB_DIR ?? "/Users/linctex/Projects/obsidian/en",
    databasePath:
      env.EN_PLAY_DATABASE_PATH ?? "/Users/linctex/Projects/cloned/en-play/data/en-play.sqlite3",
    reportsDir: env.EN_PLAY_REPORTS_DIR ?? "/Users/linctex/Projects/obsidian/en/study/reports",
    reviewQueuePath:
      env.EN_PLAY_REVIEW_QUEUE_PATH ?? "/Users/linctex/Projects/obsidian/en/study/review-queue.md",
    newWordsPerDay: Number(env.EN_PLAY_NEW_WORDS_PER_DAY ?? 6),
    reviewLimit: Number(env.EN_PLAY_REVIEW_LIMIT ?? 30),
  });
}
