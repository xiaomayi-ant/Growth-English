import { CheckCircle2, Download, FolderOpen, Info, BookOpen, Play } from "lucide-react";
import { useState, useEffect } from "react";
import { api } from "./api";

interface OnboardingProps {
  onComplete: () => void;
}

type OnboardingStep = "welcome" | "setup" | "import" | "first-lesson" | "complete";

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vaultPath, setVaultPath] = useState("~/Documents/EnPet/vault");
  const [hasExistingData, setHasExistingData] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);

  // 加载当前的onboarding状态
  useEffect(() => {
    api.onboarding().then(state => {
      setHasExistingData(state.hasExistingData);
      setCompletedSteps(state.completedSteps || []);

      // 根据API返回的状态设置当前步骤
      if (state.step !== "welcome" && state.step !== "complete") {
        setStep(state.step);
      }
    }).catch(() => {
      console.log("无法获取onboarding状态");
    });
  }, []);

  const handleSetup = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.setupVault(vaultPath);
      setCompletedSteps([...completedSteps, "setup"]);
      setStep("import");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "设置失败");
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.importVocabulary();
      setCompletedSteps([...completedSteps, "import"]);
      setStep("first-lesson");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导入失败");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFirstLesson = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.createNewSession();
      setCompletedSteps([...completedSteps, "first-lesson"]);
      setStep("complete");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建任务失败");
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      await fetch("/api/onboarding/complete", { method: "POST" });
      onComplete();
    } catch (cause) {
      console.error("标记完成失败:", cause);
      onComplete();
    } finally {
      setLoading(false);
    }
  };

  const StepIndicator = ({ currentStep }: { currentStep: OnboardingStep }) => {
    const steps = [
      { key: "setup", label: "设置", icon: FolderOpen },
      { key: "import", label: "导入", icon: Download },
      { key: "first-lesson", label: "学习", icon: BookOpen },
      { key: "complete", label: "完成", icon: CheckCircle2 },
    ] as const;

    const currentIndex = steps.findIndex(s => s.key === currentStep);

    return (
      <div className="step-indicator">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;

          return (
            <div key={step.key} className={`step ${isCompleted ? "completed" : ""} ${isCurrent ? "current" : ""}`}>
              <div className="step-number">
                {isCompleted ? "✓" : index + 1}
              </div>
              <Icon className="step-icon" aria-hidden="true" />
              <span>{step.label}</span>
            </div>
          );
        })}
      </div>
    );
  };

  if (step === "welcome") {
    return (
      <div className="onboarding-container">
        <div className="onboarding-card">
          <div className="onboarding-header">
            <h1>欢迎使用 EnPet</h1>
            <p>让我们用几个简单步骤开始您的英语学习之旅</p>
          </div>

          <div className="onboarding-content">
            {hasExistingData && (
              <div className="info-banner">
                <Info aria-hidden="true" />
                <p>检测到现有数据，您可以重新配置或跳过设置直接开始学习。</p>
              </div>
            )}

            <section className="onboarding-section">
              <div className="step-icon">
                <FolderOpen aria-hidden="true" />
              </div>
              <h3>1. 设置存储位置</h3>
              <p>选择一个位置来存储您的词库和学习数据</p>
            </section>

            <section className="onboarding-section">
              <div className="step-icon">
                <Download aria-hidden="true" />
              </div>
              <h3>2. 导入示例词库</h3>
              <p>自动导入示例词汇，或者添加您自己的词库文件</p>
            </section>

            <section className="onboarding-section">
              <div className="step-icon">
                <BookOpen aria-hidden="true" />
              </div>
              <h3>3. 开始第一次学习</h3>
              <p>创建您的第一个学习任务，体验AI驱动的情景化学习</p>
            </section>
          </div>

          <div className="onboarding-actions">
            {hasExistingData && (
              <button type="button" className="secondary-button" onClick={handleComplete}>
                跳过设置
              </button>
            )}
            <button type="button" className="primary-button" onClick={() => setStep("setup")}>
              开始设置
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "setup") {
    return (
      <div className="onboarding-container">
        <div className="onboarding-card">
          <StepIndicator currentStep="setup" />

          <div className="onboarding-header">
            <h1>设置词库存储位置</h1>
            <p>选择一个便于访问和备份的位置来存储您的词库文件</p>
          </div>

          <div className="onboarding-content">
            <div className="setup-info">
              <h4>选择存储位置：</h4>
              <div className="path-options">
                <label className="path-option">
                  <input
                    type="radio"
                    name="vaultPath"
                    value="~/Documents/EnPet/vault"
                    checked={vaultPath === "~/Documents/EnPet/vault"}
                    onChange={(e) => setVaultPath(e.target.value)}
                  />
                  <div>
                    <strong>~/Documents/EnPet/vault</strong>
                    <span>推荐：便于访问和备份，支持iCloud同步</span>
                  </div>
                </label>

                <label className="path-option">
                  <input
                    type="radio"
                    name="vaultPath"
                    value="~/Library/Application Support/EnPet/vault"
                    checked={vaultPath === "~/Library/Application Support/EnPet/vault"}
                    onChange={(e) => setVaultPath(e.target.value)}
                  />
                  <div>
                    <strong>~/Library/Application Support/EnPet/vault</strong>
                    <span>标准应用数据位置，更隐蔽但安全</span>
                  </div>
                </label>
              </div>
            </div>

            {error ? (
              <div className="error-banner" role="alert">
                <span>{error}</span>
              </div>
            ) : null}
          </div>

          <div className="onboarding-actions">
            <button type="button" className="secondary-button" onClick={() => setStep("welcome")} disabled={loading}>
              返回
            </button>
            <button type="button" className="primary-button" onClick={handleSetup} disabled={loading}>
              {loading ? "创建中..." : "创建示例词库"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "import") {
    return (
      <div className="onboarding-container">
        <div className="onboarding-card">
          <StepIndicator currentStep="import" />

          <div className="onboarding-header">
            <h1>导入词库</h1>
            <p>将示例词汇导入到数据库中，准备开始学习</p>
          </div>

          <div className="onboarding-content">
            <div className="setup-info">
              <h4>准备导入：</h4>
              <ul>
                <li>4个精选示例词汇（study, practice, improve, learn）</li>
                <li>自动生成今日学习情景</li>
                <li>建立学习记录和复习计划</li>
              </ul>
            </div>

            {error ? (
              <div className="error-banner" role="alert">
                <span>{error}</span>
              </div>
            ) : null}
          </div>

          <div className="onboarding-actions">
            <button type="button" className="secondary-button" onClick={() => setStep("setup")} disabled={loading}>
              返回
            </button>
            <button type="button" className="primary-button" onClick={handleImport} disabled={loading}>
              {loading ? "导入中..." : "导入词库"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "first-lesson") {
    return (
      <div className="onboarding-container">
        <div className="onboarding-card">
          <StepIndicator currentStep="first-lesson" />

          <div className="onboarding-header">
            <h1>创建第一次学习任务</h1>
            <p>AI将为您生成一个有趣的学习情景，包含今天要学习的词汇</p>
          </div>

          <div className="onboarding-content">
            <div className="setup-info">
              <h4>即将创建：</h4>
              <ul>
                <li>智能选择语义相容的词汇</li>
                <li>生成包含目标词的自然情景</li>
                <li>提供参考翻译和学习提示</li>
              </ul>
              <div className="info-banner" style={{ marginTop: "16px" }}>
                <Play aria-hidden="true" />
                <p>创建任务后，您可以立即开始学习，体验AI驱动的情景化学习效果！</p>
              </div>
            </div>

            {error ? (
              <div className="error-banner" role="alert">
                <span>{error}</span>
              </div>
            ) : null}
          </div>

          <div className="onboarding-actions">
            <button type="button" className="secondary-button" onClick={() => setStep("import")} disabled={loading}>
              返回
            </button>
            <button type="button" className="primary-button" onClick={handleCreateFirstLesson} disabled={loading}>
              {loading ? "创建中..." : "创建学习任务"}
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
          <StepIndicator currentStep="complete" />

          <div className="onboarding-header">
            <div className="success-icon">
              <CheckCircle2 aria-hidden="true" />
            </div>
            <h1>设置完成！🎉</h1>
            <p>您的学习环境已经准备就绪</p>
          </div>

          <div className="onboarding-content">
            <div className="success-info">
              <h4>现在您可以：</h4>
              <ul>
                <li>开始在"新词学习"页面学习今天的词汇</li>
                <li>添加更多词库文件到您设置的位置</li>
                <li>在设置中配置学习参数和提醒时间</li>
                <li>每天坚持学习，利用间隔重复算法巩固记忆</li>
              </ul>
            </div>

            <div className="info-banner" style={{ marginTop: "16px" }}>
              <Info aria-hidden="true" />
              <p>💡 提示：EnPet使用AI生成学习情景，让单词学习更加有趣和高效！</p>
            </div>
          </div>

          <div className="onboarding-actions">
            <button type="button" className="primary-button" onClick={handleComplete}>
              开始学习
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
