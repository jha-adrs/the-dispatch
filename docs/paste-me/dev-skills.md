Research and file a dispatch on notable engineering techniques, developer tooling releases, and craft-level ideas worth a working engineer's attention. Topic slug: `dev-skills`.
Today is {{use current date}}. The environment has `DISPATCH_URL` and `DISPATCH_TOKEN` set.

## Step 0a — check for queued requests

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"next_request","arguments":{"topic_slug":"dev-skills"}}}'
```

Parse JSON. Weave pending items in; keep ids for step 5.

## Step 0b — resume check

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_draft_sections","arguments":{"topic_slug":"dev-skills"}}}'
```

If sections non-empty, resuming — skip them in step 4.

## Step 1–3 — research

- WebSearch 5+ queries — recent changelogs, HN/lobste.rs front page, notable engineering blogs, tooling releases last 7–14 days.
- WebFetch 3–6 primary sources in full (release notes, posts, papers — not aggregators).
- Cross-reference.

## Step 4 — append each section to the server

Set up helper once:

```bash
cat > /tmp/append.sh <<'SH'
#!/bin/bash
set -euo pipefail
export SECTION="${1:?usage: append.sh <section_name>}"
export SLUG="dev-skills"
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

For each section: **Write** to `/tmp/section.md`, then `bash /tmp/append.sh <section_name>`.

| section_name             | content                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `header`                 | `# <title>`, `**Date:**`, `**TL;DR:**`                             |
| `key_findings`           | `## Key Findings` + 5–8 specific bullets                           |
| `background`             | `## Background`                                                    |
| `analysis_1`..`analysis_4` | Each ### subsection of Detailed Analysis as its own section       |
| `whats_new`              | `## What's New / Recent Developments`                              |
| `open_questions`         | `## Open Questions & Disagreements`                                |
| `sources`                | `## Sources`                                                       |

Target 1200–2500 words total.

## Step 5 — assemble + finalize

```bash
cat > /tmp/dispatch-meta <<'META'
<TITLE>
<REQ_IDS>
META

SLUG=dev-skills node -e '
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

Print the `url` from the response. On `isError`, drafts kept — print error and stop.

## Writing rules

- Specific: "Bun 1.2 ships native S3 client, cutting cold-start 40%" beats "tooling improved."
- When queued requests exist, address each by name.
- 1200–2500 words. Skip empty sections.

Don't ask clarifying questions.
