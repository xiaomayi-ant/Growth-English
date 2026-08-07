import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { AppConfig, EditableSettings } from "./config.js";

export interface OnboardingState {
  step: "welcome" | "vault-config" | "hammerspoon-setup" | "complete";
  vocabDirConfigured: boolean;
  hammerspoonDetected: boolean;
}

export function detectOnboardingState(config: AppConfig): OnboardingState {
  const hasVaultFiles = existsSync(path.join(config.vocabDir, "english-words.md")) ||
                       existsSync(path.join(config.vocabDir, "english-words-001.md"));
  const hammerspoonPath = path.join(os.homedir(), ".hammerspoon");
  const hasHammerspoon = existsSync(path.join(hammerspoonPath, "init.lua"));

  let step: OnboardingState["step"] = "welcome";
  if (!hasVaultFiles) {
    step = "vault-config";
  } else if (!hasHammerspoon) {
    step = "hammerspoon-setup";
  } else {
    step = "complete";
  }

  return {
    step,
    vocabDirConfigured: hasVaultFiles,
    hammerspoonDetected: hasHammerspoon,
  };
}

export async function createDefaultVaultStructure(config: AppConfig): Promise<void> {
  await mkdir(config.vocabDir, { recursive: true });
  await mkdir(path.join(config.vocabDir, "study", "reports"), { recursive: true });

  // 创建示例词库文件
  const samplePath = path.join(config.vocabDir, "english-words.md");
  if (!existsSync(samplePath)) {
    const sampleContent = `# English Vocabulary

| Word | Meaning | Phonetic |
| :--- | :--- | :--- |
| hello<br>你好<br>həˈloʊ | Used as a greeting or to begin a telephone conversation | həˈloʊ |
| world<br>世界<br>wɜːrld | The earth and all the people and things on it | wɜːrld |
`;
    await mkdir(path.dirname(samplePath), { recursive: true });
    const { writeFile: fsWriteFile } = await import("node:fs/promises");
    await fsWriteFile(samplePath, sampleContent, "utf-8");
  }
}

export function getHammerspoonScriptContent(vaultPath: string): string {
  return `-- En Play vocabulary collection script
-- This script monitors clipboard for English words and saves them to your vault

local en_play_vocab = "${vaultPath.replace(/\\/g, "\\\\")}"

-- Function to check if clipboard content is an English word
local function isEnglishWord(text)
  -- Check if text is primarily English characters (a-z, A-Z, spaces, hyphens)
  return string.match(text, "^[a-zA-Z][a-zA-Z%s%-]*[a-zA-Z]$") ~= nil
end

-- Function to append word to vocabulary file
local function appendWordToFile(word)
  local file = io.open(en_play_vocab .. "/english-words.md", "a")
  if file then
    local timestamp = os.date("%Y-%m-%d %H:%M")
    file:write("| " .. word .. "<br>翻译待填<br>音标待填 |\\n")
    file:close()
    print("En Play: Added word - " .. word)
  end
end

-- Monitor clipboard changes
local lastClipboard = ""

hs.hotkey.bind({"cmd", "shift"}, "w", function()
  local current = hs.pasteboard.getContents()
  if current and current ~= "" and current ~= lastClipboard then
    if isEnglishWord(current) then
      appendWordToFile(current)
      lastClipboard = current
      hs.alert.show("En Play: Word added - " .. current)
    else
      hs.alert.show("En Play: Not an English word")
    end
  end
end)

print("En Play vocabulary collector loaded")
print("Press Cmd+Shift+W to add the current clipboard word to your vocabulary")
`;
}
