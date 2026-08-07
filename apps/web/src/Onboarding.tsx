import { CheckCircle2, Download, FolderOpen, Hammer } from "lucide-react";
import { useState } from "react";
import { api } from "./api";

interface OnboardingProps {
  onComplete: () => void;
}

type OnboardingStep = "welcome" | "vault-setup" | "complete";

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSetupVault = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.setupVault();
      setStep("complete");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "设置词库目录失败");
    } finally {
      setLoading(false);
    }
  };

  if (step === "welcome") {
    return (
      <div className="onboarding-container">
        <div className="onboarding-card">
          <div className="onboarding-header">
            <h1>欢迎使用 En Play</h1>
            <p>让我们快速设置您的词汇学习环境</p>
          </div>

          <div className="onboarding-content">
            <section className="onboarding-section">
              <div className="step-icon">
                <FolderOpen aria-hidden="true" />
              </div>
              <h3>1. 设置词库目录</h3>
              <p>创建本地词库存储，用于保存您的英语词汇和Markdown文件</p>
            </section>

            <section className="onboarding-section">
              <div className="step-icon">
                <Hammer aria-hidden="true" />
              </div>
              <h3>2. 配置 Hammerspoon (可选)</h3>
              <p>设置自动词汇收集功能，通过快捷键保存遇到的新单词</p>
            </section>

            <section className="onboarding-section">
              <div className="step-icon">
                <CheckCircle2 aria-hidden="true" />
              </div>
              <h3>3. 开始学习</h3>
              <p>使用间隔重复算法进行有效的词汇学习和复习</p>
            </section>
          </div>

          <div className="onboarding-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => setStep("vault-setup")}
            >
              开始设置
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "vault-setup") {
    return (
      <div className="onboarding-container">
        <div className="onboarding-card">
          <div className="onboarding-header">
            <h1>设置词库目录</h1>
            <p>我们将创建一个示例词库文件来帮助您开始使用</p>
          </div>

          <div className="onboarding-content">
            <div className="setup-info">
              <h4>将要创建的内容：</h4>
              <ul>
                <li>词库目录：~/Library/Application Support/En Play/vault/</li>
                <li>示例文件：english-words.md (包含2个示例词汇)</li>
                <li>学习报告目录：vault/study/reports/</li>
              </ul>
            </div>

            {error ? (
              <div className="error-banner" role="alert">
                <span>{error}</span>
              </div>
            ) : null}
          </div>

          <div className="onboarding-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setStep("welcome")}
              disabled={loading}
            >
              返回
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={handleSetupVault}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span>创建中...</span>
                </>
              ) : (
                <>
                  <Download aria-hidden="true" />
                  创建词库目录
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "complete") {
    return (
      <div className="onboarding-container">
        <div className="onboarding-card">
          <div className="onboarding-header">
            <div className="success-icon">
              <CheckCircle2 aria-hidden="true" />
            </div>
            <h1>设置完成！</h1>
            <p>您的词库目录已准备就绪</p>
          </div>

          <div className="onboarding-content">
            <div className="success-info">
              <h4>接下来您可以：</h4>
              <ul>
                <li>点击"同步词库"导入示例词汇</li>
                <li>开始创建您的第一个学习任务</li>
                <li>（可选）配置 Hammerspoon 实现自动收词</li>
              </ul>
            </div>
          </div>

          <div className="onboarding-actions">
            <button
              type="button"
              className="primary-button"
              onClick={onComplete}
            >
              开始使用 En Play
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
