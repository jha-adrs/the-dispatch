import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL,
  title        TEXT NOT NULL,
  summary      TEXT,
  word_count   INTEGER NOT NULL,
  sources_json TEXT NOT NULL,
  received_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_slug_received
  ON reports(slug, received_at DESC);

CREATE TABLE IF NOT EXISTS requests (
  id                   TEXT PRIMARY KEY,
  slug                 TEXT NOT NULL,
  request_text         TEXT NOT NULL,
  submitted_at         TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','fulfilled','cancelled')),
  fulfilled_report_id  TEXT REFERENCES reports(id) ON DELETE SET NULL,
  fulfilled_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_requests_slug_status_submitted
  ON requests(slug, status, submitted_at);

CREATE TABLE IF NOT EXISTS draft_sections (
  slug        TEXT NOT NULL,
  day         TEXT NOT NULL,       -- YYYY-MM-DD UTC, groups sections from one run
  name        TEXT NOT NULL,       -- canonical section name (see SECTION_POSITIONS)
  position    INTEGER NOT NULL,    -- canonical ordering for assembly
  content     TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (slug, day, name)
);
CREATE INDEX IF NOT EXISTS idx_draft_sections_slug_day
  ON draft_sections(slug, day);
`;

// Canonical order used when assembling a report from drafts. Sections outside
// this map sort at the end (ordered by name) so new section types degrade
// gracefully without a schema change.
export const SECTION_POSITIONS = {
  header: 0,
  // Deep briefing body
  key_findings: 10,
  background: 20,
  analysis: 30,
  analysis_1: 31, analysis_2: 32, analysis_3: 33, analysis_4: 34, analysis_5: 35, analysis_6: 36,
  // World snapshot body
  geopolitics: 40,
  markets: 45,
  tech_science: 50,
  business_policy: 55,
  science_research: 58,
  future_trends: 60,
  finance_global: 62,
  regional_asia: 65,
  regional_africa: 66,
  regional_latam: 67,
  regional_mena: 68,
  offbeat: 70,
  one_to_read: 75,
  // Shared tail
  whats_new: 80,
  open_questions: 85,
  sources: 99,
};

export function positionFor(name) {
  if (name in SECTION_POSITIONS) return SECTION_POSITIONS[name];
  return 100; // unknown sections sort to the very end
}

export function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return buildApi(db);
}

function buildApi(db) {
  const stmts = {
    insertReport: db.prepare(`
      INSERT INTO reports (id, slug, title, summary, word_count, sources_json, received_at)
      VALUES (@id, @slug, @title, @summary, @word_count, @sources_json, @received_at)
    `),
    listRecent: db.prepare(`
      SELECT id, slug, title, received_at, word_count
      FROM reports
      WHERE (@slug IS NULL OR slug = @slug)
      ORDER BY received_at DESC
      LIMIT @limit
    `),
    getReport: db.prepare(`
      SELECT id, slug, title, summary, word_count, sources_json, received_at
      FROM reports WHERE id = ?
    `),
    countReports: db.prepare(`SELECT COUNT(*) AS n FROM reports`),
    slugSummary: db.prepare(`
      SELECT slug, COUNT(*) AS count, MAX(received_at) AS latest
      FROM reports GROUP BY slug ORDER BY latest DESC
    `),
    reportsPage: db.prepare(`
      SELECT id, slug, title, summary, received_at, word_count
      FROM reports
      WHERE (@slug IS NULL OR slug = @slug)
      ORDER BY received_at DESC
      LIMIT @limit OFFSET @offset
    `),

    insertRequest: db.prepare(`
      INSERT INTO requests (id, slug, request_text, submitted_at, status)
      VALUES (@id, @slug, @request_text, @submitted_at, 'pending')
    `),
    pendingRequestsForSlug: db.prepare(`
      SELECT id, slug, request_text, submitted_at
      FROM requests
      WHERE slug = ? AND status = 'pending'
      ORDER BY submitted_at ASC
    `),
    getRequest: db.prepare(`SELECT * FROM requests WHERE id = ?`),
    cancelRequest: db.prepare(`
      UPDATE requests SET status = 'cancelled'
      WHERE id = ? AND status = 'pending'
    `),
    fulfillRequest: db.prepare(`
      UPDATE requests
      SET status = 'fulfilled',
          fulfilled_report_id = @report_id,
          fulfilled_at = @fulfilled_at
      WHERE id = @id AND status = 'pending' AND slug = @slug
    `),
    listRequests: db.prepare(`
      SELECT id, slug, request_text, submitted_at, status, fulfilled_report_id, fulfilled_at
      FROM requests
      WHERE (@status IS NULL OR status = @status)
        AND (@slug IS NULL OR slug = @slug)
      ORDER BY submitted_at DESC
      LIMIT @limit
    `),

    // Draft sections — incremental persistence so partial work survives
    // session timeouts. Key (slug, day, name); UPSERT rewrites content.
    upsertDraft: db.prepare(`
      INSERT INTO draft_sections (slug, day, name, position, content, updated_at)
      VALUES (@slug, @day, @name, @position, @content, @updated_at)
      ON CONFLICT(slug, day, name) DO UPDATE SET
        content = excluded.content,
        position = excluded.position,
        updated_at = excluded.updated_at
    `),
    listDrafts: db.prepare(`
      SELECT name, position, updated_at, substr(content, 1, 200) AS content_preview
      FROM draft_sections
      WHERE slug = @slug AND day = @day
      ORDER BY position ASC, name ASC
    `),
    readDraftsForAssembly: db.prepare(`
      SELECT name, content, position
      FROM draft_sections
      WHERE slug = @slug AND day = @day
      ORDER BY position ASC, name ASC
    `),
    clearDrafts: db.prepare(`
      DELETE FROM draft_sections
      WHERE slug = @slug AND day = @day
    `),
    staleDraftDays: db.prepare(`
      SELECT slug, day, MAX(updated_at) AS last_update
      FROM draft_sections
      GROUP BY slug, day
      HAVING last_update < @cutoff
    `),
  };

  const saveReportWithRequests = db.transaction((reportRow, requestIds, { clearDraftsFor } = {}) => {
    stmts.insertReport.run(reportRow);
    const fulfilled = [];
    if (requestIds && requestIds.length) {
      const fulfilled_at = reportRow.received_at;
      for (const rid of requestIds) {
        const info = stmts.fulfillRequest.run({
          id: rid,
          slug: reportRow.slug,
          report_id: reportRow.id,
          fulfilled_at,
        });
        if (info.changes !== 1) {
          throw new Error(
            `request ${rid} is not pending or does not belong to slug "${reportRow.slug}"`
          );
        }
        fulfilled.push(rid);
      }
    }
    if (clearDraftsFor) {
      stmts.clearDrafts.run(clearDraftsFor);
    }
    return fulfilled;
  });

  return {
    raw: db,
    stmts,
    close: () => db.close(),
    saveReportWithRequests,
  };
}

// UTC day in YYYY-MM-DD. Used to key draft_sections so a run spanning
// midnight still assembles correctly on the day it was started.
export function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
