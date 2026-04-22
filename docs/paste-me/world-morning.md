You're filing a short world-snapshot briefing — the morning edition. Topic slug: `world-morning`.
Today is {{use current date}}. The environment has `DISPATCH_URL` and `DISPATCH_TOKEN` set.

## Step 0 — check for queued requests

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"next_request","arguments":{"topic_slug":"world-morning"}}}'
```

Parse the response's `result.content[0].text` as JSON — it's an array of `{id, request_text, submitted_at}`. If non-empty, weave each `request_text` into the research focus and keep the ids for step 5.

## Step 1 — research

WebSearch aggressively (6–10 queries): "world news overnight", "US markets close last night", "Europe news overnight", "geopolitics {today}", "Asia open {today}", plus topic-specific queries as leads emerge.

## Step 2 — fetch

WebFetch 3–5 primary sources in full (Reuters, AP, FT, WSJ, Bloomberg wire, official gov/central-bank statements). Not aggregators.

## Step 3 — cross-reference

Note where sources disagree.

## Step 4 — write to /tmp/dispatch.md

Skeleton:

```
# World morning — {date, e.g. "22 April 2026"}

**Date:** {today}
**TL;DR:** {1–2 sentences. The single most important thing that happened overnight.}

## Geopolitics
- specific bullet with names, places, numbers
- ...

## Markets
- index levels, FX moves, commodity moves with figures
- ...

## Tech & science
- ...

## Business & policy
- ...

## One to read
A single human-interest / long-read / deeply-reported piece from the last 24h. One paragraph summary + link.

## Sources
1. {url} — {one-line description}
...
```

Tight: 400–700 words. If a category had nothing material, drop the whole section — don't pad.

## Step 5 — file the dispatch

Write the title (first line, no leading `# `) and queued request ids (second line, CSV or empty) to `/tmp/dispatch-meta`, then post:

```bash
# Replace <TITLE> with your actual title line (same as the '# ' heading but without the '# ').
# Replace <REQ_IDS> with the comma-separated ids from step 0, or leave the second line blank.
cat > /tmp/dispatch-meta <<'META'
<TITLE>
<REQ_IDS>
META

SLUG=world-morning node -e '
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

Parse the curl response. `result.content[0].text` is JSON with `{id, url, word_count, sources_count, fulfilled_request_ids}`. Print the `url` field — that's my read link. If `isError` is true, print the error message from `content[0].text` and stop.

## Writing rules

- Each bullet has at least one specific — a number, a name, a place, a timestamp. "Tensions rose" is not a bullet. "Iran-backed Houthi forces struck a Greek-owned tanker in the Red Sea at 03:10 GMT" is.
- Never quote more than a short phrase.
- If a category has nothing, drop the whole section.
- Don't invent. If you can't verify, skip.
- 400–700 words. If past 800, cut.

Don't ask clarifying questions — I'm not watching this run.
