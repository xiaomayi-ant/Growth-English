import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AppConfig, ScenarioContent, SourceEntry } from "@enpet/core";
import type { ContentGenerator } from "@enpet/evaluation";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type EnPetApp } from "./app.js";

const baseConfig: AppConfig = {
  host: "127.0.0.1",
  port: 4173,
  timeZone: "Asia/Shanghai",
  vocabDir: "/tmp/does-not-matter",
  vocabFilePrefix: "english-words",
  databasePath: ":memory:",
  reportsDir: "/tmp/enpet-test/reports",
  reviewQueuePath: "/tmp/enpet-test/review-queue.md",
  newWordsPerDay: 6,
  reviewLimit: 30,
  reminderTime: "09:00",
};

class TestGenerator implements ContentGenerator {
  async generateScenario(candidates: SourceEntry[], count: number): Promise<ScenarioContent> {
    const selected = candidates.slice(0, count);
    return {
      selectedEntryIds: selected.map((entry) => entry.id),
      theme: "test",
      passage: "test passage",
      referenceTranslation: "测试短文",
    };
  }
}

describe("API", () => {
  let app: EnPetApp;

  beforeEach(async () => {
    app = await buildApp({ ...baseConfig }, new TestGenerator());
    app.enPetDatabase.importEntries(
      Array.from({ length: 6 }, (_, index) => ({
        id: `f001-r001-c0${index + 1}`,
        fileIndex: 1,
        rowIndex: 1,
        columnIndex: index + 1,
        sourcePath: "/vault/english-words.md",
        word: `word-${index + 1}`,
        meaning: `meaning-${index + 1}`,
        phonetic: "-",
        sourceOrder: 100_000 + index,
      })),
      1,
      [],
    );
  });

  afterEach(async () => app.close());

  // 目录存在但还没有词库文件是首次使用的正常状态，不能当成失败
  it("reports an empty import instead of failing when the directory has no vocabulary files", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "enpet-empty-vocab-"));
    const empty = await buildApp({ ...baseConfig, vocabDir: directory }, new TestGenerator());
    try {
      const response = await empty.inject({ method: "POST", url: "/api/import" });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.files).toBe(0);
      expect(body.inserted).toBe(0);
      expect(body.message).toContain("english-words");
    } finally {
      await empty.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("writes the onboarding marker so the wizard stops replaying", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "enpet-onboarding-"));
    const databasePath = path.join(directory, "enpet.sqlite3");
    const scoped = await buildApp({ ...baseConfig, databasePath }, new TestGenerator());
    try {
      expect((await scoped.inject({ method: "GET", url: "/api/onboarding" })).json().step).not.toBe(
        "complete",
      );
      const response = await scoped.inject({ method: "POST", url: "/api/onboarding/complete" });
      expect(response.statusCode).toBe(200);
      expect(existsSync(path.join(directory, ".onboarding-complete"))).toBe(true);
    } finally {
      await scoped.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns 400 with a readable message when the vocabulary directory is missing", async () => {
    const response = await app.inject({ method: "POST", url: "/api/import" });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.code).toBe("VOCAB_DIR_NOT_FOUND");
    expect(body.error).toContain("/tmp/does-not-matter");
  });

  it("creates an idempotent new learning session", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/sessions/new/today",
      payload: { date: "2026-07-06" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/sessions/new/today",
      payload: { date: "2026-07-06" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().session.id).toBe("new_learning:2026-07-06");
    expect(second.json().session.id).toBe(first.json().session.id);
  });

  it("does not create weekday tasks on weekends", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/sessions/new/today",
      payload: { date: "2026-07-11" },
    });
    expect(response.json().session).toBeNull();
  });

  it("limits new learning sessions to the configured newWordsPerDay", async () => {
    const limited = await buildApp({ ...baseConfig, newWordsPerDay: 3 }, new TestGenerator());
    limited.enPetDatabase.importEntries(
      Array.from({ length: 6 }, (_, index) => ({
        id: `f001-r001-c0${index + 1}`,
        fileIndex: 1,
        rowIndex: 1,
        columnIndex: index + 1,
        sourcePath: "/vault/english-words.md",
        word: `word-${index + 1}`,
        meaning: `meaning-${index + 1}`,
        phonetic: "-",
        sourceOrder: 100_000 + index,
      })),
      1,
      [],
    );
    const response = await limited.inject({
      method: "POST",
      url: "/api/sessions/new/today",
      payload: { date: "2026-07-06" },
    });
    expect(response.json().session.items).toHaveLength(3);
    await limited.close();
  });

  it("auto evaluates items and completes new learning after the last rating", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions/new/today",
      payload: { date: "2026-07-06" },
    });
    const session = created.json().session;

    let latest = session;
    for (const item of session.items) {
      const response = await app.inject({
        method: "POST",
        url: `/api/sessions/${encodeURIComponent(session.id)}/items/${encodeURIComponent(
          item.sourceEntry.id,
        )}`,
        payload: { answer: item.sourceEntry.meaning, rating: "good" },
      });
      latest = response.json().session;
    }

    expect(latest.status).toBe("completed");
    expect(
      latest.items.every((item: { feedback: string | null }) =>
        item.feedback?.includes("自动批改"),
      ),
    ).toBe(true);
    expect(app.enPetDatabase.getReviewQueue("2026-07-07").dueToday).toHaveLength(6);
  });
});
