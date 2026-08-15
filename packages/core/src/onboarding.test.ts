import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppConfig, loadConfig } from "./config.js";
import { detectOnboardingState, markOnboardingComplete } from "./onboarding.js";

let dataDir: string;
let config: AppConfig;

// 引导状态完全由磁盘上几个文件的存在与否决定，所以每个用例都在自己的临时
// 目录里摆好文件再断言，绝不碰本机真实的 Application Support 目录。
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "enpet-onboarding-"));
  config = loadConfig({
    ENPET_DATABASE_PATH: path.join(dataDir, "enpet.sqlite3"),
    ENPET_VOCAB_DIR: path.join(dataDir, "vault"),
  });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

async function createDatabase(): Promise<void> {
  await writeFile(config.databasePath, "", "utf8");
}

async function createVocabFile(): Promise<void> {
  await mkdir(config.vocabDir, { recursive: true });
  await writeFile(path.join(config.vocabDir, `${config.vocabFilePrefix}.md`), "# 词库\n", "utf8");
}

describe("detectOnboardingState", () => {
  it("starts at setup when nothing exists yet", () => {
    const state = detectOnboardingState(config);
    expect(state.step).toBe("setup");
    expect(state.hasExistingData).toBe(false);
    expect(state.completedSteps).toEqual([]);
  });

  it("moves to import once the vocabulary file exists but the database does not", async () => {
    await createVocabFile();
    const state = detectOnboardingState(config);
    expect(state.step).toBe("import");
    expect(state.hasExistingData).toBe(false);
    expect(state.completedSteps).toEqual(["setup"]);
  });

  it("reports complete only once the marker and the database are both present", async () => {
    await createVocabFile();
    await createDatabase();
    await markOnboardingComplete(config);
    expect(detectOnboardingState(config).step).toBe("complete");
  });

  // 这条是「删掉标记文件就能重看引导」这个直觉的反例：数据还在时删标记只会
  // 退到 first-lesson，重跑完整引导必须让数据库和词库文件一起消失。
  it("falls back to first-lesson, not setup, when only the marker is removed", async () => {
    await createVocabFile();
    await createDatabase();
    await markOnboardingComplete(config);
    await rm(path.join(dataDir, ".onboarding-complete"));

    const state = detectOnboardingState(config);
    expect(state.step).toBe("first-lesson");
    expect(state.hasExistingData).toBe(true);
    expect(state.completedSteps).toEqual(["setup", "import"]);
  });

  // 标记文件单独存在不足以跳过引导，否则数据库丢失的用户会进到一个空主界面。
  it("ignores a stale marker when the database is gone", async () => {
    await createVocabFile();
    await createDatabase();
    await markOnboardingComplete(config);
    await rm(config.databasePath);

    expect(detectOnboardingState(config).step).toBe("import");
  });

  // 词库文件名可配置，探测必须跟着配置走而不是认死 english-words.md
  it("looks for the vocabulary file under the configured prefix", async () => {
    const custom = loadConfig({
      ENPET_DATABASE_PATH: path.join(dataDir, "enpet.sqlite3"),
      ENPET_VOCAB_DIR: path.join(dataDir, "vault"),
      ENPET_VOCAB_FILE_PREFIX: "my-words",
    });
    await mkdir(custom.vocabDir, { recursive: true });
    await writeFile(path.join(custom.vocabDir, "english-words.md"), "# 词库\n", "utf8");

    // 默认名字的文件存在也不算数，配置指定的那个才算
    expect(detectOnboardingState(custom).step).toBe("setup");

    await writeFile(path.join(custom.vocabDir, "my-words.md"), "# 词库\n", "utf8");
    expect(detectOnboardingState(custom).step).toBe("import");
  });
});
