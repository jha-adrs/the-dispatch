Research and file a dispatch on the tech & AI industry — launches, funding, regulatory moves, model releases, leaks, M&A. Topic slug: `tech-ai`.
Today is {{use current date}}. The environment has `DISPATCH_URL` and `DISPATCH_TOKEN` set.

## Step 0a — check for queued requests

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"next_request","arguments":{"topic_slug":"tech-ai"}}}'
```

## Step 0b — resume check

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_draft_sections","arguments":{"topic_slug":"tech-ai"}}}'
```

If sections non-empty, resuming — skip them in step 4.

## Step 1–3 — research

- WebSearch 6+ queries: "AI model release {today}", "tech IPO {today}", "AI regulation {today}", lab/big-co names + {today}, plus anything specific surfacing in results.
- WebFetch 3–6 primary sources: lab blogs (openai.com, anthropic.com, deepmind.google/blog, ai.meta.com), official filings (SEC, EU Commission), trade press (The Information, FT, Bloomberg). Not aggregators.
- Cross-reference; flag where outlets report different numbers.

## Step 4 — append each section to the server

Set up helper:

```bash
cat > /tmp/append.sh <<'SH'
#!/bin/bash
set -euo pipefail
export SECTION="${1:?usage: append.sh <section_name>}"
export SLUG="tech-ai"
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

| section_name      | content                                                                |
| ----------------- | ---------------------------------------------------------------------- |
| `header`          | `# <descriptive title — biggest thing today>`, Date, `**TL;DR:**`     |
| `key_findings`    | 5–8 bullets with company names, figures, dates                         |
| `background`      | `## Background`                                                        |
| `analysis_1`      | `### Model & product releases`                                         |
| `analysis_2`      | `### Capital & deals`                                                  |
| `analysis_3`      | `### Policy & regulation`                                              |
| `analysis_4`      | `### Workforce & org`                                                  |
| `whats_new`       | `## What's New / Recent Developments`                                  |
| `open_questions`  | `## Open Questions & Disagreements`                                    |
| `sources`         | `## Sources`                                                           |

Skip subsections with nothing material. Target 1200–2500 words total.

## Step 5 — assemble + finalize

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

- Company names in full on first mention. Dollar figures with unit ($2.1B not "$2.1").
- Distinguish announcements from shipped products.
- 1200–2500 words. Skip empty sections.

Don't ask clarifying questions.
