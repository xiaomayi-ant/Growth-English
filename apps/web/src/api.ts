import type {
  ImportIssue,
  ImportSummary,
  OnboardingState,
  Rating,
  ReviewQueue,
  SourceEntry,
  StudySession,
  VocabFormat,
} from "@enpet/core";

export interface ImportPreview {
  files: number;
  total: number;
  format: VocabFormat;
  issues: ImportIssue[];
  entries: SourceEntry[];
  vocabDir: string;
}

interface HealthResponse {
  status: string;
  version: string;
  today: string;
  sourceEntries: number;
  currentFileIndex: number | null;
  vocabDir: string;
  obsidianLink: string;
}

interface ApiError {
  error: string;
  code?: string;
  suggestions?: string[];
  details?: unknown;
}

interface SessionResponse {
  session: StudySession | null;
  reason?: string | null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };

  // 只有在有body的情况下才设置Content-Type为application/json
  if (init?.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    const errorPayload = payload as ApiError & { suggestions?: string[]; details?: unknown };
    const errorMessage = errorPayload.error
      ? errorPayload.suggestions && errorPayload.suggestions.length > 0
        ? `${errorPayload.error}\n\n建议：\n${errorPayload.suggestions.map((s) => `• ${s}`).join("\n")}`
        : errorPayload.error
      : `Request failed with ${response.status}`;
    throw new Error(errorMessage);
  }
  return payload;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  onboarding: () => request<OnboardingState>("/api/onboarding"),
  setupVault: (vaultPath?: string, withSample = true) =>
    request<{ success: boolean; message: string; vocabDir: string }>(
      "/api/onboarding/setup-vault",
      {
        method: "POST",
        body: JSON.stringify({ vaultPath, withSample }),
      },
    ),
  completeOnboarding: () =>
    request<{ success: boolean }>("/api/onboarding/complete", { method: "POST" }),
  previewImport: (format?: Partial<VocabFormat>) =>
    request<ImportPreview>("/api/import/preview", {
      method: "POST",
      body: JSON.stringify({ format }),
    }),
  importVocabulary: (format?: Partial<VocabFormat>) =>
    request<ImportSummary>("/api/import", {
      method: "POST",
      body: JSON.stringify(format ? { format } : {}),
    }),
  updateEntry: (id: string, fields: { word?: string; meaning?: string; phonetic?: string }) =>
    request<SourceEntry>(`/api/entries/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(fields),
    }),
  getNewSession: () => request<SessionResponse>("/api/sessions/new/today"),
  createNewSession: () =>
    request<SessionResponse>("/api/sessions/new/today", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  getReviewSession: () => request<SessionResponse>("/api/sessions/review/today"),
  createReviewSession: () =>
    request<SessionResponse>("/api/sessions/review/today", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  getReviewQueue: () => request<ReviewQueue>("/api/reviews/queue"),
  submitItem: (sessionId: string, sourceEntryId: string, answer: string, rating: Rating) =>
    request<SessionResponse>(
      `/api/sessions/${encodeURIComponent(sessionId)}/items/${encodeURIComponent(sourceEntryId)}`,
      {
        method: "POST",
        body: JSON.stringify({ answer, rating, feedback: "" }),
      },
    ),
  completeNewSession: (sessionId: string) =>
    request<SessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/complete`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  history: () => request<{ sessions: StudySession[] }>("/api/history?limit=30"),
};
