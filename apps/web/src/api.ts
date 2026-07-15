import type { ImportSummary, Rating, ReviewQueue, StudySession } from "@en-play/core";

interface HealthResponse {
  status: string;
  today: string;
  sourceEntries: number;
  currentFileIndex: number | null;
}

interface SessionResponse {
  session: StudySession | null;
  reason?: string | null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with ${response.status}`);
  }
  return payload;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  importVocabulary: () => request<ImportSummary>("/api/import", { method: "POST" }),
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
