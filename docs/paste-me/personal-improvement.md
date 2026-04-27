Research and file a dispatch on personal improvement — actionable research on sleep, focus, longevity, habits, exercise, nutrition, or learning — at the level of working engineers, not self-help. Topic slug: `personal-improvement`.
Today is {{use current date}}. The environment has `DISPATCH_URL` and `DISPATCH_TOKEN` set.

## Step 0a — check for queued requests

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"next_request","arguments":{"topic_slug":"personal-improvement"}}}'
```

## Step 0b — resume check

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_draft_sections","arguments":{"topic_slug":"personal-improvement"}}}'
```

If sections non-empty, resuming — skip them in step 4.

## Step 1–3 — research

- WebSearch 5+ queries: recent papers on PubMed/biorxiv, long-form pieces from researcher-operators (Huberman, Attia, Walker), new meta-analyses. Prefer last 30 days.
- WebFetch 3–6 primary sources in full — actual papers, researcher posts/transcripts, not tertiary summaries.
- Cross-reference. Note effect sizes, sample sizes, conflicts of interest, replication status.

## Step 4 — append each section to the server

Set up helper:

```bash
cat > /tmp/append.sh <<'SH'
#!/bin/bash
set -euo pipefail
export SECTION="${1:?usage: append.sh <section_name>}"
export SLUG="personal-improvement"
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

| section_name       | content                                                                       |
| ------------------ | ----------------------------------------------------------------------------- |
| `header`           | `# <a concrete claim or question, not "personal improvement this week">`, Date, `**TL;DR:**` |
| `key_findings`     | 5–8 bullets with effect sizes, n, duration                                    |
| `background`       | `## Background`                                                               |
| `analysis_1`..`analysis_4` | Each ### subsection                                                  |
| `whats_new`        | `## What's New / Recent Developments`                                         |
| `open_questions`   | `## Open Questions & Disagreements` — health research is noisy, this section matters here |
| `sources`          | `## Sources`                                                                  |

Target 1200–2500 words total.

## Step 5 — assemble + finalize

```bash
cat > /tmp/dispatch-meta <<'META'
<TITLE>
<REQ_IDS>
META

SLUG=personal-improvement node -e '
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

- Skeptical by default. Flag small-n, unblinded, industry-funded.
- Effect sizes as numbers ("0.34 Cohen's d"), not vibes.
- Actionable: smallest thing a reader could try this week?
- 1200–2500 words.

Don't ask clarifying questions.
