import { randomBytes } from 'node:crypto';

const TOKEN_RE = /^[a-f0-9]{32}$/;
const COLLISION_RETRIES = 1; // unique index guarantees safety; one retry is plenty

function generateToken() {
  return randomBytes(16).toString('hex');
}

/**
 * Mint a share token for the report. Returns the existing token if one is
 * already set (so re-clicking "Share" is idempotent). Returns null if the
 * report does not exist.
 */
export function mintShareToken(db, reportId) {
  const row = db.stmts.getReport.get(reportId);
  if (!row) return null;
  if (row.share_token) return row.share_token;

  let lastError;
  for (let attempt = 0; attempt <= COLLISION_RETRIES; attempt++) {
    const token = generateToken();
    try {
      db.stmts.setShareToken.run({ id: reportId, token });
      return token;
    } catch (e) {
      lastError = e;
      // UNIQUE constraint — vanishingly unlikely with 128-bit tokens. Retry once.
    }
  }
  throw new Error(`could not mint share token after retries: ${lastError?.message}`);
}

/**
 * Clear the share token for a report. Idempotent. Returns true if the report
 * exists, false otherwise.
 */
export function clearShareTokenFor(db, reportId) {
  if (!db.stmts.getReport.get(reportId)) return false;
  db.stmts.clearShareToken.run({ id: reportId });
  return true;
}

/**
 * Resolve a share token to its report row. Returns null on malformed input,
 * unknown token, or revoked token. Never throws.
 */
export function lookupByShareToken(db, token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const row = db.stmts.getReportByShareToken.get(token);
  return row ?? null;
}
