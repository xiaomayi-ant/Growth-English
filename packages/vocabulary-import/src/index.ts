import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ImportIssue, SourceEntry } from "@enpet/core";

const BREAK_PATTERN = /<br\s*\/?>/i;

export const DEFAULT_FILE_PREFIX = "english-words";

// 前缀可自定义，序号后缀（-002）仍然决定 fileIndex 和学习顺序
function filePattern(prefix: string): RegExp {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}(?:-(\\d{3}))?\\.md$`);
}

export type VocabImportErrorCode = "VOCAB_DIR_NOT_FOUND";

export class VocabImportError extends Error {
  readonly code: VocabImportErrorCode;
  readonly suggestions: string[];

  constructor(code: VocabImportErrorCode, message: string, suggestions: string[] = []) {
    super(message);
    this.name = "VocabImportError";
    this.code = code;
    this.suggestions = suggestions;
  }
}

export interface ParsedVocabulary {
  entries: SourceEntry[];
  issues: ImportIssue[];
  files: number;
}

interface VocabularyFile {
  fileIndex: number;
  sourcePath: string;
}

function splitTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;

  for (const character of trimmed) {
    if (character === "\\" && !escaped) {
      escaped = true;
      current += character;
      continue;
    }
    if (character === "|" && !escaped) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += character;
    escaped = false;
  }
  cells.push(current.trim());
  return cells;
}

function parseCell(cell: string): Pick<SourceEntry, "word" | "meaning" | "phonetic"> | null {
  if (!cell.trim()) return null;
  const parts = cell
    .replaceAll("\\|", "|")
    .split(BREAK_PATTERN)
    .map((part) => part.trim())
    .filter(Boolean);
  const word = parts[0];
  if (!word) return null;
  return {
    word,
    meaning: parts[1] ?? "",
    phonetic: parts.slice(2).join(" / ") || "-",
  };
}

function isHeader(cells: string[]): boolean {
  return (
    cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell)) ||
    cells.every((cell) => /^\d+$/.test(cell.trim()))
  );
}

export function parseVocabularyMarkdown(
  sourcePath: string,
  fileIndex: number,
  content: string,
): ParsedVocabulary {
  const entries: SourceEntry[] = [];
  const issues: ImportIssue[] = [];
  let rowIndex = 0;

  for (const [lineOffset, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim().startsWith("|")) continue;
    const cells = splitTableCells(line);
    if (isHeader(cells)) continue;
    rowIndex += 1;

    for (const [columnOffset, cell] of cells.entries()) {
      const parsed = parseCell(cell);
      if (!parsed) continue;
      if (!cell.match(BREAK_PATTERN)) {
        issues.push({
          sourcePath,
          lineNumber: lineOffset + 1,
          message: `Cell ${columnOffset + 1} does not contain <br> separators`,
        });
      }
      const columnIndex = columnOffset + 1;
      entries.push({
        id: `f${String(fileIndex).padStart(3, "0")}-r${String(rowIndex).padStart(3, "0")}-c${String(columnIndex).padStart(2, "0")}`,
        fileIndex,
        rowIndex,
        columnIndex,
        sourcePath,
        ...parsed,
        sourceOrder: fileIndex * 100_000 + rowIndex * 10 + columnIndex,
      });
    }
  }

  return { entries, issues, files: 1 };
}

export async function discoverVocabularyFiles(
  directory: string,
  prefix: string = DEFAULT_FILE_PREFIX,
): Promise<VocabularyFile[]> {
  const pattern = filePattern(prefix);
  const names = await readdir(directory);
  return names
    .flatMap((name) => {
      const match = pattern.exec(name);
      if (!match) return [];
      return [
        {
          fileIndex: match[1] ? Number(match[1]) : 1,
          sourcePath: path.join(directory, name),
        },
      ];
    })
    .sort((left, right) => left.fileIndex - right.fileIndex);
}

export async function loadVocabulary(
  directory: string,
  prefix: string = DEFAULT_FILE_PREFIX,
): Promise<ParsedVocabulary> {
  let files: VocabularyFile[];
  try {
    files = await discoverVocabularyFiles(directory, prefix);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new VocabImportError("VOCAB_DIR_NOT_FOUND", `词库目录不存在或不是目录: ${directory}`, [
        "请检查路径设置是否正确",
        "确保目录已创建并且有访问权限",
        "您可以在设置中修改词库路径",
        "首次使用请运行首次设置向导",
      ]);
    }
    throw cause;
  }
  // 空目录是首次使用的正常状态，不是错误；调用方看 files === 0 自行决定怎么提示
  if (files.length === 0) {
    return { entries: [], issues: [], files: 0 };
  }
  const parsed = await Promise.all(
    files.map(async (file) =>
      parseVocabularyMarkdown(
        file.sourcePath,
        file.fileIndex,
        await readFile(file.sourcePath, "utf8"),
      ),
    ),
  );
  return {
    files: files.length,
    entries: parsed
      .flatMap((result) => result.entries)
      .sort((a, b) => a.sourceOrder - b.sourceOrder),
    issues: parsed.flatMap((result) => result.issues),
  };
}
