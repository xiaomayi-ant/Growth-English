import type { Rating, ScenarioContent, SourceEntry } from "@enpet/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnPetDatabase } from "./index.js";

function entries(count = 6): SourceEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `f001-r${String(index + 1).padStart(3, "0")}-c01`,
    fileIndex: 1,
    rowIndex: index + 1,
    columnIndex: 1,
    sourcePath: "/vault/english-words.md",
    word: `word-${index + 1}`,
    meaning: `含义-${index + 1}`,
    phonetic: "-",
    sourceOrder: 100_000 + (index + 1) * 10 + 1,
  }));
}

describe("EnPetDatabase", () => {
  let database: EnPetDatabase;

  beforeEach(async () => {
    database = await EnPetDatabase.open(":memory:");
  });

  afterEach(() => database.close());

  it("imports source entries idempotently", () => {
    const sourceEntries = entries();
    expect(database.importEntries(sourceEntries, 1, [])).toMatchObject({ inserted: 6, updated: 0 });
    expect(database.importEntries(sourceEntries, 1, [])).toMatchObject({ inserted: 0, updated: 6 });
    expect(database.countSourceEntries()).toBe(6);
    expect(database.getCurrentFileIndex()).toBe(1);
  });

  it("creates review rounds only after a new session is completed", () => {
    const sourceEntries = entries();
    database.importEntries(sourceEntries, 1, []);
    const scenario: ScenarioContent = {
      selectedEntryIds: sourceEntries.map((entry) => entry.id),
      theme: "test",
      passage: "passage",
      referenceTranslation: "translation",
    };
    let session = database.createNewSession("2026-07-06", sourceEntries, scenario);
    expect(database.getReviewQueue("2026-07-07").dueToday).toHaveLength(0);

    for (const entry of sourceEntries) {
      session = database.submitSessionItem(session.id, entry.id, entry.meaning, "good");
    }
    session = database.completeNewSession(session.id);

    expect(session.status).toBe("completed");
    expect(database.getReviewQueue("2026-07-07").dueToday).toHaveLength(6);
    expect(database.getCurrentFileIndex()).toBeNull();
  });

  it("merges review rounds that land on the same workday", () => {
    const [entry] = entries(1);
    if (!entry) throw new Error("fixture missing");
    database.importEntries([entry], 1, []);
    const newSession = database.createNewSession("2026-07-10", [entry], {
      selectedEntryIds: [entry.id],
      theme: "test",
      passage: "passage",
      referenceTranslation: "translation",
    });
    database.submitSessionItem(newSession.id, entry.id, entry.meaning, "good");
    database.completeNewSession(newSession.id);

    const review = database.createReviewSession("2026-07-13", 30);
    expect(review.items).toHaveLength(1);
    expect(review.items[0]?.roundNumber).toBe(2);
    database.submitSessionItem(review.id, entry.id, "answer", "good" satisfies Rating);
    expect(database.getReviewQueue("2026-07-13").dueToday).toHaveLength(0);
  });
});
