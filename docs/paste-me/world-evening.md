You're filing a short world-snapshot briefing — the evening edition. Topic slug: `world-evening`.
Today is {{use current date}}. The environment has `DISPATCH_URL` and `DISPATCH_TOKEN` set.

## Step 0 — check for queued requests

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"next_request","arguments":{"topic_slug":"world-evening"}}}'
```

Parse `result.content[0].text` as JSON (array of `{id, request_text, submitted_at}`). Weave pending items in; keep ids for step 5.

## Step 1 — research

WebSearch aggressively (6–10 queries): "Asia close {today}", "US markets midday {today}", "world news today", "geopolitics {today}", plus topic-specific queries as leads emerge.

## Step 2 — fetch

WebFetch 3–5 primary sources (Reuters, AP, FT, WSJ, Bloomberg wire, official statements). Not aggregators.

## Step 3 — cross-reference

Note where sources disagree.

## Step 4 — write to /tmp/dispatch.md

```
# World evening — {date}

**Date:** {today}
**TL;DR:** {1–2 sentences.}

## Geopolitics
- ...

## Markets
- ...

## Tech & science
- ...

## Business & policy
- ...

## One to read
One paragraph + link.

## Sources
1. {url} — {one-line}
```

Tight: 400–700 words. Drop empty categories.

## Step 5 — file the dispatch

```bash
cat > /tmp/dispatch-meta <<'META'
<TITLE>
<REQ_IDS>
META

SLUG=world-evening node -e '
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

Parse the response. `result.content[0].text` is JSON; print its `url` field. If `isError`, print the error and stop.

## Writing rules

- 400–700 words. If past 800, cut.
- Specifics in every bullet (number, name, place, timestamp).
- Drop empty categories. Don't pad.
- Never quote more than a short phrase.
- Don't invent.

Don't ask clarifying questions.
