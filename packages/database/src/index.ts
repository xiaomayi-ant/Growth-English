import { mkdir } from "node:fs/promises";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import {
  buildReviewDates,
  differenceInCalendarDays,
  type ImportIssue,
  type ImportSummary,
  type Rating,
  type ReviewQueue,
  type ReviewQueueItem,
  type ScenarioContent,
  type SessionItem,
  type SessionType,
  type SourceEntry,
  type StudySession,
} from "@enpet/core";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_versions (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_entries (
  id TEXT PRIMARY KEY,
  file_index INTEGER NOT NULL,
  row_index INTEGER NOT NULL,
  column_index INTEGER NOT NULL,
  source_path TEXT NOT NULL,
  word TEXT NOT NULL,
  meaning TEXT NOT NULL,
  phonetic TEXT NOT NULL,
  source_order INTEGER NOT NULL,
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(file_index, row_index, column_index)
);

CREATE INDEX IF NOT EXISTS idx_source_entries_file_order
ON source_entries(file_index, source_order);

CREATE TABLE IF NOT EXISTS learning_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_entry_id TEXT NOT NULL UNIQUE REFERENCES source_entries(id),
  status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'expired_unmastered')),
  introduced_on TEXT NOT NULL,
  selection_context TEXT,
  final_result TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS review_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  learning_item_id INTEGER NOT NULL REFERENCES learning_items(id),
  round_number INTEGER NOT NULL,
  offset_days INTEGER NOT NULL,
  scheduled_on TEXT NOT NULL,
  effective_due_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'covered')),
  presented_at TEXT,
  answered_at TEXT,
  rating TEXT CHECK(rating IN ('again', 'hard', 'good', 'easy')),
  answer TEXT,
  feedback TEXT,
  UNIQUE(learning_item_id, round_number)
);

CREATE INDEX IF NOT EXISTS idx_review_rounds_due
ON review_rounds(status, effective_due_on);

CREATE TABLE IF NOT EXISTS study_sessions (
  id TEXT PRIMARY KEY,
  session_date TEXT NOT NULL,
  session_type TEXT NOT NULL CHECK(session_type IN ('new_learning', 'review')),
  status TEXT NOT NULL CHECK(status IN ('planned', 'active', 'completed', 'abandoned')),
  context_theme TEXT,
  passage TEXT,
  reference_translation TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(session_date, session_type)
);

CREATE TABLE IF NOT EXISTS session_items (
  session_id TEXT NOT NULL REFERENCES study_sessions(id),
  source_entry_id TEXT NOT NULL REFERENCES source_entries(id),
  review_round_id INTEGER REFERENCES review_rounds(id),
  item_role TEXT NOT NULL CHECK(item_role IN ('new', 'review')),
  position INTEGER NOT NULL,
  answer TEXT,
  rating TEXT CHECK(rating IN ('again', 'hard', 'good', 'easy')),
  feedback TEXT,
  completed_at TEXT,
  PRIMARY KEY(session_id, source_entry_id)
);

