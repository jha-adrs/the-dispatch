Research and file a dispatch on the tech & AI industry — launches, funding, regulatory moves, model releases, major leaks, M&A. Topic slug: `tech-ai`.
Today is {{use current date}}. The environment has `DISPATCH_URL` and `DISPATCH_TOKEN` set.

## Step 0 — check for queued requests

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"next_request","arguments":{"topic_slug":"tech-ai"}}}'
```

Parse `result.content[0].text` as JSON. Weave pending items in; keep ids for step 5.

## Step 1–3 — research

- WebSearch 6+ queries: "AI model release {today}", "tech IPO {today}", "AI regulation {today}", "OpenAI Anthropic Google DeepMind Meta {today}", plus anything specific surfacing in results.
- WebFetch 3–6 primary sources in full — lab blogs (openai.com, anthropic.com, deepmind.google/blog, ai.meta.com), official filings (SEC, EU Commission), trade press (The Information, FT, Bloomberg wire). Not aggregators.
- Cross-reference; flag where outlets report different numbers.

## Step 4 — write to /tmp/dispatch.md

```
# {descriptive title — the biggest thing that happened}

**Date:** {today}
**TL;DR:**

## Key Findings
- 5–8 bullets with company names, figures, dates

## Background

## Detailed Analysis
### Model & product releases
### Capital & deals
### Policy & regulation
### Workforce & org

## What's New / Recent Developments

## Open Questions & Disagreements

## Sources
1. {url} — {one-line}
```

1200–2500 words.

## Step 5 — file the dispatch

```bash
cat > /tmp/dispatch-meta <<'META'
<TITLE>
<REQ_IDS>
META

SLUG=tech-ai node -e '
  const fs = require("fs");
  const meta = fs.readFileSync("/tmp/dispatch-meta","utf8").split("\n");
  const title = (meta[0] || "").trim();
  const reqs = (meta[1] || "").split(",").map(s=>s.trim()).filter(Boolean);
  const args = {
    topic_slug: process.env.SLUG,
    title,
    markdown_body: fs.readFileSync("/tmp/dispatch.md","utf8"),
  };
  if (reqs.length) args.request_ids = reqs;
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "save_report", arguments: args }
  }));
' | curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
    -H "Authorization: Bearer $DISPATCH_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    --data-binary @-
echo
```

## Step 6 — print the url

Parse the response; print the `url` field. If `isError`, print the error and stop.

## Writing rules

- Company names in full on first mention. Dollar/euro figures with unit ($2.1B not "$2.1").
- Distinguish announcements from shipped products.
- When queued requests exist, address each one by name.
- 1200–2500 words.

Don't ask clarifying questions.
