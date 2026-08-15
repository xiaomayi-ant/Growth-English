import { isWeekend, type Rating, type SessionOutcome, type StudySession } from "@enpet/core";
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

/**
 * 每日上限在设置页可改，改完要当场生效。传数字就等于在构造时拍了张快照，
 * 之后再改设置这里看不见，所以持有的是配置对象本身。
 */
export interface StudyLimits {
  readonly newWordsPerDay: number;
  readonly reviewLimit: number;
}

export class StudyService {
  constructor(
    private readonly database: EnPetDatabase,
    private readonly contentGenerator: ContentGenerator,
    private readonly answerEvaluator: AnswerEvaluator,
    private readonly limits: StudyLimits,
  ) {}

  async createNewLearningSession(date: string): Promise<SessionOutcome> {
    if (isWeekend(date)) return { session: null, reason: "weekend" };
    const existing = this.database.getSessionByDate(date, "new_learning");
    if (existing) return { session: existing, reason: null };
    // getCurrentFileIndex 返回的是「还有未学词」的文件，词学完后它同样是 null，
    // 所以「一个词都没有」和「都学完了」得靠总词条数来分辨
    const fileIndex = this.database.getCurrentFileIndex();
    if (fileIndex === null) {
      const empty = this.database.countSourceEntries() === 0;
      return { session: null, reason: empty ? "no-vocabulary" : "all-learned" };
    }
    const candidates = this.database.getUnlearnedEntries(fileIndex);
    if (candidates.length === 0) return { session: null, reason: "all-learned" };
    const scenario = await this.contentGenerator.generateScenario(
      candidates,
      this.limits.newWordsPerDay,
    );
    const byId = new Map(candidates.map((entry) => [entry.id, entry]));
    const selected = [...new Set(scenario.selectedEntryIds)]
      .map((id) => byId.get(id))
      .filter((entry) => entry !== undefined)
      .slice(0, this.limits.newWordsPerDay);
    if (selected.length === 0) {
      throw new Error("Content generator did not select any valid source entries");
    }
    const session = this.database.createNewSession(date, selected, {
      ...scenario,
      selectedEntryIds: selected.map((entry) => entry.id),
    });
    return { session, reason: null };
  }

  // 没有到期词时照样建会话（items 为空），所以这里只有周末一种拒绝
  createReviewSession(date: string): SessionOutcome {
    if (isWeekend(date)) return { session: null, reason: "weekend" };
    return {
      session: this.database.createReviewSession(date, this.limits.reviewLimit),
      reason: null,
    };
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
