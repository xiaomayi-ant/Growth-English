export const REVIEW_OFFSETS = [1, 3, 7, 14, 21] as const;

export type ReviewOffset = (typeof REVIEW_OFFSETS)[number];
export type Rating = "again" | "hard" | "good" | "easy";
export type LearningStatus = "active" | "completed" | "expired_unmastered";
export type SessionType = "new_learning" | "review";
export type SessionStatus = "planned" | "active" | "completed" | "abandoned";
export type ReviewStatus = "pending" | "completed" | "covered";

export interface SourceEntry {
  id: string;
  fileIndex: number;
  rowIndex: number;
  columnIndex: number;
  sourcePath: string;
  word: string;
  meaning: string;
  phonetic: string;
  sourceOrder: number;
}

export interface ImportIssue {
  sourcePath: string;
  lineNumber: number;
  message: string;
}

export interface ImportSummary {
  files: number;
  parsed: number;
  inserted: number;
  updated: number;
  issues: ImportIssue[];
  /** 词库目录为空等正常但需要告知用户的情况 */
  message?: string;
  vocabDir?: string;
}

export interface ScenarioContent {
  selectedEntryIds: string[];
  theme: string;
  passage: string;
  referenceTranslation: string;
}

export interface SessionItem {
  sourceEntry: SourceEntry;
  role: "new" | "review";
  position: number;
  reviewRoundId: number | null;
  roundNumber: number | null;
  dueOn: string | null;
  answer: string | null;
  rating: Rating | null;
  feedback: string | null;
  completedAt: string | null;
}

export interface StudySession {
  id: string;
  date: string;
  type: SessionType;
  status: SessionStatus;
  theme: string | null;
  passage: string | null;
  referenceTranslation: string | null;
  createdAt: string;
  completedAt: string | null;
  items: SessionItem[];
}

/**
 * 建不出会话的原因。服务端返回 200 加 session:null，界面靠这个说清楚发生了什么，
 * 而不是让用户点了按钮却毫无反应。
 */
export type SessionRefusal = "weekend" | "no-vocabulary" | "all-learned";

export interface SessionOutcome {
  session: StudySession | null;
  reason: SessionRefusal | null;
}

export interface ReviewQueueItem {
  learningItemId: number;
  sourceEntry: SourceEntry;
  roundNumber: number;
  dueOn: string;
  overdueDays: number;
}

export interface ReviewQueue {
  today: string;
  overdue: ReviewQueueItem[];
  dueToday: ReviewQueueItem[];
  upcoming: ReviewQueueItem[];
}

export interface EvaluationResult {
  suggestedRating: Rating;
  score: number;
  feedback: string;
  corrections: string[];
}