CREATE TABLE IF NOT EXISTS generated_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES study_sessions(id),
  type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  reference_answer TEXT,
  target_entry_ids TEXT NOT NULL,
  model_info TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL
);
`;

type SqlRow = Record<string, string | number | bigint | null>;

function nowIso(): string {
  return new Date().toISOString();
}

function sourceEntryFromRow(row: SqlRow): SourceEntry {
  return {
    id: String(row.id),
    fileIndex: Number(row.file_index),
    rowIndex: Number(row.row_index),
    columnIndex: Number(row.column_index),
    sourcePath: String(row.source_path),
    word: String(row.word),
    meaning: String(row.meaning),
    phonetic: String(row.phonetic),
    sourceOrder: Number(row.source_order),
  };
}

function ratingOrNull(value: unknown): Rating | null {
  return value === "again" || value === "hard" || value === "good" || value === "easy"
    ? value
    : null;
}

export class EnPetDatabase {
  readonly connection: DatabaseSync;

  private constructor(connection: DatabaseSync) {
    this.connection = connection;
  }

  static async open(databasePath: string): Promise<EnPetDatabase> {
    if (databasePath !== ":memory:") {
      await mkdir(path.dirname(databasePath), { recursive: true });
    }
    const connection = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
    connection.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    const database = new EnPetDatabase(connection);
    database.migrate();
    return database;
  }

  close(): void {
    this.connection.close();
  }

  async createBackup(targetPath: string): Promise<number> {
    await mkdir(path.dirname(targetPath), { recursive: true });
    return backup(this.connection, targetPath);
  }

  private migrate(): void {
    this.connection.exec(SCHEMA);
    this.connection
      .prepare("INSERT OR IGNORE INTO schema_versions(version, applied_at) VALUES(1, ?)")
      .run(nowIso());
  }

  private transaction<T>(operation: () => T): T {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  importEntries(entries: SourceEntry[], files: number, issues: ImportIssue[]): ImportSummary {
    const existingStatement = this.connection.prepare("SELECT id FROM source_entries WHERE id = ?");
    const upsertStatement = this.connection.prepare(`
      INSERT INTO source_entries(
        id, file_index, row_index, column_index, source_path, word, meaning, phonetic,
        source_order, imported_at, updated_at, source_active
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        source_path = excluded.source_path,
        word = excluded.word,
        meaning = excluded.meaning,
        phonetic = excluded.phonetic,
        source_order = excluded.source_order,
        updated_at = excluded.updated_at,
        source_active = 1
    `);
    let inserted = 0;
    let updated = 0;
    const timestamp = nowIso();

    this.transaction(() => {
      for (const entry of entries) {
        const exists = existingStatement.get(entry.id) !== undefined;
        upsertStatement.run(
          entry.id,
          entry.fileIndex,
          entry.rowIndex,
          entry.columnIndex,
          entry.sourcePath,
          entry.word,
          entry.meaning,
          entry.phonetic,
          entry.sourceOrder,
          timestamp,
          timestamp,
        );
        if (exists) updated += 1;
        else inserted += 1;
      }
    });

    return { files, parsed: entries.length, inserted, updated, issues };
  }

  countSourceEntries(): number {
    const row = this.connection
      .prepare("SELECT COUNT(*) AS count FROM source_entries")
      .get() as SqlRow;
    return Number(row.count);
  }

  getCurrentFileIndex(): number | null {
    const row = this.connection
      .prepare(`
        SELECT MIN(se.file_index) AS file_index
        FROM source_entries se
        LEFT JOIN learning_items li ON li.source_entry_id = se.id
        WHERE se.source_active = 1 AND li.id IS NULL
      `)
      .get() as SqlRow;
    return row.file_index === null ? null : Number(row.file_index);
  }

  getUnlearnedEntries(fileIndex: number): SourceEntry[] {
    const rows = this.connection
      .prepare(`
        SELECT se.*
        FROM source_entries se
        LEFT JOIN learning_items li ON li.source_entry_id = se.id
        WHERE se.file_index = ? AND se.source_active = 1 AND li.id IS NULL
        ORDER BY se.source_order
      `)
      .all(fileIndex) as SqlRow[];
    return rows.map(sourceEntryFromRow);
  }

  getSourceEntry(id: string): SourceEntry | null {
    const row = this.connection.prepare("SELECT * FROM source_entries WHERE id = ?").get(id) as
      | SqlRow
      | undefined;
    return row ? sourceEntryFromRow(row) : null;
  }

  getSessionByDate(date: string, type: SessionType): StudySession | null {
    const row = this.connection
      .prepare("SELECT * FROM study_sessions WHERE session_date = ? AND session_type = ?")
      .get(date, type) as SqlRow | undefined;
    return row ? this.hydrateSession(row) : null;
  }

  getSession(id: string): StudySession | null {
    const row = this.connection.prepare("SELECT * FROM study_sessions WHERE id = ?").get(id) as
      | SqlRow
      | undefined;
    return row ? this.hydrateSession(row) : null;
  }

  createNewSession(date: string, entries: SourceEntry[], scenario: ScenarioContent): StudySession {
    const existing = this.getSessionByDate(date, "new_learning");
    if (existing) return existing;
    const id = `new_learning:${date}`;
    const timestamp = nowIso();
    this.transaction(() => {
      this.connection
        .prepare(`
          INSERT INTO study_sessions(
            id, session_date, session_type, status, context_theme, passage,
            reference_translation, created_at
          ) VALUES(?, ?, 'new_learning', 'active', ?, ?, ?, ?)
        `)
        .run(id, date, scenario.theme, scenario.passage, scenario.referenceTranslation, timestamp);
      const insertItem = this.connection.prepare(`
        INSERT INTO session_items(session_id, source_entry_id, item_role, position)
        VALUES(?, ?, 'new', ?)
      `);
      entries.forEach((entry, index) => {
        insertItem.run(id, entry.id, index + 1);
      });
    });
    const session = this.getSession(id);
    if (!session) throw new Error("Failed to create new learning session");
    return session;
  }

  createReviewSession(date: string, limit: number): StudySession {
    const existing = this.getSessionByDate(date, "review");
    if (existing) return existing;
    const due = this.getDueReviewItems(date, limit);
    const id = `review:${date}`;
    const timestamp = nowIso();
    this.transaction(() => {
      this.connection
        .prepare(`
          INSERT INTO study_sessions(id, session_date, session_type, status, created_at)
          VALUES(?, ?, 'review', 'active', ?)
        `)
        .run(id, date, timestamp);
      const insertItem = this.connection.prepare(`
        INSERT INTO session_items(
          session_id, source_entry_id, review_round_id, item_role, position
        ) VALUES(?, ?, ?, 'review', ?)
      `);
      due.forEach((item, index) => {
        insertItem.run(id, item.sourceEntry.id, item.reviewRoundId, index + 1);
      });
      if (due.length === 0) {
        this.connection
          .prepare("UPDATE study_sessions SET status = 'completed', completed_at = ? WHERE id = ?")
          .run(timestamp, id);
      }
    });
    const session = this.getSession(id);
    if (!session) throw new Error("Failed to create review session");
    return session;
  }

  submitSessionItem(
    sessionId: string,
    sourceEntryId: string,
    answer: string,
    rating: Rating,
    feedback = "",
  ): StudySession {
    const session = this.getSession(sessionId);
    if (!session) throw new Error("Session not found");
    const item = session.items.find((candidate) => candidate.sourceEntry.id === sourceEntryId);
    if (!item) throw new Error("Session item not found");
    const timestamp = nowIso();

    this.transaction(() => {
      this.connection
        .prepare(`
          UPDATE session_items
          SET answer = ?, rating = ?, feedback = ?, completed_at = ?
          WHERE session_id = ? AND source_entry_id = ?
        `)
        .run(answer, rating, feedback, timestamp, sessionId, sourceEntryId);

      if (session.type === "review" && item.reviewRoundId !== null) {
        const round = this.connection
          .prepare("SELECT learning_item_id FROM review_rounds WHERE id = ?")
          .get(item.reviewRoundId) as SqlRow;
        this.connection
          .prepare(`
            UPDATE review_rounds
            SET status = CASE WHEN id = ? THEN 'completed' ELSE 'covered' END,
                presented_at = ?, answered_at = ?,
                rating = CASE WHEN id = ? THEN ? ELSE rating END,
                answer = CASE WHEN id = ? THEN ? ELSE answer END,
                feedback = CASE WHEN id = ? THEN ? ELSE feedback END
            WHERE learning_item_id = ? AND status = 'pending' AND effective_due_on <= ?
          `)
          .run(
            item.reviewRoundId,
            timestamp,
            timestamp,
            item.reviewRoundId,
            rating,
            item.reviewRoundId,
            answer,
            item.reviewRoundId,
            feedback,
            Number(round.learning_item_id),
            session.date,
          );
        if (item.roundNumber === 5) {
          const finalStatus =
            rating === "good" || rating === "easy" ? "completed" : "expired_unmastered";
          this.connection
            .prepare(`
              UPDATE learning_items
              SET status = ?, final_result = ?, completed_at = ?
              WHERE id = ?
            `)
            .run(finalStatus, rating, timestamp, Number(round.learning_item_id));
        }
      }
      if (session.type === "review") {
        this.completeSessionWhenReady(sessionId, timestamp);
      }
    });
    const updated = this.getSession(sessionId);
    if (!updated) throw new Error("Session disappeared after item submission");
    return updated;
  }

  completeNewSession(sessionId: string): StudySession {
    const session = this.getSession(sessionId);
    if (session?.type !== "new_learning") throw new Error("New learning session not found");
    if (session.status === "completed") return session;
    if (session.items.some((item) => item.rating === null)) {
      throw new Error("Every new word needs a rating before completing the session");
    }
    const timestamp = nowIso();

    this.transaction(() => {
      const insertLearningItem = this.connection.prepare(`
        INSERT OR IGNORE INTO learning_items(
          source_entry_id, status, introduced_on, selection_context
        ) VALUES(?, 'active', ?, ?)
      `);
      const findLearningItem = this.connection.prepare(
        "SELECT id FROM learning_items WHERE source_entry_id = ?",
      );
      const insertRound = this.connection.prepare(`
        INSERT OR IGNORE INTO review_rounds(
          learning_item_id, round_number, offset_days, scheduled_on, effective_due_on
        ) VALUES(?, ?, ?, ?, ?)
      `);
      for (const item of session.items) {
        insertLearningItem.run(item.sourceEntry.id, session.date, session.theme);
        const learningItem = findLearningItem.get(item.sourceEntry.id) as SqlRow;
        for (const reviewDate of buildReviewDates(session.date)) {
          insertRound.run(
            Number(learningItem.id),
            reviewDate.roundNumber,
            reviewDate.offsetDays,
            reviewDate.scheduledOn,
            reviewDate.effectiveDueOn,
          );
        }
      }
      this.connection
        .prepare("UPDATE study_sessions SET status = 'completed', completed_at = ? WHERE id = ?")
        .run(timestamp, sessionId);
    });
    const updated = this.getSession(sessionId);
    if (!updated) throw new Error("Session disappeared after completion");
    return updated;
  }

  getReviewQueue(today: string, upcomingLimit = 30): ReviewQueue {
    const rows = this.connection
      .prepare(`
        SELECT
          li.id AS learning_item_id,
          rr.round_number,
          rr.effective_due_on AS due_on,
          se.*
        FROM review_rounds rr
        JOIN learning_items li ON li.id = rr.learning_item_id
        JOIN source_entries se ON se.id = li.source_entry_id
        WHERE rr.status = 'pending'
          AND rr.id = (
            SELECT next_rr.id
            FROM review_rounds next_rr
            WHERE next_rr.learning_item_id = rr.learning_item_id
              AND next_rr.status = 'pending'
            ORDER BY next_rr.effective_due_on, next_rr.round_number
            LIMIT 1
          )
        ORDER BY due_on, se.source_order
      `)
      .all() as SqlRow[];
    const items = rows.map((row) => this.reviewQueueItemFromRow(row, today));
    return {
      today,
      overdue: items.filter((item) => item.dueOn < today),
      dueToday: items.filter((item) => item.dueOn === today),
      upcoming: items.filter((item) => item.dueOn > today).slice(0, upcomingLimit),
    };
  }

  listRecentSessions(limit = 30): StudySession[] {
    const rows = this.connection
      .prepare("SELECT * FROM study_sessions ORDER BY session_date DESC, session_type LIMIT ?")
      .all(limit) as SqlRow[];
    return rows.map((row) => this.hydrateSession(row));
  }

  private getDueReviewItems(
    date: string,
    limit: number,
  ): Array<{
    sourceEntry: SourceEntry;
    reviewRoundId: number;
  }> {
    const rows = this.connection
      .prepare(`
        SELECT
          MAX(rr.id) AS review_round_id,
          MAX(rr.round_number) AS round_number,
          li.id AS learning_item_id,
          se.*
        FROM review_rounds rr
        JOIN learning_items li ON li.id = rr.learning_item_id
        JOIN source_entries se ON se.id = li.source_entry_id
        WHERE rr.status = 'pending' AND rr.effective_due_on <= ?
        GROUP BY li.id
        ORDER BY MIN(rr.effective_due_on), se.source_order
        LIMIT ?
      `)
      .all(date, limit) as SqlRow[];
    return rows.map((row) => ({
      sourceEntry: sourceEntryFromRow(row),
      reviewRoundId: Number(row.review_round_id),
    }));
  }

  private reviewQueueItemFromRow(row: SqlRow, today: string): ReviewQueueItem {
    const dueOn = String(row.due_on);
    return {
      learningItemId: Number(row.learning_item_id),
      sourceEntry: sourceEntryFromRow(row),
      roundNumber: Number(row.round_number),
      dueOn,
      overdueDays: Math.max(0, differenceInCalendarDays(today, dueOn)),
    };
  }

  private completeSessionWhenReady(sessionId: string, timestamp: string): void {
    const row = this.connection
      .prepare(`
        SELECT COUNT(*) AS remaining
        FROM session_items
        WHERE session_id = ? AND completed_at IS NULL
      `)
      .get(sessionId) as SqlRow;
    if (Number(row.remaining) === 0) {
      this.connection
        .prepare("UPDATE study_sessions SET status = 'completed', completed_at = ? WHERE id = ?")
        .run(timestamp, sessionId);
    }
  }

  private hydrateSession(row: SqlRow): StudySession {
    const items = this.connection
      .prepare(`
        SELECT
          si.item_role, si.position, si.review_round_id,
          si.answer, si.rating, si.feedback, si.completed_at,
          rr.round_number, rr.effective_due_on,
          se.*
        FROM session_items si
        JOIN source_entries se ON se.id = si.source_entry_id
        LEFT JOIN review_rounds rr ON rr.id = si.review_round_id
        WHERE si.session_id = ?
        ORDER BY si.position
      `)
      .all(String(row.id)) as SqlRow[];
    return {
      id: String(row.id),
      date: String(row.session_date),
      type: String(row.session_type) as SessionType,
      status: String(row.status) as StudySession["status"],
      theme: row.context_theme === null ? null : String(row.context_theme),
      passage: row.passage === null ? null : String(row.passage),
      referenceTranslation:
        row.reference_translation === null ? null : String(row.reference_translation),
      createdAt: String(row.created_at),
      completedAt: row.completed_at === null ? null : String(row.completed_at),
      items: items.map(
        (item): SessionItem => ({
          sourceEntry: sourceEntryFromRow(item),
          role: String(item.item_role) as SessionItem["role"],
          position: Number(item.position),
          reviewRoundId: item.review_round_id === null ? null : Number(item.review_round_id),
          roundNumber: item.round_number === null ? null : Number(item.round_number),
          dueOn: item.effective_due_on === null ? null : String(item.effective_due_on),
          answer: item.answer === null ? null : String(item.answer),
          rating: ratingOrNull(item.rating),
          feedback: item.feedback === null ? null : String(item.feedback),
          completedAt: item.completed_at === null ? null : String(item.completed_at),
        }),
      ),
    };
  }
}
