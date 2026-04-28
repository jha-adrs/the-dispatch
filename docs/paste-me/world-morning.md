You're filing a short world-snapshot briefing — the morning edition. Topic slug: `world-morning`.
Today is {{use current date}}. The environment has `DISPATCH_URL` and `DISPATCH_TOKEN` set.

## Step 0a — check for queued requests

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"next_request","arguments":{"topic_slug":"world-morning"}}}'
```

Parse `result.content[0].text` as JSON. Pending items become priority angles; keep their ids for step 5.

## Step 0b — resume check

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_draft_sections","arguments":{"topic_slug":"world-morning"}}}'
```

Parse `result.content[0].text` as JSON: `{day, sections}`. If `sections` is non-empty, you are **resuming** a previous run that timed out. Skip any section name listed there in step 4 — write only the missing ones.

## Step 1 — research

WebSearch aggressively (8–12 queries): "world news overnight", "US markets close last night", "Europe news overnight", "Asia open today", "geopolitics today", regional queries (Africa, LatAm, MENA), "science research today", "global finance today", "future trends today". Mix Western wires with regional sources.

## Step 2 — fetch

WebFetch 4–7 primary sources spanning regions and topics. Reuters/AP/FT/Bloomberg are fine but **also** include: Nikkei or Caixin (Asia), Africa News or AllAfrica, Folha or Reforma (LatAm), Al Jazeera or Asharq (MENA), arXiv/Nature for science, central bank statements for finance. Not aggregators.

## Step 3 — cross-reference

Note where sources disagree.

## Step 4 — append each section to the server

**Why this pattern**: each section is persisted on the server the moment you append it. If the stream times out mid-run, the next run picks up the missing sections via step 0b. Do **NOT** write the whole briefing into one Bash heredoc — that's what timed out before.

First, set up a tiny helper (one Bash call):

```bash
cat > /tmp/append.sh <<'SH'
#!/bin/bash
set -euo pipefail
export SECTION="${1:?usage: append.sh <section_name>}"
export SLUG="world-morning"
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

Then **for each section**:
1. Use the **Write** tool to put just that section's full markdown (including its `## Heading`) into `/tmp/section.md`.
2. Run `bash /tmp/append.sh <section_name>`.
3. Move on.

Section names to use (exactly these, server rejects others). Each section is its own pair of `Write /tmp/section.md` + `bash /tmp/append.sh`. Skip any section that has nothing material — drop the whole pair.

| Order | section_name      | What it contains                                                                  |
| ----- | ----------------- | --------------------------------------------------------------------------------- |
| 1     | `header`          | `# World morning — <date>`, `**Date:** <today>`, `**TL;DR:** <1–2 sentences>`     |
| 2     | `geopolitics`     | `## Geopolitics` + bullets. Each bullet has a name, place, time, or number.       |
| 3     | `regional_asia`   | `## Asia` — what moved in Asian capitals overnight. 2–4 specific bullets.         |
| 4     | `regional_africa` | `## Africa` — 2–3 bullets from African press / official sources.                  |
| 5     | `regional_latam`  | `## Latin America` — 2–3 bullets.                                                 |
| 6     | `regional_mena`   | `## Middle East & North Africa` — 2–3 bullets.                                    |
| 7     | `markets`         | `## Markets` — index closes, FX, commodities with figures.                        |
| 8     | `finance_global`  | `## Global finance` — central banks, sovereign debt, capital flows. 2–4 bullets.  |
| 9     | `tech_science`    | `## Tech` — product launches, model releases, big announcements.                  |
| 10    | `science_research`| `## Science & research` — interesting papers/findings (arXiv, Nature, etc).       |
| 11    | `future_trends`   | `## Future trends` — durable signals, not noise. 2–3 forward-looking bullets.     |
| 12    | `business_policy` | `## Business & policy` — regulation, M&A, big-co moves.                            |
| 13    | `offbeat`         | `## Offbeat` — 1–2 odd/specific stories most aggregators missed.                  |
| 14    | `one_to_read`     | `## One to read` — single longread / cultural piece, one paragraph + link.        |
| 15    | `sources`         | `## Sources` — numbered, full URLs, one-line description each.                    |

Aim for **25–35+ items total across all sections** with **most bullets being one tight sentence (some can be 2–3)**. **Target 1200–2000 words across the whole brief.** Skim-breadth with enough specificity per item to be useful — names, numbers, places, timestamps in every bullet.

## Step 5 — assemble + finalize

```bash
cat > /tmp/dispatch-meta <<'META'
<TITLE — same as the # title line in your header section, without the leading '# '>
<comma-separated req_ids from step 0a, or leave empty>
META

SLUG=world-morning node -e '
  const fs = require("fs");
  const meta = fs.readFileSync("/tmp/dispatch-meta","utf8").split("\n");
  const title = (meta[0] || "").trim();
  const reqs = (meta[1] || "").split(",").map(s=>s.trim()).filter(Boolean);
  const args = {
    topic_slug: process.env.SLUG,
    title,
    assemble_from_drafts: true,
  };
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

Parse the response. `result.content[0].text` is JSON; print its `url` field. If `isError`, the server kept the drafts intact for the next run — print the error and stop.

## Writing rules

- Each bullet has at least one specific: a number, a name, a place, a timestamp.
- Skim-breadth over depth. **Aim for 25–35+ items across categories.** Most bullets one tight sentence; some 2–3 when context helps.
- Skip empty categories — don't pad them.
- Don't invent. If you can't verify, skip.
- Never quote more than a short phrase.
- **1200–2000 words total.**

Don't ask clarifying questions.
