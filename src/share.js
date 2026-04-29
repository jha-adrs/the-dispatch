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

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Escape only the </script sequence — keeps the markdown readable inside
// <script type="text/markdown"> while preventing breakout.
function escapeForScriptTag(s) {
  return String(s).replace(/<\/script/gi, '<\\/script');
}

function fmtFiledDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

const SHARE_PAGE_CSS = `
  :root {
    --paper:#f4ede1; --ink:#111; --red:#b8290c; --muted:#6a6358;
    --serif:'Fraunces','Georgia',serif; --sans:'Inter',-apple-system,sans-serif;
    --mono:'JetBrains Mono','Menlo',monospace;
  }
  *{box-sizing:border-box} html,body{margin:0;padding:0}
  body{background:var(--paper);background-image:radial-gradient(rgba(0,0,0,.035) 1px,transparent 1px);background-size:4px 4px;color:var(--ink);font-family:var(--sans);min-height:100vh}
  .page{max-width:760px;margin:0 auto;padding:28px 28px 80px}
  .masthead{border-top:2px solid #1a1a1a}
  .masthead-top{display:flex;justify-content:space-between;align-items:baseline;font-family:var(--sans);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);padding:10px 2px}
  .masthead-rule{height:1px;background:#1a1a1a}
  .masthead-title{text-align:center;font-family:var(--serif);font-weight:800;font-size:clamp(40px,8vw,90px);line-height:1;letter-spacing:-.02em;padding:18px 0}
  .masthead-title em{color:var(--red);font-style:italic;font-weight:800}
  .actions{display:flex;gap:18px;font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.15em;padding:14px 2px;border-bottom:1px solid rgba(0,0,0,.2)}
  .actions a{color:var(--ink);text-decoration:none;border-bottom:1px dotted rgba(0,0,0,.4);padding-bottom:1px}
  .article{font-family:var(--serif);font-size:18px;line-height:1.65;padding:32px 0}
  .article h1{font-weight:800;font-size:38px;line-height:1.1;margin:0 0 14px;letter-spacing:-.015em}
  .article h2{font-weight:800;font-style:italic;color:var(--red);font-size:26px;margin:36px 0 10px}
  .article h3{font-weight:600;font-size:20px;margin:24px 0 8px}
  .article p{margin:0 0 16px}
  .article a{color:var(--red);text-decoration:underline;text-underline-offset:2px}
  .article blockquote{border-left:3px solid var(--red);margin:18px 0;padding:2px 0 2px 18px;font-style:italic;color:#3a342a}
  .article hr{border:none;border-top:1px dashed rgba(0,0,0,.4);margin:28px 0}
  .article code{font-family:var(--mono);font-size:.88em;background:rgba(0,0,0,.06);padding:1px 5px}
  .article pre{background:rgba(0,0,0,.06);padding:14px 18px;overflow-x:auto}
  .article pre code{background:transparent;padding:0;font-size:14px;line-height:1.5}
  .article ul,.article ol{padding-left:22px;margin:0 0 16px}
  .article li{margin-bottom:6px}
  .article strong{font-weight:800}
  .footer{font-family:var(--serif);font-style:italic;color:var(--muted);font-size:14px;padding:24px 0;border-top:1px dashed rgba(0,0,0,.4);margin-top:32px;text-align:center}
  .empty{text-align:center;padding:80px 20px;font-family:var(--serif);font-style:italic;color:var(--muted);font-size:20px}
`;

const FONTS_LINK = `<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,600;0,9..144,800;1,9..144,800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">`;

