import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { EvaluationResult, SourceEntry } from "@en-play/core";

const execAsync = promisify(exec);

interface MeaningEvaluationRequest {
  word: string;
  meaning: string;
  answer: string;
}

interface TranslationEvaluationRequest {
  passage: string;
  referenceTranslation: string;
  answer: string;
}

interface EvaluationResponse {
  suggestedRating: "again" | "hard" | "good" | "easy";
  score: number;
  feedback: string;
  corrections: string[];
}

export class CodexAnswerEvaluator {
  constructor(private readonly timeout = 30000) {}

  async evaluateMeaning(entry: SourceEntry, answer: string): Promise<EvaluationResult> {
    if (!answer.trim()) {
      return {
        suggestedRating: "again",
        score: 0,
        feedback: "尚未提交答案。",
        corrections: [entry.meaning],
      };
    }

    try {
      const prompt = this.buildMeaningPrompt(entry, answer);
      const response = await this.callCodexCLI<EvaluationResponse>("meaning", prompt);
      return response;
    } catch (error) {
      console.error("Codex CLI evaluation failed, using fallback:", error);
      return this.fallbackMeaningEvaluation(entry, answer);
    }
  }

  async evaluateTranslation(
    passage: string,
    referenceTranslation: string,
    answer: string,
  ): Promise<EvaluationResult> {
    if (!answer.trim()) {
      return {
        suggestedRating: "again",
        score: 0,
        feedback: "尚未提交翻译。",
        corrections: [referenceTranslation],
      };
    }

    try {
      const prompt = this.buildTranslationPrompt(passage, referenceTranslation, answer);
      const response = await this.callCodexCLI<EvaluationResponse>("translation", prompt);
      return response;
    } catch (error) {
      console.error("Codex CLI evaluation failed, using fallback:", error);
      return this.fallbackTranslationEvaluation(referenceTranslation, answer);
    }
  }

  private buildMeaningPrompt(entry: SourceEntry, answer: string): string {
    return `Evaluate this vocabulary learning answer.

Word: "${entry.word}"
Reference Meaning: "${entry.meaning}"
Student's Answer: "${answer}"

Evaluate the student's answer and provide feedback. Respond ONLY with valid JSON in this format:
{
  "suggestedRating": "again|hard|good|easy",
  "score": 0-100,
  "feedback": "Specific feedback in Chinese",
  "corrections": ["correct or improved meanings"]
}

Rating criteria:
- "again": Completely wrong or no understanding
- "hard": Partially correct or needs significant improvement
- "good": Correct understanding with minor issues
- "easy": Perfect or excellent understanding`;
  }

  private buildTranslationPrompt(passage: string, referenceTranslation: string, answer: string): string {
    return `Evaluate this translation exercise.

Original Passage: "${passage}"
Reference Translation: "${referenceTranslation}"
Student's Translation: "${answer}"

Evaluate the student's translation and provide feedback. Respond ONLY with valid JSON in this format:
{
  "suggestedRating": "again|hard|good|easy",
  "score": 0-100,
  "feedback": "Specific feedback in Chinese highlighting accuracy and naturalness",
  "corrections": ["improved translations if needed"]
}

Consider accuracy, fluency, and naturalness in your evaluation.`;
  }

  private async callCodexCLI<T>(command: string, prompt: string): Promise<T> {
    try {
      const { stdout } = await execAsync(`echo '${prompt.replace(/'/g, "'\"'\"'")}' | codex exec`, {
        timeout: this.timeout,
        maxBuffer: 1024 * 1024, // 1MB buffer
      });

      // 尝试从输出中提取JSON
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No valid JSON found in Codex response");
      }

      const result = JSON.parse(jsonMatch[0]) as T;
      return result;
    } catch (error) {
      throw new Error(`Codex CLI call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private fallbackMeaningEvaluation(entry: SourceEntry, answer: string): EvaluationResult {
    const normalizedAnswer = answer.trim().toLowerCase();
    const normalizedMeaning = entry.meaning.toLowerCase();
    const firstWord = normalizedMeaning.split(" ")[0];
    const exact = normalizedMeaning.includes(normalizedAnswer) || (firstWord && normalizedAnswer.includes(firstWord));

    return {
      suggestedRating: exact ? "good" : "hard",
      score: exact ? 75 : 50,
      feedback: exact ? "基本正确，继续巩固。" : "部分正确，建议复习。",
      corrections: exact ? [] : [entry.meaning],
    };
  }

  private fallbackTranslationEvaluation(referenceTranslation: string, answer: string): EvaluationResult {
    const answered = answer.trim().length > 0;

    return {
      suggestedRating: answered ? "hard" : "again",
      score: answered ? 60 : 0,
      feedback: answered ? "翻译已保存，AI评测暂不可用。" : "尚未提交翻译。",
      corrections: answered ? [referenceTranslation] : [],
    };
  }

  async checkAvailability(): Promise<boolean> {
    try {
      await execAsync("codex --version", { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}
