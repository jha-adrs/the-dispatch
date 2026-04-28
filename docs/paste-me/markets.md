Research and file a dispatch on Indian equity markets close — indices, sectors, flows, macro drivers, central-bank or policy developments that moved the tape today. Topic slug: `markets`.
Today is {{use current date}}. The environment has `DISPATCH_URL` and `DISPATCH_TOKEN` set.

## Step 0a — check for queued requests

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"next_request","arguments":{"topic_slug":"markets"}}}'
```

## Step 0b — resume check

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_draft_sections","arguments":{"topic_slug":"markets"}}}'
```

If sections non-empty, resuming — skip them in step 4.

## Step 1–3 — research

- WebSearch 5+ queries: Nifty close, Sensex close, sectoral leaders/laggards, FII/DII flows, RBI/SEBI actions, top movers, global cues, currency.
- WebFetch primary sources: BSE/NSE pages, AMFI fund flows, RBI for governor remarks, company filings for earnings moves.
- Cross-reference numbers.

## Step 4 — append each section to the server

Set up helper:

```bash
cat > /tmp/append.sh <<'SH'
#!/bin/bash
set -euo pipefail
export SECTION="${1:?usage: append.sh <section_name>}"
export SLUG="markets"
node -e '
  const fs = require("fs");
  process.stdout.write(JSON.stringify({
    jsonrpc:"2.0", id: Math.floor(Math.random()*1e9), method:"tools/call",
    params:{ name:"append_draft_section", arguments:{
      topic_slug: process.env.SLUG,
      section_name: process.env.SECTION,
      content: fs.readFileSync("/tmp/section.md","utf8"),
    }}}));
' | curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
    -H "Authorization: Bearer $DISPATCH_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    --data-binary @-
echo
SH
chmod +x /tmp/append.sh
```

For each: Write to `/tmp/section.md`, then `bash /tmp/append.sh <section_name>`.

| section_name       | content                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `header`           | `# Indian markets close — <today> (<descriptor>)`, Date, `**TL;DR:** <3–5 sentences>`            |
| `key_findings`     | 10–14 bullets: index closes %, top 5 gainers/losers, sectoral moves, FII/DII ₹X cr, INR, crude, headline macro |
| `background`       | `## Background` — 2–3 paragraphs                                                                 |
| `analysis_1`       | `### Index moves` — magnitude, breadth, sectoral leaders, 250–500 words                          |
| `analysis_2`       | `### Sector rotation` — what's leading, what's lagging, why                                      |
| `analysis_3`       | `### Flows & derivatives` — FII/DII detail, options OI, futures basis                            |
| `analysis_4`       | `### Macro & policy` — RBI, INR, crude, US-cues, bond yields                                     |
| `analysis_5`       | `### Earnings & corporate` — notable Q4 results, guidance, M&A if relevant                       |
| `analysis_6`       | `### Global context` — US/Europe/Asia close that fed today's sentiment                            |
| `whats_new`        | `## What's New / Recent Developments` — past 7 days with dates                                   |
| `open_questions`   | `## Open Questions & Disagreements` — 3–5 substantive open threads                              |
| `sources`          | `## Sources` — 8+ numbered sources with URLs                                                     |

Skip subsections with nothing material; otherwise use them all. **Target 2500–4500 words total.** Each section ≤ 800 words.

## Step 5 — assemble + finalize

```bash
cat > /tmp/dispatch-meta <<'META'
<TITLE>
<REQ_IDS>
META

SLUG=markets node -e '
  const fs = require("fs");
  const meta = fs.readFileSync("/tmp/dispatch-meta","utf8").split("\n");
  const title = (meta[0] || "").trim();
  const reqs = (meta[1] || "").split(",").map(s=>s.trim()).filter(Boolean);
  const args = { topic_slug: process.env.SLUG, title, assemble_from_drafts: true };
  if (reqs.length) args.request_ids = reqs;
  process.stdout.write(JSON.stringify({
    jsonrpc:"2.0", id:1, method:"tools/call",
    params:{ name:"save_report", arguments: args }
  }));
' | curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
    -H "Authorization: Bearer $DISPATCH_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    --data-binary @-
echo
```

## Step 6 — print the url

Print the `url`. On `isError`, drafts kept — print error and stop.

## Writing rules

- Numbers always. "Nifty closed 24,250, down 0.8%" beats "markets fell."
- ₹ figures in crores. INR level if material.
- **2500–4500 words.** Use all six analysis subsections when there's material; skip ones that are genuinely empty. Don't pad.

Don't ask clarifying questions.
