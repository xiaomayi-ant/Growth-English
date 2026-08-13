import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  const hasVaultFiles = existsSync(path.join(config.vocabDir, `${config.vocabFilePrefix}.md`));
  const hasOnboardingComplete = existsSync(
    path.join(path.dirname(config.databasePath), ONBOARDING_COMPLETE_FILE),
  );

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

// 一词一行的三列表：在 Obsidian 里就是一张普通表格，扫读、排序、搜索都自然。
// 旧的 `单词<br>释义<br>音标` 堆叠格式仍然能被导入器探测并解析，只是不再作为新建词库的样子。
const SAMPLE_ROWS = `| study | /ˈstʌdi/ | 学习 |
| practice | /ˈpræktɪs/ | 练习 |
| improve | /ɪmˈpruːv/ | 改进 |
| learn | /lɜːrn/ | 学习 |
| review | /rɪˈvjuː/ | 复习 |
| remember | /rɪˈmembər/ | 记住 |
`;

/**
 * Obsidian 的 vault 就是一个含 `.obsidian/` 的普通文件夹，没有别的要求。
 * 词库目录建好就顺手补上这个目录，用 Obsidian 直接打开即可，不需要用户额外操作。
 * 已经是 vault 的目录（用户填的是自己的 Obsidian 库）不动它的配置。
 */
export async function ensureObsidianVault(vaultDir: string): Promise<void> {
  const configDir = path.join(vaultDir, ".obsidian");
  if (existsSync(configDir)) return;

  const { writeFile: fsWriteFile } = await import("node:fs/promises");
  await mkdir(configDir, { recursive: true });
  // 只写最小配置：附件放 study 之外，其余全部交给 Obsidian 自己补全
  await fsWriteFile(
    path.join(configDir, "app.json"),
    `${JSON.stringify({ attachmentFolderPath: "attachments" }, null, 2)}\n`,
    "utf-8",
  );
}

/** 让 Obsidian 打开该目录的深链；Obsidian 首次打开时会自动把它登记进库列表 */
export function obsidianVaultLink(vaultDir: string): string {
  return `obsidian://open?path=${encodeURIComponent(vaultDir)}`;
}

// withSample=false 时只写表头，用户得到一个格式正确的空白词库
export async function createDefaultVaultStructure(
  config: AppConfig,
  withSample = true,
): Promise<void> {
  // 确保父目录存在
  await mkdir(config.vocabDir, { recursive: true });
  await mkdir(path.join(config.vocabDir, "study", "reports"), { recursive: true });
  await ensureObsidianVault(config.vocabDir);

  const samplePath = path.join(config.vocabDir, `${config.vocabFilePrefix}.md`);
  if (!existsSync(samplePath)) {
    // 表头同时是给人看的说明和给导入器探测格式的依据，空白词库也要保留
    const content = `# 英语词库

一行一个词条。音标和释义留空也能导入。

| 单词 | 音标 | 释义 |
| :--- | :--- | :--- |
${withSample ? SAMPLE_ROWS : ""}`;
    const { writeFile: fsWriteFile } = await import("node:fs/promises");
    await fsWriteFile(samplePath, content, "utf-8");
  }
}

export async function markOnboardingComplete(config: AppConfig): Promise<void> {
  const { writeFile: fsWriteFile } = await import("node:fs/promises");
  const completeMarker = path.join(path.dirname(config.databasePath), ONBOARDING_COMPLETE_FILE);
  await fsWriteFile(completeMarker, new Date().toISOString(), "utf-8");
}

export function getDefaultVaultPath(): string {
  return "~/Documents/EnPet/vault";
}

export function getRecommendedPaths(): { vocabDir: string; databasePath: string } {
  const dataDir = path.join(os.homedir(), "Library", "Application Support", "EnPet");
  return {
    vocabDir: path.join(dataDir, "vault"),
    databasePath: path.join(dataDir, "enpet.sqlite3"),
  };
}
