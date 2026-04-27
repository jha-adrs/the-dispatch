Research and file a dispatch on new agent frameworks, evals, scaffolds, and notable papers in agent engineering. Topic slug: `agent-engineering`.
Today is {{use current date}}. The environment has `DISPATCH_URL` and `DISPATCH_TOKEN` set.

## Step 0a — check for queued requests

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"next_request","arguments":{"topic_slug":"agent-engineering"}}}'
```

Parse JSON. Pending items become priority angles; keep ids for step 5.

## Step 0b — resume check

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_draft_sections","arguments":{"topic_slug":"agent-engineering"}}}'
```

If `sections` is non-empty, you are resuming. Skip those names in step 4.

## Step 1–3 — research

- WebSearch 5+ queries, last 14 days, authoritative sources.
- WebFetch 3–6 primary sources in full (lab blogs, papers, official repos — not aggregators).
- Cross-reference; note disagreements.

## Step 4 — append each section to the server

**Why this pattern**: each section is persisted on the server the moment you append it. Stream timeouts at most cost the section currently being generated. **Do NOT inline the whole briefing into one Bash heredoc** — that's what timed out before.

Set up the helper once:

```bash
cat > /tmp/append.sh <<'SH'
#!/bin/bash
set -euo pipefail
export SECTION="${1:?usage: append.sh <section_name>}"
export SLUG="agent-engineering"
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

For each section: **Write** tool puts that section's markdown (including its `##` or `###` heading) into `/tmp/section.md`, then `bash /tmp/append.sh <section_name>`.

| Order | section_name      | What it contains                                                                  |
| ----- | ----------------- | --------------------------------------------------------------------------------- |
| 1     | `header`          | `# <descriptive title>`, `**Date:** <today>`, `**TL;DR:** <2–3 sentences>`        |
| 2     | `key_findings`    | `## Key Findings` + 5–8 bullets with specifics (numbers, names, dates)            |
| 3     | `background`      | `## Background` — 1–2 paragraphs of context                                       |
| 4..N  | `analysis_1`..`analysis_6` | Each ### subsection of Detailed Analysis as its own section. Use as many `analysis_N` slots as you have subsections (1–6) |
| N+1   | `whats_new`       | `## What's New / Recent Developments`                                             |
| N+2   | `open_questions`  | `## Open Questions & Disagreements`                                               |
| last  | `sources`         | `## Sources` — numbered, full URLs, one-line description each                     |

Target 1200–2500 words across all sections combined.

## Step 5 — assemble + finalize

```bash
cat > /tmp/dispatch-meta <<'META'
<TITLE — same as the # title line in your header section, without the leading '# '>
<comma-separated req_ids from step 0a, or leave empty>
META

SLUG=agent-engineering node -e '
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

Parse the response. `result.content[0].text` is JSON; print the `url`. On `isError`, drafts are kept — print the error and stop.

## Writing rules

- Specific beats vague: "Framework X released v0.4.0 with async tool-routing" beats "frameworks improved."
- Quote at most short phrases. Write in your own words.
- When queued requests exist, address each by name in the briefing.
- Skip empty sections; don't pad.
- 1200–2500 words.

Don't ask clarifying questions.
