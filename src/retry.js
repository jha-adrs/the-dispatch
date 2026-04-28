// Layer 2 — auto-retry daemon for stale drafts.
//
// Periodically scans draft_sections for (slug, day) groups whose newest
// section is older than RETRY_AFTER_MINUTES with no finalized report,
// and POSTs the routine's /fire endpoint to resume it.
//
// Disabled when ROUTINE_FIRE_MAP is empty/unset — buildRetry returns a
// stub that does nothing on tick().

const FIRE_BETA_HEADER = 'experimental-cc-routine-2026-04-01';
const ANTHROPIC_VERSION = '2023-06-01';

export function parseFireMap(json) {
  if (!json || typeof json !== 'string') return {};
  try {
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== 'object') return {};
    const out = {};
    for (const [slug, val] of Object.entries(obj)) {
      if (val && typeof val === 'object' && val.url && val.token) {
        out[slug] = { url: String(val.url), token: String(val.token) };
      }
    }
    return out;
  } catch {
    console.error('[retry] ROUTINE_FIRE_MAP is not valid JSON — ignoring');
    return {};
  }
}

export function buildRetry({
  db,
  fireMap = {},
  retryAfterMinutes = 60,
  maxRetriesPerDay = 2,
  intervalMs = 5 * 60 * 1000,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
} = {}) {
  const enabled = Object.keys(fireMap).length > 0;

  async function fireOne(slug, day, sectionCount) {
    const cfg = fireMap[slug];
    if (!cfg) return; // no /fire mapping — skip silently

    const already = db.stmts.countFiresForDay.get({ slug, day }).n;
    if (already >= maxRetriesPerDay) {
      console.log(
        `[retry] cap reached for ${slug} ${day} (${already}/${maxRetriesPerDay}) — not firing`
      );
      return;
    }

    const fired_at = now().toISOString();
    let ok = false;
    let detail = '';
    try {
      const res = await fetchImpl(cfg.url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.token}`,
          'Content-Type': 'application/json',
          'anthropic-beta': FIRE_BETA_HEADER,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          text: `resume: draft-in-progress (${sectionCount} sections written, slug=${slug}, day=${day})`,
        }),
      });
      const body = await res.text().catch(() => '');
      ok = res.ok;
      detail = ok
        ? extractSessionId(body) || `HTTP ${res.status}`
        : `HTTP ${res.status}: ${body.slice(0, 200)}`;
    } catch (e) {
      detail = `fetch error: ${e.message}`;
    }

    db.stmts.insertRetryFire.run({ slug, day, fired_at, ok: ok ? 1 : 0, detail });
    console.log(
      `[retry] ${slug} ${day} fire #${already + 1}/${maxRetriesPerDay} → ${ok ? 'ok' : 'fail'} (${detail})`
    );
  }

  async function tick() {
    if (!enabled) return { fired: 0, candidates: 0 };
    const cutoff = new Date(now().getTime() - retryAfterMinutes * 60 * 1000).toISOString();
    const candidates = db.stmts.staleDraftDays.all({ cutoff });
    let fired = 0;
    for (const row of candidates) {
      if (!fireMap[row.slug]) continue; // we don't know how to fire this slug
      await fireOne(row.slug, row.day, row.section_count);
      fired += 1;
    }
    return { fired, candidates: candidates.length };
  }

  let timer = null;
  function start() {
    if (!enabled || timer) return;
    timer = setInterval(() => {
      tick().catch((e) => console.error('[retry] tick error:', e));
    }, intervalMs);
    if (timer.unref) timer.unref(); // don't block process exit
    console.log(
      `[retry] daemon active — every ${Math.round(intervalMs / 1000)}s, ` +
        `slugs=[${Object.keys(fireMap).join(',')}], retry_after=${retryAfterMinutes}m, ` +
        `cap=${maxRetriesPerDay}/day`
    );
  }
  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { enabled, tick, start, stop };
}

function extractSessionId(body) {
  // /fire returns { type, claude_code_session_id, claude_code_session_url }
  try {
    const parsed = JSON.parse(body);
    return parsed.claude_code_session_id || parsed.claude_code_session_url || null;
  } catch {
    return null;
  }
}