export function renderSharePage({ report, markdown, publicBaseUrl }) {
  const base = String(publicBaseUrl).replace(/\/+$/, '');
  const url = `${base}/s/${report.share_token}`;
  const titleEsc = escapeHtml(report.title);
  const descRaw = (report.summary || '').slice(0, 200);
  const descEsc = escapeHtml(descRaw);
  const filedDate = fmtFiledDate(report.received_at);
  const host = base.replace(/^https?:\/\//, '');
  const mdSafe = escapeForScriptTag(markdown);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${titleEsc} · The Dispatch</title>

<meta property="og:title" content="${titleEsc}">
<meta property="og:description" content="${descEsc}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="The Dispatch">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${titleEsc}">
<meta name="twitter:description" content="${descEsc}">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${FONTS_LINK}
<style>${SHARE_PAGE_CSS}</style>
</head>
<body>
<div class="page">
  <header class="masthead">
    <div class="masthead-top">
      <span>${escapeHtml(filedDate.toUpperCase())}</span>
      <span>Shared dispatch</span>
    </div>
    <div class="masthead-rule"></div>
    <h1 class="masthead-title">The <em>Dispatch</em></h1>
    <div class="masthead-rule"></div>
  </header>

  <div class="actions">
    <a href="/s/${report.share_token}/pdf">⬇ PDF</a>
    <a href="/s/${report.share_token}/md">Markdown</a>
    <a href="${escapeHtml(base)}" style="margin-left:auto">← The Dispatch</a>
  </div>

  <article class="article" id="article"></article>

  <footer class="footer">
    Filed by Claude on ${escapeHtml(filedDate)} · ${escapeHtml(host)}
  </footer>
</div>

<script id="md" type="text/markdown">${mdSafe}</script>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script>
  (function(){
    var src = document.getElementById('md').textContent;
    document.getElementById('article').innerHTML = window.marked.parse(src);
  })();
</script>
</body>
</html>`;
}

export function shareApiHandlers({ db, publicBaseUrl }) {
  const base = String(publicBaseUrl).replace(/\/+$/, '');
  return {
    create(req, res) {
      const id = req.params?.id;
      const token = mintShareToken(db, id);
      if (token === null) {
        return res.status(404).json({ error: 'report not found' });
      }
      return res.status(200).json({ token, url: `${base}/s/${token}` });
    },
    revoke(req, res) {
      const id = req.params?.id;
      const ok = clearShareTokenFor(db, id);
      if (!ok) {
        return res.status(404).json({ error: 'report not found' });
      }
      return res.status(200).json({ revoked: true });
    },
  };
}

export function publicShareHandlers({ db, archive, publicBaseUrl }) {
  return {
    html(req, res) {
      const token = req.params?.token;
      const row = lookupByShareToken(db, token);
      res.setHeader('X-Robots-Tag', 'noindex,nofollow');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (!row) {
        return res.status(404).send(renderRevokedPage({ publicBaseUrl }));
      }
      const markdown = archive.readMarkdown(row.id);
      if (markdown === null) {
        return res.status(410).send(renderRevokedPage({ publicBaseUrl }));
      }
      return res.status(200).send(renderSharePage({ report: row, markdown, publicBaseUrl }));
    },
    pdf(req, res) {
      res.setHeader('X-Robots-Tag', 'noindex,nofollow');
      const token = req.params?.token;
      const row = lookupByShareToken(db, token);
      if (!row) return res.status(404).send('not found');
      const pdf = archive.readPdf(row.id);
      if (!pdf) return res.status(410).send('archive missing');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${row.id}.pdf"`);
      return res.send(pdf);
    },
    md(req, res) {
      res.setHeader('X-Robots-Tag', 'noindex,nofollow');
      const token = req.params?.token;
      const row = lookupByShareToken(db, token);
      if (!row) return res.status(404).send('not found');
      const markdown = archive.readMarkdown(row.id);
      if (markdown === null) return res.status(410).send('archive missing');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="${row.id}.md"`);
      return res.send(markdown);
    },
  };
}

export function renderRevokedPage({ publicBaseUrl }) {
  const base = String(publicBaseUrl).replace(/\/+$/, '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Link no longer active · The Dispatch</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${FONTS_LINK}
<style>${SHARE_PAGE_CSS}</style>
</head>
<body>
<div class="page">
  <header class="masthead">
    <div class="masthead-rule"></div>
    <h1 class="masthead-title">The <em>Dispatch</em></h1>
    <div class="masthead-rule"></div>
  </header>
  <div class="empty">Link no longer active.</div>
  <footer class="footer">
    <a href="${escapeHtml(base)}" style="color:var(--muted)">← The Dispatch</a>
  </footer>
</div>
</body>
</html>`;
}
