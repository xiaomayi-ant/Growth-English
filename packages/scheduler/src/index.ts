import { isWeekend, type Rating, type StudySession } from "@en-play/core";
import type { EnPlayDatabase } from "@en-play/database";
import type { ContentGenerator } from "@en-play/evaluation";

export class StudyService {
  constructor(
    private readonly database: EnPlayDatabase,
    private readonly contentGenerator: ContentGenerator,
    private readonly newWordsPerDay: number,
    private readonly reviewLimit: number,
  ) {}

  async createNewLearningSession(date: string): Promise<StudySession | null> {
    if (isWeekend(date)) return null;
    const existing = this.database.getSessionByDate(date, "new_learning");
    if (existing) return existing;
    const fileIndex = this.database.getCurrentFileIndex();
    if (fileIndex === null) return null;
    const candidates = this.database.getUnlearnedEntries(fileIndex);
    if (candidates.length === 0) return null;
    const scenario = await this.contentGenerator.generateScenario(candidates, this.newWordsPerDay);
    const byId = new Map(candidates.map((entry) => [entry.id, entry]));
    const selected = [...new Set(scenario.selectedEntryIds)]
      .map((id) => byId.get(id))
      .filter((entry) => entry !== undefined)
      .slice(0, this.newWordsPerDay);
    if (selected.length === 0) {
      throw new Error("Content generator did not select any valid source entries");
    }
    return this.database.createNewSession(date, selected, {
      ...scenario,
      selectedEntryIds: selected.map((entry) => entry.id),
    });
  }

  createReviewSession(date: string): StudySession | null {
    if (isWeekend(date)) return null;
    return this.database.createReviewSession(date, this.reviewLimit);
  }

  submitItem(
    sessionId: string,
    sourceEntryId: string,
    answer: string,
    rating: Rating,
    feedback = "",
  ): StudySession {
    return this.database.submitSessionItem(sessionId, sourceEntryId, answer, rating, feedback);
  }

  completeNewLearningSession(sessionId: string): StudySession {
    return this.database.completeNewSession(sessionId);
  }
}
