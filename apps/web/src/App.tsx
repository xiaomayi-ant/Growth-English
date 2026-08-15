import type {
  Rating,
  ReviewQueue,
  SessionItem,
  SessionRefusal,
  SessionStatus,
  StudySession,
} from "@enpet/core";
// 只从纯逻辑子路径取运行时代码：@enpet/core 根导出连着 config/vault，
// 那里有 node:fs，整包引进浏览器 bundle 会直接构建失败
import { reviewOffsetForRound } from "@enpet/core/dates";
import {
  BookOpen,
  Check,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  History,
  Info,
  LoaderCircle,
  NotebookPen,
  RefreshCw,
  RotateCcw,
  Settings as SettingsIcon,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { ImportPreview } from "./ImportPreview";
import { Settings } from "./Settings";

type View = "learn" | "review" | "history";

const ratingOptions: Array<{ value: Rating; label: string }> = [
  { value: "again", label: "忘记" },
  { value: "hard", label: "模糊" },
  { value: "good", label: "掌握" },
  { value: "easy", label: "熟练" },
];

const sessionStatusLabels: Record<SessionStatus, string> = {
  planned: "待开始",
  active: "进行中",
  completed: "已完成",
  abandoned: "已放弃",
};

/**
 * currentFileIndex 是「还有未学词的文件」，词全部学完后它也会变成 null——
 * 直接拿它判断有没有词库，就会出现「8 个词条 / 等待词库」这种自相矛盾的说法。
 */
function vocabularyStatus(health: { sourceEntries: number; currentFileIndex: number | null }) {
  if (health.sourceEntries === 0) return "等待词库";
  if (health.currentFileIndex === null) return "词都学过了";
  return `当前文档 ${health.currentFileIndex}`;
}

/**
 * 服务端建不出会话时返回的是 200 加一个 session:null，不是错误。调用方只 catch
 * 异常的话就会把「什么都没发生」当成功——引导里那句「设置完成 🎉」就是这么来的。
 */
function refusalMessage(reason: SessionRefusal | null): string {
  switch (reason) {
    case "no-vocabulary":
      return "还没有词库，先导入词库或用示例词开始。";
    case "all-learned":
      return "当前词库里的词都学过了，导入新的词库继续。";
    default:
      return "暂时创建不了今天的任务。";
  }
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <CheckCircle2 aria-hidden="true" />
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

interface EmptyVaultProps {
  vocabDir: string;
  busy: boolean;
  onImport: () => void;
  onUseSample: () => void;
}

/**
 * 空词库时主界面显示的入口。这里刻意不做成启动前的向导：所有选择都有合理默认值，
 * 拦在门口只会让第一分钟变成一份表格，而且向导是全应用最少被走到的路径——
 * 开发时天天见的是主界面，向导坏了没人发现。存储位置之类的配置在设置页里改。
 */
function EmptyVault({ vocabDir, busy, onImport, onUseSample }: EmptyVaultProps) {
  return (
    <div className="start-panel">
      <div className="empty-state">
        <Database aria-hidden="true" />
        <h3>还没有词库</h3>
        <p>把 Markdown 词库文件放进下面的目录再导入，或者先用几个示例词把流程跑一遍。</p>
        {/* 路径可能很长，单独占一行，不跟正文挤在一起硬断 */}
        <code className="vault-path">{vocabDir}</code>
      </div>
      <div className="empty-actions">
        <button type="button" className="primary-button" disabled={busy} onClick={onImport}>
          {busy ? (
            <LoaderCircle className="spin" aria-hidden="true" />
          ) : (
            <Database aria-hidden="true" />
          )}
          导入我的词库
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={onUseSample}>
          <BookOpen aria-hidden="true" />用 6 个示例词先试试
        </button>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading-state">
      <LoaderCircle className="spin" aria-hidden="true" />
      <span>正在加载</span>
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <TriangleAlert aria-hidden="true" />
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="icon-button" title="重试" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

interface WordExerciseProps {
  item: SessionItem;
  busy: boolean;
  onSubmit: (answer: string, rating: Rating) => Promise<void>;
}

function WordExercise({ item, busy, onSubmit }: WordExerciseProps) {
  const [answer, setAnswer] = useState(item.answer ?? "");
  const [rating, setRating] = useState<Rating | null>(item.rating);
  const [revealed, setRevealed] = useState(item.completedAt !== null);
  const completed = item.completedAt !== null;

  async function handleRatingSelect(nextRating: Rating): Promise<void> {
    setRating(nextRating);
    await onSubmit(answer, nextRating);
  }

  return (
    <article className={`word-card ${completed ? "is-complete" : ""}`}>
      <div className="word-card-header">
        <div>
          <span className="word-index">{String(item.position).padStart(2, "0")}</span>
          <h3>{item.sourceEntry.word}</h3>
        </div>
        <div className="word-meta">
          {/* D 记号是「学习后第几天」，不是第几轮：第 2 轮是 D3，第 3 轮是 D7 */}
          {item.roundNumber ? (
            <span>{`D${reviewOffsetForRound(item.roundNumber) ?? item.roundNumber}`}</span>
          ) : (
            <span>NEW</span>
          )}
        </div>
      </div>

      <label className="answer-field">
        <span>你的释义</span>
        <textarea
          value={answer}
          disabled={completed || busy}
          rows={2}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder="输入中文含义"
        />
      </label>

      <button
        type="button"
        className="reveal-button"
        onClick={() => setRevealed((current) => !current)}
      >
        {revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        {revealed ? "隐藏答案" : "显示答案"}
      </button>

      {revealed ? (
        <div className="answer-panel">
          <strong>{item.sourceEntry.meaning || "暂无释义"}</strong>
          <span>{item.sourceEntry.phonetic}</span>
        </div>
      ) : null}

      <fieldset className="rating-row">
        <legend className="visually-hidden">{item.sourceEntry.word} 评分</legend>
        {ratingOptions.map((option) => (
          <button
            type="button"
            key={option.value}
            className={`rating-button rating-${option.value} ${rating === option.value ? "is-selected" : ""}`}
            disabled={completed || busy}
            aria-pressed={rating === option.value}
            onClick={() => void handleRatingSelect(option.value)}
          >
            {option.label}
          </button>
        ))}
      </fieldset>

      {item.feedback ? (
        <div className="feedback-panel">
          <strong>批改反馈</strong>
          <span>{item.feedback}</span>
        </div>
      ) : null}

      <div className="word-card-footer">
        <span>
          {busy
            ? "保存中"
            : completed
              ? "已记录"
              : item.dueOn
                ? `到期 ${item.dueOn}`
                : "选择评分后自动记录"}
        </span>
        {busy ? (
          <LoaderCircle className="spin complete-icon" aria-hidden="true" />
        ) : completed ? (
          <Check aria-hidden="true" className="complete-icon" />
        ) : null}
      </div>
    </article>
  );
}

function SessionProgress({ session }: { session: StudySession }) {
  const completed = session.items.filter((item) => item.completedAt !== null).length;
  const percent =
    session.items.length === 0 ? 100 : Math.round((completed / session.items.length) * 100);
  return (
    <div className="progress-block">
      <div>
        <span>{session.type === "new_learning" ? "今日新词" : "到期复习"}</span>
        <strong>
          {completed}/{session.items.length}
        </strong>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label="学习进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

interface SessionViewProps {
  session: StudySession | null;
  loading: boolean;
  actionLabel: string;
  emptyTitle: string;
  emptyDetail: string;
  onCreate: () => Promise<void>;
  onSessionChange: (session: StudySession) => void;
  onComplete?: (() => Promise<void>) | undefined;
}

function SessionView({
  session,
  loading,
  actionLabel,
  emptyTitle,
  emptyDetail,
  onCreate,
  onSessionChange,
  onComplete,
}: SessionViewProps) {
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  if (loading) return <LoadingState />;
  if (!session) {
    return (
      <div className="start-panel">
        <EmptyState title={emptyTitle} detail={emptyDetail} />
        <button type="button" className="primary-button" onClick={onCreate}>
          <BookOpen aria-hidden="true" />
          {actionLabel}
        </button>
      </div>
    );
  }

  const allItemsRecorded = session.items.every((item) => item.completedAt !== null);
  return (
    <div className="session-layout">
      <SessionProgress session={session} />
      {session.theme ? (
        <section className="context-section">
          <div className="section-heading">
            <span>CONTEXT</span>
            <h2>{session.theme}</h2>
          </div>
          <p>{session.passage}</p>
        </section>
      ) : null}
      {session.items.length === 0 ? (
        <EmptyState title="今天没有到期词" detail="复习队列当前为空。" />
      ) : (
        <div className="word-grid">
          {session.items.map((item) => (
            <WordExercise
              key={item.sourceEntry.id}
              item={item}
              busy={submittingId === item.sourceEntry.id}
              onSubmit={async (answer, rating) => {
                setSubmittingId(item.sourceEntry.id);
                try {
                  const response = await api.submitItem(
                    session.id,
                    item.sourceEntry.id,
                    answer,
                    rating,
                  );
                  if (response.session) onSessionChange(response.session);
                } finally {
                  setSubmittingId(null);
                }
              }}
            />
          ))}
        </div>
      )}
      {onComplete && session.status !== "completed" ? (
        <div className="session-actions">
          <button
            type="button"
            className="primary-button"
            disabled={!allItemsRecorded}
            onClick={onComplete}
          >
            <CheckCircle2 aria-hidden="true" />
            完成新词学习
          </button>
        </div>
      ) : null}
    </div>
  );
}

function QueueSummary({ queue }: { queue: ReviewQueue | null }) {
  if (!queue) return null;
  return (
    <div className="metric-row">
      <div className="metric danger">
        <span>逾期</span>
        <strong>{queue.overdue.length}</strong>
      </div>
      <div className="metric warning">
        <span>今日</span>
        <strong>{queue.dueToday.length}</strong>
      </div>
      <div className="metric neutral">
        <span>即将到期</span>
        <strong>{queue.upcoming.length}</strong>
      </div>
    </div>
  );
}

function HistoryView({ sessions, loading }: { sessions: StudySession[]; loading: boolean }) {
  if (loading) return <LoadingState />;
  if (sessions.length === 0)
    return <EmptyState title="暂无学习记录" detail="完成任务后会显示在这里。" />;
  return (
    <div className="history-list">
      {sessions.map((session) => (
        <article className="history-row" key={session.id}>
          <div className={`history-icon ${session.type}`}>
            {session.type === "new_learning" ? (
              <BookOpen aria-hidden="true" />
            ) : (
              <RotateCcw aria-hidden="true" />
            )}
          </div>
          <div>
            <strong>{session.type === "new_learning" ? "新词学习" : "到期复习"}</strong>
            <span>{session.date}</span>
          </div>
          <span className={`status-pill status-${session.status}`}>
            {sessionStatusLabels[session.status]}
          </span>
          <strong>{session.items.length} 词</strong>
        </article>
      ))}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>("learn");
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null);
  const [newSession, setNewSession] = useState<StudySession | null>(null);
  const [reviewSession, setReviewSession] = useState<StudySession | null>(null);
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [history, setHistory] = useState<StudySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // 每日新词数在设置页可改，空状态的文案必须跟着走，不能写死
  const [newWordsPerDay, setNewWordsPerDay] = useState(6);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextHealth, nextSettings, nextNew, nextReview, nextQueue, nextHistory] =
        await Promise.all([
          api.health(),
          api.getSettings(),
          api.getNewSession(),
          api.getReviewSession(),
          api.getReviewQueue(),
          api.history(),
        ]);
      setHealth(nextHealth);
      setNewWordsPerDay(nextSettings.newWordsPerDay);
      setNewSession(nextNew.session);
      setReviewSession(nextReview.session);
      setQueue(nextQueue);
      setHistory(nextHistory.sessions);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法连接 EnPet 服务");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 顶栏的「同步词库」和空状态的「导入我的词库」是同一个动作
  const startImport = useCallback(async () => {
    setImporting(true);
    setError(null);
    try {
      // 先探一次：没有词库文件就直接提示，有的话进预览让用户确认
      const preview = await api.previewImport();
      if (preview.files === 0) {
        setNotice(`${preview.vocabDir} 中还没有词库文件`);
      } else {
        setShowPreview(true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "解析词库失败");
    } finally {
      setImporting(false);
    }
  }, []);

  const useSampleVocabulary = useCallback(async () => {
    setImporting(true);
    setError(null);
    try {
      const summary = await api.createSampleVault();
      setNotice(`已导入 ${summary.inserted} 个示例词，可以直接开始学习`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建示例词库失败");
    } finally {
      setImporting(false);
    }
  }, [refresh]);

  const title = useMemo(
    () => ({ learn: "新词学习", review: "到期复习", history: "学习历史" })[view],
    [view],
  );

  return (
    <>
      {showPreview ? (
        <ImportPreview
          onCancel={() => setShowPreview(false)}
          onImported={(inserted, updated) => {
            setShowPreview(false);
            setNotice(`导入完成：新增 ${inserted} 条，更新 ${updated} 条`);
            void refresh();
          }}
        />
      ) : showSettings ? (
        <Settings
          onClose={() => {
            setShowSettings(false);
            // 设置可能改了词库目录或每日上限，回主界面前重新取一遍
            void refresh();
          }}
        />
      ) : (
        <div className="app-shell">
          <aside className="sidebar">
            <div className="brand-block">
              <div className="brand-mark">EN</div>
              <div>
                <strong>EnPet</strong>
                <span>{health ? `v${health.version}` : "Vocabulary Studio"}</span>
              </div>
            </div>
            <nav className="primary-nav" aria-label="主要导航">
              <button
                type="button"
                className={view === "learn" ? "active" : ""}
                onClick={() => setView("learn")}
              >
                <BookOpen aria-hidden="true" />
                新词学习
              </button>
              <button
                type="button"
                className={view === "review" ? "active" : ""}
                onClick={() => setView("review")}
              >
                <RotateCcw aria-hidden="true" />
                到期复习
                {queue && queue.overdue.length + queue.dueToday.length > 0 ? (
                  <span className="nav-count">{queue.overdue.length + queue.dueToday.length}</span>
                ) : null}
              </button>
              <button
                type="button"
                className={view === "history" ? "active" : ""}
                onClick={() => setView("history")}
              >
                <History aria-hidden="true" />
                学习历史
              </button>
            </nav>
            <div className="sidebar-status">
              <span className={`status-dot ${health ? "online" : "offline"}`} />
              <div>
                <strong>{health ? `${health.sourceEntries} 个词条` : "服务未连接"}</strong>
                <span>{health ? vocabularyStatus(health) : "等待词库"}</span>
              </div>
            </div>
          </aside>

          <main className="main-content">
            <header className="topbar">
              <div>
                <span>{health?.today ?? "---- -- --"}</span>
                <h1>{title}</h1>
              </div>
              <div className="topbar-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={importing}
                  onClick={startImport}
                >
                  {importing ? (
                    <LoaderCircle className="spin" aria-hidden="true" />
                  ) : (
                    <Database aria-hidden="true" />
                  )}
                  同步词库
                </button>
                <button
                  type="button"
                  className="icon-button bordered"
                  title={health ? `在 Obsidian 中打开 ${health.vocabDir}` : "在 Obsidian 中打开"}
                  disabled={!health}
                  onClick={() => {
                    // 词库目录本身就是 vault，Obsidian 首次打开时会自动登记进库列表
                    if (health) window.location.href = health.obsidianLink;
                  }}
                >
                  <NotebookPen aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button bordered"
                  title="刷新"
                  onClick={refresh}
                >
                  <RefreshCw aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button bordered"
                  title="设置"
                  onClick={() => setShowSettings(true)}
                >
                  <SettingsIcon aria-hidden="true" />
                </button>
              </div>
            </header>

            {error ? <ErrorBanner message={error} onRetry={refresh} /> : null}
            {notice ? (
              <div className="setup-banner">
                <Info aria-hidden="true" />
                <div>
                  <span>{notice}</span>
                </div>
                <button type="button" className="icon-button" onClick={() => setNotice(null)}>
                  ×
                </button>
              </div>
            ) : null}
            <div className="view-content">
              {/* 空词库时学习和复习都无从谈起，直接把入口摆在主位置 */}
              {!loading && health?.sourceEntries === 0 && view !== "history" ? (
                <EmptyVault
                  vocabDir={health.vocabDir}
                  busy={importing}
                  onImport={() => void startImport()}
                  onUseSample={() => void useSampleVocabulary()}
                />
              ) : view === "learn" ? (
                <SessionView
                  session={newSession}
                  loading={loading}
                  actionLabel="创建今日新词任务"
                  emptyTitle="今日任务尚未创建"
                  emptyDetail={`从当前文档选择约 ${newWordsPerDay} 个未学词。`}
                  onCreate={async () => {
                    const response = await api.createNewSession();
                    setNewSession(response.session);
                    if (!response.session) setNotice(refusalMessage(response.reason));
                  }}
                  onSessionChange={(session) => {
                    setNewSession(session);
                    if (session.status === "completed") void refresh();
                  }}
                  onComplete={
                    newSession
                      ? async () => {
                          const response = await api.completeNewSession(newSession.id);
                          setNewSession(response.session);
                          await refresh();
                        }
                      : undefined
                  }
                />
              ) : null}

              {view === "review" ? (
                <>
                  <QueueSummary queue={queue} />
                  <SessionView
                    session={reviewSession}
                    loading={loading}
                    actionLabel="创建今日复习任务"
                    emptyTitle="今日复习尚未创建"
                    emptyDetail="从数据库读取今天到期和此前逾期的词。"
                    onCreate={async () => {
                      const response = await api.createReviewSession();
                      setReviewSession(response.session);
                      if (!response.session) setNotice(refusalMessage(response.reason));
                    }}
                    onSessionChange={(session) => {
                      setReviewSession(session);
                      void api.getReviewQueue().then(setQueue);
                    }}
                  />
                </>
              ) : null}

              {view === "history" ? <HistoryView sessions={history} loading={loading} /> : null}
            </div>
          </main>
        </div>
      )}
    </>
  );
}
