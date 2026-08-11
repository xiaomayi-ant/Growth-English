import { CheckCircle2, Database, FolderOpen, Save, X } from "lucide-react";
import { useState } from "react";
import { api } from "./api";

interface Settings {
  vocabDir: string;
  newWordsPerDay: number;
  reviewLimit: number;
  reminderTime: string;
}

interface SettingsProps {
  onClose: () => void;
}

export function Settings({ onClose }: SettingsProps) {
  const [settings, setSettings] = useState<Settings>({
    vocabDir: "",
    newWordsPerDay: 6,
    reviewLimit: 30,
    reminderTime: "09:00",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useState(() => {
    // 加载当前设置
    api.health()
      .then(() => {
        setSettings({
          vocabDir: "",
          newWordsPerDay: 6,
          reviewLimit: 30,
          reminderTime: "09:00",
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  });

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      // 这里需要实现设置保存的API调用
      await new Promise((resolve) => setTimeout(resolve, 1000)); // 模拟API调用
      setSuccess(true);
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存设置失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-overlay">
        <div className="settings-card">
          <div className="loading-state">
            <span>加载设置中...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-overlay">
      <div className="settings-card">
        <div className="settings-header">
          <h2>设置</h2>
          <button type="button" className="icon-button" onClick={onClose} title="关闭">
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="settings-content">
          {success ? (
            <div className="success-banner">
              <CheckCircle2 aria-hidden="true" />
              <span>设置已保存</span>
            </div>
          ) : null}

          {error ? (
            <div className="error-banner" role="alert">
              <span>{error}</span>
            </div>
          ) : null}

          <section className="settings-section">
            <h3>词库设置</h3>
            <div className="setting-item">
              <label>
                <FolderOpen aria-hidden="true" />
                <span>词库目录</span>
              </label>
              <input
                type="text"
                value={settings.vocabDir}
                readOnly
                placeholder="~/Library/Application Support/EnPet/vault"
              />
            </div>
          </section>

          <section className="settings-section">
            <h3>学习参数</h3>
            <div className="setting-item">
              <label>
                <Database aria-hidden="true" />
                <span>每日新词数量</span>
              </label>
              <input
                type="number"
                min="1"
                max="20"
                value={settings.newWordsPerDay}
                onChange={(e) => setSettings({ ...settings, newWordsPerDay: Number(e.target.value) })}
              />
            </div>

            <div className="setting-item">
              <label>
                <span>每日复习上限</span>
              </label>
              <input
                type="number"
                min="1"
                max="200"
                value={settings.reviewLimit}
                onChange={(e) => setSettings({ ...settings, reviewLimit: Number(e.target.value) })}
              />
            </div>

            <div className="setting-item">
              <label>
                <span>提醒时间</span>
              </label>
              <input
                type="time"
                value={settings.reminderTime}
                onChange={(e) => setSettings({ ...settings, reminderTime: e.target.value })}
              />
            </div>
          </section>
        </div>

        <div className="settings-footer">
          <button type="button" className="secondary-button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <>
                <span>保存中...</span>
              </>
            ) : (
              <>
                <Save aria-hidden="true" />
                保存设置
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
