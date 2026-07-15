import type { EvaluationResult, ScenarioContent, SourceEntry } from "@en-play/core";

export interface ContentGenerator {
  generateScenario(candidates: SourceEntry[], count: number): Promise<ScenarioContent>;
}

export interface AnswerEvaluator {
  evaluateMeaning(entry: SourceEntry, answer: string): Promise<EvaluationResult>;
  evaluateTranslation(
    passage: string,
    referenceTranslation: string,
    answer: string,
  ): Promise<EvaluationResult>;
}

export class DeterministicContentGenerator implements ContentGenerator {
  async generateScenario(candidates: SourceEntry[], count: number): Promise<ScenarioContent> {
    const selected = candidates.slice(0, count);
    const words = selected.map((entry) => entry.word);
    return {
      selectedEntryIds: selected.map((entry) => entry.id),
      theme: "顺序学习",
      passage:
        selected.length === 0
          ? ""
          : `This practice scene connects today's target words: ${words.join(", ")}. Read each word in context, then create a more natural version after recalling its meaning.`,
      referenceTranslation:
        selected.length === 0
          ? ""
          : `这个练习场景连接了今天的目标词：${words.join("、")}。先在上下文中阅读，再回忆词义并尝试写出更自然的版本。`,
    };
  }
}

export class DeterministicAnswerEvaluator implements AnswerEvaluator {
  async evaluateMeaning(entry: SourceEntry, answer: string): Promise<EvaluationResult> {
    const normalizedAnswer = answer.trim();
    const exact = normalizedAnswer.length > 0 && entry.meaning.includes(normalizedAnswer);
    return {
      suggestedRating: exact ? "good" : normalizedAnswer ? "hard" : "again",
      score: exact ? 90 : normalizedAnswer ? 55 : 0,
      feedback: exact ? "释义覆盖了参考答案。" : `参考释义：${entry.meaning}`,
      corrections: exact ? [] : [entry.meaning],
    };
  }

  async evaluateTranslation(
    _passage: string,
    referenceTranslation: string,
    answer: string,
  ): Promise<EvaluationResult> {
    const answered = answer.trim().length > 0;
    return {
      suggestedRating: answered ? "hard" : "again",
      score: answered ? 60 : 0,
      feedback: answered ? "已保存翻译，语义模型接入后会提供进一步反馈。" : "尚未提交翻译。",
      corrections: answered ? [referenceTranslation] : [],
    };
  }
}
