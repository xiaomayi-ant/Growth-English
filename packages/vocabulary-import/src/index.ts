import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_VOCAB_FORMAT,
  type ImportIssue,
  type SourceEntry,
  type VocabFormat,
  type VocabFormatInput,
} from "@enpet/core";

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
  /** 实际使用的格式；未显式指定时是探测结果，供预览界面回显 */
  format?: VocabFormat;
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

type Field = "word" | "meaning" | "phonetic";
type ParsedFields = Pick<SourceEntry, Field>;

/**
 * 格式描述符定义在 core（同时被 zod 校验和设置文件复用）。
 * - cell：一个单元格里放一个词条，字段用 separator 分隔（默认 <br>，Hammerspoon 收词的格式）
 * - column：一行是一个词条，每个字段各占一列，由 columns 指定列号（从 1 开始，0 表示无此字段）
 */
export function normalizeFormat(format?: VocabFormatInput): VocabFormat {
  return {
    layout: format?.layout ?? DEFAULT_VOCAB_FORMAT.layout,
    separator: format?.separator || DEFAULT_VOCAB_FORMAT.separator,
    fieldOrder:
      format?.fieldOrder && format.fieldOrder.length > 0
        ? format.fieldOrder
        : DEFAULT_VOCAB_FORMAT.fieldOrder,
    columns: { ...DEFAULT_VOCAB_FORMAT.columns, ...format?.columns },
  };
}

function splitFields(text: string, separator: string): string[] {
  // <br> 要容忍 <br/> 和 <br />，其它分隔符按字面量切
  const pattern =
    separator === "<br>"
      ? BREAK_PATTERN
      : new RegExp(separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return text
    .split(pattern)
    .map((part) => part.trim())
    .filter(Boolean);
}

function fieldsFromParts(parts: string[], order: Field[]): ParsedFields | null {
  const word = parts[order.indexOf("word")];
  if (!word) return null;
  const meaningIndex = order.indexOf("meaning");
  const phoneticIndex = order.indexOf("phonetic");
  return {
    word,
    meaning: (meaningIndex >= 0 ? parts[meaningIndex] : "") ?? "",
    phonetic: (phoneticIndex >= 0 ? parts[phoneticIndex] : "") || "-",
  };
}

function parseCell(cell: string, format: VocabFormat): ParsedFields | null {
  if (!cell.trim()) return null;
  const parts = splitFields(cell.replaceAll("\\|", "|"), format.separator);
  return fieldsFromParts(parts, format.fieldOrder);
}

// 探测：任一单元格含分隔符就是 cell 布局；否则若表头出现 meaning/释义 一类词就是 column 布局
export function detectFormat(content: string): VocabFormat {
  const rows = content
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("|"))
    .map(splitTableCells);

  for (const cells of rows) {
    if (cells.some((cell) => BREAK_PATTERN.test(cell))) return { ...DEFAULT_VOCAB_FORMAT };
  }

  const header = rows.find((cells) => !isHeader(cells));
  if (header && header.length >= 2) {
    const find = (patterns: RegExp[]) =>
      header.findIndex((cell) => patterns.some((pattern) => pattern.test(cell))) + 1;
    const word = find([/\bword\b/i, /单词/, /词条/]);
    const meaning = find([/\bmeaning\b/i, /释义/, /中文/, /翻译/]);
    const phonetic = find([/\bphonetic\b/i, /音标/, /发音/]);
    if (word > 0 && meaning > 0) {
      return {
        layout: "column",
        separator: DEFAULT_VOCAB_FORMAT.separator,
        fieldOrder: DEFAULT_VOCAB_FORMAT.fieldOrder,
        columns: { word, meaning, phonetic: phonetic > 0 ? phonetic : 0 },
      };
    }
  }
  return { ...DEFAULT_VOCAB_FORMAT };
}

function isHeader(cells: string[]): boolean {
  return (
    cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell)) ||
    cells.every((cell) => /^\d+$/.test(cell.trim()))
  );
}

function entryId(fileIndex: number, rowIndex: number, columnIndex: number): string {
  return `f${String(fileIndex).padStart(3, "0")}-r${String(rowIndex).padStart(3, "0")}-c${String(columnIndex).padStart(2, "0")}`;
}

export function parseVocabularyMarkdown(
  sourcePath: string,
  fileIndex: number,
  content: string,
  formatInput?: VocabFormatInput,
): ParsedVocabulary {
  const format = normalizeFormat(formatInput);
  const entries: SourceEntry[] = [];
  const issues: ImportIssue[] = [];
  let rowIndex = 0;

  for (const [lineOffset, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim().startsWith("|")) continue;
    const cells = splitTableCells(line);
    if (isHeader(cells)) continue;
    rowIndex += 1;

    if (format.layout === "column") {
      // 一行一个词条，字段各占一列；列号为 0 表示该字段在这份词库里不存在
      const pick = (field: Field) => {
        const column = format.columns[field];
        return column > 0 ? (cells[column - 1] ?? "").replaceAll("\\|", "|").trim() : "";
      };
      const word = pick("word");
      if (!word) continue;
      // 表头行（Word | Meaning | Phonetic）会被当成词条，这里跳过
      if (/^word$|^单词$|^词条$/i.test(word)) continue;
      entries.push({
        id: entryId(fileIndex, rowIndex, format.columns.word),
        fileIndex,
        rowIndex,
        columnIndex: format.columns.word,
        sourcePath,
        word,
        meaning: pick("meaning"),
        phonetic: pick("phonetic") || "-",
        sourceOrder: fileIndex * 100_000 + rowIndex * 10 + format.columns.word,
      });
      continue;
    }

    for (const [columnOffset, cell] of cells.entries()) {
      const parsed = parseCell(cell, format);
      if (!parsed) continue;
      const hasSeparator =
        format.separator === "<br>" ? BREAK_PATTERN.test(cell) : cell.includes(format.separator);
      if (!hasSeparator) {
        issues.push({
          sourcePath,
          lineNumber: lineOffset + 1,
          message: `Cell ${columnOffset + 1} does not contain ${format.separator} separators`,
        });
      }
      const columnIndex = columnOffset + 1;
      entries.push({
        id: entryId(fileIndex, rowIndex, columnIndex),
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
  formatInput?: VocabFormatInput,
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
    return { entries: [], issues: [], files: 0, format: normalizeFormat(formatInput) };
  }
  const contents = await Promise.all(
    files.map(async (file) => ({ file, text: await readFile(file.sourcePath, "utf8") })),
  );
  // 没有显式指定格式时，用第一个文件探测一次，同一次导入的所有文件用同一份格式
  const first = contents[0];
  const format = formatInput || !first ? normalizeFormat(formatInput) : detectFormat(first.text);
  const parsed = await Promise.all(
    contents.map(async ({ file, text }) =>
      parseVocabularyMarkdown(file.sourcePath, file.fileIndex, text, format),
    ),
  );
  return {
    files: files.length,
    entries: parsed
      .flatMap((result) => result.entries)
      .sort((a, b) => a.sourceOrder - b.sourceOrder),
    issues: parsed.flatMap((result) => result.issues),
    format,
  };
}
