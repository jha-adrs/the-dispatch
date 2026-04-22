Research and file a dispatch on new agent frameworks, evals, scaffolds, and notable papers in agent engineering. Topic slug: `agent-engineering`.
Today is {{use current date}}. The environment has `DISPATCH_URL` and `DISPATCH_TOKEN` set.

## Step 0 — check for queued requests

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"next_request","arguments":{"topic_slug":"agent-engineering"}}}'
```

Parse `result.content[0].text` as JSON. If non-empty, weave pending `request_text` angles into the research focus and keep the ids for step 5.

## Step 1–3 — research

- WebSearch aggressively (5+ queries), last 14 days, authoritative sources.
- WebFetch 3–6 primary sources in full (lab blogs, papers, official repos — not aggregators).
- Cross-reference; note where sources disagree.

## Step 4 — assemble /tmp/dispatch.md section-by-section

**Do NOT write the whole briefing in one shot — the stream will time out.** Use one Bash tool call per section. Start fresh, then append.

```bash
# 4a. Header (title + date + TL;DR).
cat > /tmp/dispatch.md <<'EOF'
# <descriptive title — not just the topic name>

**Date:** <today>
**TL;DR:** <2–3 sentences, the single most important takeaway>

EOF
```

```bash
# 4b. Key Findings. 5–8 concrete bullets with numbers, names, dates.
cat >> /tmp/dispatch.md <<'EOF'
## Key Findings

- ...
- ...

EOF
```

```bash
# 4c. Background. 1–2 paragraphs of context.
cat >> /tmp/dispatch.md <<'EOF'
## Background

...

EOF
```

```bash
# 4d. Detailed Analysis — one Bash call per ### subsection.
cat >> /tmp/dispatch.md <<'EOF'
## Detailed Analysis

### <subsection>

...

EOF
```
(repeat 4d once per subsection)

```bash
# 4e. What's New / Recent Developments.
cat >> /tmp/dispatch.md <<'EOF'
## What's New / Recent Developments

...

EOF
```

```bash
# 4f. Open Questions & Disagreements.
cat >> /tmp/dispatch.md <<'EOF'
## Open Questions & Disagreements

...

EOF
```

```bash
# 4g. Sources. Numbered, full URLs, one-line description each.
cat >> /tmp/dispatch.md <<'EOF'
## Sources

1. <url> — <one-line description>
...

EOF
```

Target 1200–2500 words total across all sections. If a section has nothing material, skip the whole `cat >>` for it — don't pad.

## Step 5 — file the dispatch

```bash
cat > /tmp/dispatch-meta <<'META'
<TITLE>
<REQ_IDS>
META

SLUG=agent-engineering node -e '
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

- Write in your own words. Short phrases only when quoting.
- Specific beats vague: "Framework X released v0.4.0 with async tool-routing" beats "frameworks improved."
- If a source is paywalled, say so briefly and move on.
- When queued requests exist, address each one by name in the briefing.
- 1200–2500 words. Don't pad.

Don't ask clarifying questions.
