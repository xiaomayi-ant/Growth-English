import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { AppConfig } from "./config.js";

export interface OnboardingState {
  step: "welcome" | "setup" | "import" | "first-lesson" | "complete";
  hasExistingData: boolean;
  completedSteps: string[];
}

// 用于标记onboarding完成的文件
const ONBOARDING_COMPLETE_FILE = ".onboarding-complete";

export function detectOnboardingState(config: AppConfig): OnboardingState {
  const hasExistingData = existsSync(config.databasePath);
  const hasVaultFiles = existsSync(path.join(config.vocabDir, "english-words.md"));
  const hasOnboardingComplete = existsSync(path.join(path.dirname(config.databasePath), ONBOARDING_COMPLETE_FILE));

  if (hasOnboardingComplete && hasExistingData) {
    return {
      step: "complete",
      hasExistingData: true,
      completedSteps: ["setup", "import", "first-lesson"],
    };
  }

  const completedSteps: string[] = [];
  if (hasVaultFiles) completedSteps.push("setup");
  if (hasExistingData) completedSteps.push("import");

  // 根据完成进度返回相应步骤
  if (!hasVaultFiles) {
    return { step: "setup", hasExistingData, completedSteps };
  } else if (!hasExistingData) {
    return { step: "import", hasExistingData: false, completedSteps };
  } else {
    return { step: "first-lesson", hasExistingData: true, completedSteps };
  }
}

export async function createDefaultVaultStructure(config: AppConfig): Promise<void> {
  // 确保父目录存在
  await mkdir(config.vocabDir, { recursive: true });
  await mkdir(path.join(config.vocabDir, "study", "reports"), { recursive: true });

  // 创建示例词库文件
  const samplePath = path.join(config.vocabDir, "english-words.md");
  if (!existsSync(samplePath)) {
    const sampleContent = `# English Vocabulary

| Word | Meaning | Phonetic |
| :--- | :--- | :--- |
| study<br>学习<br>ˈstʌdi | The activity of learning or gaining knowledge | ˈstʌdi |
| practice<br>练习<br>ˈpræktɪs | Repeated exercise in an activity or skill to acquire proficiency | ˈpræktɪs |
| improve<br>改进<br>ɪmˈpruːv | To become better or make something better | ɪmˈpruːv |
| learn<br>学习<br>lɜːrn | To gain knowledge or skill through study, experience, or teaching | lɜːrn |
`;
    const { writeFile: fsWriteFile } = await import("node:fs/promises");
    await fsWriteFile(samplePath, sampleContent, "utf-8");
  }
}

export async function markOnboardingComplete(config: AppConfig): Promise<void> {
  const { writeFile: fsWriteFile } = await import("node:fs/promises");
  const completeMarker = path.join(path.dirname(config.databasePath), ONBOARDING_COMPLETE_FILE);
  await fsWriteFile(completeMarker, new Date().toISOString(), "utf-8");
}

export function getDefaultVaultPath(): string {
  return "~/Documents/EnPlay/vault";
}

export function getRecommendedPaths(): { vocabDir: string; databasePath: string } {
  const dataDir = path.join(os.homedir(), "Library", "Application Support", "En Play");
  return {
    vocabDir: path.join(dataDir, "vault"),
    databasePath: path.join(dataDir, "en-play.sqlite3"),
  };
}
