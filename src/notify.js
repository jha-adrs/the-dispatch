// Optional webhook notification fired once per successful save_report.
// Controlled by three env vars (all optional):
//   NOTIFY_WEBHOOK_URL      — where to POST
//   NOTIFY_WEBHOOK_TYPE     — ntfy | discord | slack | generic (default: generic)
//   NOTIFY_WEBHOOK_HEADERS  — JSON object of extra headers (e.g. auth)
//
// If NOTIFY_WEBHOOK_URL is unset, the notifier is a no-op. Notification
// failures are logged but never surface to the tool caller — a dispatch
// is still saved even if the push fails.

export function buildNotifier({ url, type = 'generic', headersJson } = {}) {
  if (!url) return { notify: async () => {}, enabled: false };

  let extraHeaders = {};
  if (headersJson) {
    try {
      extraHeaders = JSON.parse(headersJson);
    } catch {
      console.error('[notify] NOTIFY_WEBHOOK_HEADERS is not valid JSON — ignoring');
    }
  }

  const kind = String(type || 'generic').toLowerCase();

  return {
    enabled: true,
    type: kind,
    async notify(report) {
      try {
        const { body, headers } = buildPayload(kind, report, extraHeaders);
        const res = await fetch(url, { method: 'POST', headers, body });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          console.error(`[notify] ${kind} webhook returned ${res.status}: ${text.slice(0, 200)}`);
        }
      } catch (e) {
        console.error('[notify] webhook error:', e.message);
      }
    },
  };
}

function buildPayload(type, r, extra) {
  const { id, url, slug, title, summary, word_count } = r;

  if (type === 'ntfy') {
    // ntfy.sh convention: plain-text body, metadata in headers.
    // HTTP header values must be Latin-1 — em-dashes, smart quotes, arrows,
    // ₹ etc. will throw "Cannot convert to ByteString". Sanitize before send.
    return {
      body: summary || 'New dispatch filed.',
      headers: {
        'Title': asciiHeader(`${slug}: ${title}`),
        'Click': url,
        'Priority': 'default',
        'Tags': 'newspaper',
        ...extra,
      },
    };
  }

  if (type === 'discord') {
    return {
      body: JSON.stringify({
        username: 'The Dispatch',
        embeds: [
          {
            title: title.slice(0, 256),
            description: (summary || '').slice(0, 2000),
            url,
            color: 0xb8290c,
            footer: { text: `${slug} · ${word_count} words` },
            timestamp: new Date().toISOString(),
          },
        ],
      }),
      headers: { 'Content-Type': 'application/json', ...extra },
    };
  }

  if (type === 'slack') {
    return {
      body: JSON.stringify({
        text: `*<${url}|${title}>*\n${summary || ''}\n\`${slug}\` · ${word_count} words`,
      }),
      headers: { 'Content-Type': 'application/json', ...extra },
    };
  }

  // generic: raw JSON of the report fields
  return {
    body: JSON.stringify({ id, url, slug, title, summary, word_count }),
    headers: { 'Content-Type': 'application/json', ...extra },
  };
}

function asciiHeader(s) {
  return String(s)
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/•/g, '*')
    .replace(/₹/g, 'INR ')
    .replace(/€/g, 'EUR ')
    .replace(/£/g, 'GBP ')
    .replace(/[→➔]/g, '->')
    .replace(/[←]/g, '<-')
    .replace(/×/g, 'x')
    // strip anything else above ASCII
    .replace(/[^\x20-\x7E]/g, '');
}
