import type { SourceEntry, VocabFormat } from "@enpet/core";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type ImportPreview as Preview } from "./api";

interface ImportPreviewProps {
  onImported: (inserted: number, updated: number) => void;
  onCancel: () => void;
}

const SEPARATORS = [
  { value: "<br>", label: "<br>（换行标签）" },
  { value: "/", label: "/（斜杠）" },
  { value: "-", label: "-（连字符）" },
  { value: "|", label: "|（竖线）" },
];

/**
 * 导入预览：先解析不写库，用户在这里调格式、改词条，确认后才真正导入。
 * 调格式改的是描述符，不是解析代码；改词条存成覆盖层，不回写原始 Markdown。
 */
export function ImportPreview({ onImported, onCancel }: ImportPreviewProps) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [format, setFormat] = useState<VocabFormat | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<SourceEntry>>>({});

  const load = useCallback(async (next?: VocabFormat) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.previewImport(next);
      setPreview(result);
      setFormat(result.format);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "解析失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeFormat = (patch: Partial<VocabFormat>) => {
    if (!format) return;
    const next = { ...format, ...patch };
    setFormat(next);
    void load(next);
  };

  const handleImport = async () => {
    if (!format) return;
    setImporting(true);
    setError(null);
    try {
      const summary = await api.importVocabulary(format);
      // 词条修改必须在导入之后写，否则会被这次导入的文件内容盖掉
      for (const [id, fields] of Object.entries(edits)) {
        await api.updateEntry(id, fields);
      }
      onImported(summary.inserted, summary.updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const editValue = (entry: SourceEntry, field: "word" | "meaning" | "phonetic") =>
    edits[entry.id]?.[field] ?? entry[field];

  const setEdit = (entry: SourceEntry, field: "word" | "meaning" | "phonetic", value: string) => {
    setEdits((current) => ({ ...current, [entry.id]: { ...current[entry.id], [field]: value } }));
  };

  return (
    <div className="panel-container">
      <div className="panel-card preview-card">
        <div className="panel-header">
          <h1>导入预览</h1>
          <p>确认解析结果无误后再写入数据库。原始 Markdown 不会被修改。</p>
        </div>

        <div className="panel-content">
          {loading ? (
            <p className="preview-status">
              <LoaderCircle className="spin" aria-hidden="true" /> 正在解析…
            </p>
          ) : null}

          {error ? (
            <div className="error-banner" role="alert">
              <span>{error}</span>
            </div>
          ) : null}

          {preview && format ? (
            <>
              <p className="preview-status">
                在 <code>{preview.vocabDir}</code> 找到 <strong>{preview.files}</strong> 个文件，
                识别出 <strong>{preview.total}</strong> 个词条
                {preview.total > preview.entries.length
                  ? `（下面显示前 ${preview.entries.length} 条）`
                  : ""}
              </p>

              <div className="format-controls">
                <label>
                  <span>词条排列</span>
                  <select
                    value={format.layout}
                    onChange={(e) =>
                      changeFormat({ layout: e.target.value as VocabFormat["layout"] })
                    }
                  >
                    <option value="cell">每个单元格一个词条</option>
                    <option value="column">每行一个词条，字段分列</option>
                  </select>
                </label>

                {format.layout === "cell" ? (
                  <>
                    <label>
                      <span>字段分隔符</span>
                      <select
                        value={format.separator}
                        onChange={(e) => changeFormat({ separator: e.target.value })}
                      >
                        {SEPARATORS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>字段顺序</span>
                      <select
                        value={format.fieldOrder.join(",")}
                        onChange={(e) =>
                          changeFormat({
                            fieldOrder: e.target.value.split(",") as VocabFormat["fieldOrder"],
                          })
                        }
                      >
                        <option value="word,meaning,phonetic">单词 → 释义 → 音标</option>
                        <option value="word,phonetic,meaning">单词 → 音标 → 释义</option>
                        <option value="meaning,word,phonetic">释义 → 单词 → 音标</option>
                      </select>
                    </label>
                  </>
                ) : (
                  (["word", "meaning", "phonetic"] as const).map((field) => (
                    <label key={field}>
                      <span>
                        {{ word: "单词", meaning: "释义", phonetic: "音标" }[field]}在第几列
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={format.columns[field]}
                        onChange={(e) =>
                          changeFormat({
                            columns: { ...format.columns, [field]: Number(e.target.value) },
                          })
                        }
                      />
                    </label>
                  ))
                )}
              </div>

              {preview.issues.length > 0 ? (
                <div className="info-banner">
                  <TriangleAlert aria-hidden="true" />
                  <p>
                    有 {preview.issues.length} 处解析警告，第一条：{preview.issues[0]?.message}
                  </p>
                </div>
              ) : null}

              {preview.total === 0 ? (
                <div className="info-banner">
                  <TriangleAlert aria-hidden="true" />
                  <p>当前格式下没有识别出任何词条，调整上面的选项再看看。</p>
                </div>
              ) : (
                <div className="preview-table-wrap">
                  <table className="preview-table">
                    <thead>
                      <tr>
                        <th>单词</th>
                        <th>释义</th>
                        <th>音标</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.entries.map((entry) => (
                        <tr key={entry.id}>
                          {(["word", "meaning", "phonetic"] as const).map((field) => (
                            <td key={field}>
                              <input
                                value={editValue(entry, field)}
                                onChange={(e) => setEdit(entry, field, e.target.value)}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </div>

        <div className="panel-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onCancel}
            disabled={importing}
          >
            取消
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleImport}
            disabled={importing || loading || !preview || preview.total === 0}
          >
            {importing ? "导入中…" : `确认导入 ${preview?.total ?? 0} 个词条`}
          </button>
        </div>
      </div>
    </div>
  );
}
