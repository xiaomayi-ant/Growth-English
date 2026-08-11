import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ScenarioContent, SourceEntry } from "@enpet/core";

const execAsync = promisify(exec);

interface CodexScenarioRequest {
  candidates: Array<{ id: string; word: string; meaning: string }>;
  count: number;
}

interface CodexScenarioResponse {
  selectedIds: string[];
  theme: string;
  passage: string;
  referenceTranslation: string;
}

export class CodexContentGenerator {
  constructor(private readonly timeout = 30000) {}

  async generateScenario(candidates: SourceEntry[], count: number): Promise<ScenarioContent> {
    if (candidates.length <= count) {
      // 如果候选词数量不足，直接使用所有词
      return this.createBasicScenario(candidates, candidates.length);
    }

    try {
      const prompt = this.buildScenarioPrompt(candidates, count);
      const response = await this.callCodexCLI<CodexScenarioResponse>("scenario", prompt);

      // 验证返回的ID是否都属于候选词
      const selectedIds = response.selectedIds.filter((id: string) =>
        candidates.some((entry) => entry.id === id)
      );

      if (selectedIds.length === 0) {
        // 如果没有有效的选择，回退到基础实现
        return this.createBasicScenario(candidates, count);
      }

      return {
        selectedEntryIds: selectedIds,
        theme: response.theme,
        passage: response.passage,
        referenceTranslation: response.referenceTranslation,
      };
    } catch (error) {
      // Codex CLI调用失败，回退到基础实现
      console.error("Codex CLI call failed, falling back to basic implementation:", error);
      return this.createBasicScenario(candidates, count);
    }
  }

  private buildScenarioPrompt(candidates: SourceEntry[], count: number): string {
    const candidatesList = candidates.map((entry) =>
      `- ID: ${entry.id}, Word: "${entry.word}", Meaning: "${entry.meaning}"`
    ).join("\n");

    return `You are a language learning content generator. Select ${count} semantically compatible words from the following candidates and create a learning scenario.

Candidates:
${candidatesList}

Requirements:
1. Select ${count} words that can form a coherent scenario or theme
2. Create a short passage (50-100 words) that naturally uses these words
3. Provide a Chinese translation of the passage
4. Respond ONLY with valid JSON in this exact format:
{
  "selectedIds": ["id1", "id2", ...],
  "theme": "theme description",
  "passage": "English passage with selected words in context",
  "referenceTranslation": "Chinese translation"
}`;
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

  private createBasicScenario(candidates: SourceEntry[], count: number): ScenarioContent {
    const selected = candidates.slice(0, Math.min(count, candidates.length));
    const words = selected.map((entry) => entry.word);

    return {
      selectedEntryIds: selected.map((entry) => entry.id),
      theme: "顺序学习",
      passage:
        selected.length === 0
          ? ""
          : `This practice session includes ${words.length} word${words.length === 1 ? "" : "s"}: ${words.join(", ")}. Study each word carefully and practice using them in context.`,
      referenceTranslation:
        selected.length === 0
          ? ""
          : `本次练习包含${words.length}个词汇：${words.join("、")}。请仔细学习每个单词并在语境中练习使用。`,
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
