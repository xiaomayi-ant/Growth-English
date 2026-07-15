import type { Rating, ReviewQueue, SessionItem, StudySession } from "@en-play/core";
import {
  BookOpen,
  Check,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  History,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";

type View = "learn" | "review" | "history";

const ratingOptions: Array<{ value: Rating; label: string }> = [
  { value: "again", label: "忘记" },
  { value: "hard", label: "模糊" },
  { value: "good", label: "掌握" },
  { value: "easy", label: "熟练" },
];

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <CheckCircle2 aria-hidden="true" />
      <h3>{title}</h3>
      <p>{detail}</p>
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
          {item.roundNumber ? <span>D{item.roundNumber}</span> : <span>NEW</span>}
          <span>{item.sourceEntry.id}</span>
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
          <span className={`status-pill status-${session.status}`}>{session.status}</span>
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

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextHealth, nextNew, nextReview, nextQueue, nextHistory] = await Promise.all([
        api.health(),
        api.getNewSession(),
        api.getReviewSession(),
        api.getReviewQueue(),
        api.history(),
      ]);
      setHealth(nextHealth);
      setNewSession(nextNew.session);
      setReviewSession(nextReview.session);
      setQueue(nextQueue);
      setHistory(nextHistory.sessions);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法连接 En Play 服务");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const title = useMemo(
    () => ({ learn: "新词学习", review: "到期复习", history: "学习历史" })[view],
    [view],
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">EN</div>
          <div>
            <strong>En Play</strong>
            <span>Vocabulary Studio</span>
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
            <span>
              {health?.currentFileIndex ? `当前文档 ${health.currentFileIndex}` : "等待词库"}
            </span>
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
              onClick={async () => {
                setImporting(true);
                setError(null);
                try {
                  await api.importVocabulary();
                  await refresh();
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "导入失败");
                } finally {
                  setImporting(false);
                }
              }}
            >
              {importing ? (
                <LoaderCircle className="spin" aria-hidden="true" />
              ) : (
                <Database aria-hidden="true" />
              )}
              同步词库
            </button>
            <button type="button" className="icon-button bordered" title="刷新" onClick={refresh}>
              <RefreshCw aria-hidden="true" />
            </button>
          </div>
        </header>

        {error ? <ErrorBanner message={error} onRetry={refresh} /> : null}
        {health?.sourceEntries === 0 && !loading ? (
          <div className="setup-banner">
            <Database aria-hidden="true" />
            <div>
              <strong>词库尚未导入</strong>
              <span>同步 Obsidian 词表后开始学习。</span>
            </div>
          </div>
        ) : null}

        <div className="view-content">
          {view === "learn" ? (
            <SessionView
              session={newSession}
              loading={loading}
              actionLabel="创建今日新词任务"
              emptyTitle="今日任务尚未创建"
              emptyDetail="从当前文档选择约 6 个未学词。"
              onCreate={async () => {
                const response = await api.createNewSession();
                setNewSession(response.session);
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
  );
}
