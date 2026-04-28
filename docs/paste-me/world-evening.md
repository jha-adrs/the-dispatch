You're filing a short world-snapshot briefing — the evening edition. Topic slug: `world-evening`.
Today is {{use current date}}. The environment has `DISPATCH_URL` and `DISPATCH_TOKEN` set.

## Step 0a — check for queued requests

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"next_request","arguments":{"topic_slug":"world-evening"}}}'
```

Parse `result.content[0].text` as JSON. Pending items become priority angles; keep their ids for step 5.

## Step 0b — resume check

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_draft_sections","arguments":{"topic_slug":"world-evening"}}}'
```

If `sections` is non-empty, you are resuming. Skip those names in step 4.

## Step 1 — research

WebSearch (8–12 queries): "Asia close today", "US markets midday", "world news today", "geopolitics today", regional queries (Africa, LatAm, MENA), "science research today", "global finance today", "future trends today". End-of-day perspective: Asian close + US midday + late-breaking geopolitics.

## Step 2 — fetch

WebFetch 4–7 primary sources spanning regions and topics. Reuters/AP/FT/Bloomberg PLUS Nikkei or Caixin (Asia), Africa News or AllAfrica, Folha or Reforma (LatAm), Al Jazeera or Asharq (MENA), arXiv/Nature for science, central bank statements for finance. Not aggregators.

## Step 3 — cross-reference

Note disagreements.

## Step 4 — append each section to the server

Set up the helper once:

```bash
cat > /tmp/append.sh <<'SH'
#!/bin/bash
set -euo pipefail
export SECTION="${1:?usage: append.sh <section_name>}"
export SLUG="world-evening"
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

For each section: **Write** tool puts the section's markdown (including `## Heading`) into `/tmp/section.md`, then `bash /tmp/append.sh <section_name>`.

| Order | section_name       | What it contains                                                              |
| ----- | ------------------ | ----------------------------------------------------------------------------- |
| 1     | `header`           | `# World evening — <date>`, `**Date:** <today>`, `**TL;DR:** <1–2 sentences>` |
| 2     | `geopolitics`      | `## Geopolitics` + specific bullets                                           |
| 3     | `regional_asia`    | `## Asia` — Asian close commentary                                            |
| 4     | `regional_africa`  | `## Africa` — 2–3 bullets                                                     |
| 5     | `regional_latam`   | `## Latin America` — 2–3 bullets                                              |
| 6     | `regional_mena`    | `## Middle East & North Africa`                                               |
| 7     | `markets`          | `## Markets` — closes, FX, commodities                                        |
| 8     | `finance_global`   | `## Global finance` — central banks, debt, capital flows                      |
| 9     | `tech_science`     | `## Tech` — launches, releases                                                |
| 10    | `science_research` | `## Science & research` — papers, findings                                    |
| 11    | `future_trends`    | `## Future trends` — durable signals                                          |
| 12    | `business_policy`  | `## Business & policy` — regulation, M&A                                      |
| 13    | `offbeat`          | `## Offbeat` — odd/specific picks                                             |
| 14    | `one_to_read`      | `## One to read` — single longread + link                                     |
| 15    | `sources`          | `## Sources` — numbered                                                       |

Skip categories with nothing material. **25–35+ items total**, most bullets one tight sentence (some 2–3 when context helps). **Target 1200–2000 words.**

## Step 5 — assemble + finalize

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

Parse the response; print the `url`. On `isError`, drafts are kept for next run — print the error and stop.

## Writing rules

- Each bullet has a specific (number/name/place/time).
- Skim-breadth: **25–35+ items**, most one sentence; some 2–3 when context helps.
- Skip empty categories.
- Don't invent.
- **1200–2000 words total.**

Don't ask clarifying questions.
