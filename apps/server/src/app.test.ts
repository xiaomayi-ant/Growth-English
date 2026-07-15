import type { AppConfig, ScenarioContent, SourceEntry } from "@en-play/core";
import type { ContentGenerator } from "@en-play/evaluation";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type EnPlayApp } from "./app.js";

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
  let app: EnPlayApp;

  beforeEach(async () => {
    const config: AppConfig = {
      host: "127.0.0.1",
      port: 4173,
      timeZone: "Asia/Shanghai",
      vocabDir: "/tmp/does-not-matter",
      databasePath: ":memory:",
      reportsDir: "/tmp/en-play-test/reports",
      reviewQueuePath: "/tmp/en-play-test/review-queue.md",
      newWordsPerDay: 6,
      reviewLimit: 30,
    };
    app = await buildApp(config, new TestGenerator());
    app.enPlayDatabase.importEntries(
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
    expect(app.enPlayDatabase.getReviewQueue("2026-07-07").dueToday).toHaveLength(6);
  });
});
