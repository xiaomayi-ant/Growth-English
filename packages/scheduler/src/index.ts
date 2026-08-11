import { isWeekend, type Rating, type StudySession } from "@enpet/core";
import type { EnPetDatabase } from "@enpet/database";
import type { AnswerEvaluator, ContentGenerator } from "@enpet/evaluation";

const ratingLabels: Record<Rating, string> = {
  again: "忘记",
  hard: "模糊",
  good: "掌握",
  easy: "熟练",
};

function formatEvaluationFeedback(
  result: Awaited<ReturnType<AnswerEvaluator["evaluateMeaning"]>>,
): string {
  return `自动批改：${result.feedback} 建议：${ratingLabels[result.suggestedRating]}，得分：${result.score}/100`;
}

export class StudyService {
  constructor(
    private readonly database: EnPetDatabase,
    private readonly contentGenerator: ContentGenerator,
    private readonly answerEvaluator: AnswerEvaluator,
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

  async submitItem(
    sessionId: string,
    sourceEntryId: string,
    answer: string,
    rating: Rating,
    feedback = "",
  ): Promise<StudySession> {
    const entry = this.database.getSourceEntry(sourceEntryId);
    if (!entry) throw new Error("Source entry not found");
    const evaluation = await this.answerEvaluator.evaluateMeaning(entry, answer);
    const resolvedFeedback = feedback.trim() || formatEvaluationFeedback(evaluation);
    const session = this.database.submitSessionItem(
      sessionId,
      sourceEntryId,
      answer,
      rating,
      resolvedFeedback,
    );
    if (
      session.type === "new_learning" &&
      session.status !== "completed" &&
      session.items.every((item) => item.completedAt !== null)
    ) {
      return this.database.completeNewSession(session.id);
    }
    return session;
  }

  completeNewLearningSession(sessionId: string): StudySession {
    return this.database.completeNewSession(sessionId);
  }
}
