Research and file a dispatch on notable engineering techniques, developer tooling releases, and craft-level ideas worth a working engineer's attention. Topic slug: `dev-skills`.
Today is {{use current date}}. The environment has `DISPATCH_URL` and `DISPATCH_TOKEN` set.

## Step 0 — check for queued requests

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"next_request","arguments":{"topic_slug":"dev-skills"}}}'
```

Parse `result.content[0].text` as JSON. Weave pending items in; keep ids for step 5.

## Step 1–3 — research

- WebSearch 5+ queries — recent changelogs, HN/lobste.rs front page, notable engineering blogs, tooling releases last 7–14 days.
- WebFetch 3–6 primary sources in full (release notes, posts, papers — not aggregators).
- Cross-reference.

## Step 4 — assemble /tmp/dispatch.md section-by-section

**Do NOT write the whole briefing in one shot — the stream will time out.** One Bash tool call per section.

```bash
# 4a. Header
cat > /tmp/dispatch.md <<'EOF'
# <descriptive title>

**Date:** <today>
**TL;DR:** <2–3 sentences>

EOF
```

```bash
# 4b. Key Findings (5–8 bullets with specifics)
cat >> /tmp/dispatch.md <<'EOF'
## Key Findings

- ...

EOF
```

```bash
# 4c. Background
cat >> /tmp/dispatch.md <<'EOF'
## Background

...

EOF
```

```bash
# 4d. Detailed Analysis — one Bash call per ### subsection
cat >> /tmp/dispatch.md <<'EOF'
## Detailed Analysis

### <subsection>

...

EOF
```
(repeat 4d per subsection)

```bash
# 4e. What's New / Recent Developments
cat >> /tmp/dispatch.md <<'EOF'
## What's New / Recent Developments

...

EOF
```

```bash
# 4f. Open Questions & Disagreements
cat >> /tmp/dispatch.md <<'EOF'
## Open Questions & Disagreements

...

EOF
```

```bash
# 4g. Sources
cat >> /tmp/dispatch.md <<'EOF'
## Sources

1. <url> — <one-line>

EOF
```

Total 1200–2500 words. Skip any section that genuinely has nothing.

## Step 5 — file the dispatch

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

Parse the response; print the `url` field. If `isError`, print the error and stop.

## Writing rules

- Specific beats vague. "Bun 1.2 ships native S3 client, cutting cold-start 40%" beats "tooling improved."
- When queued requests exist, address each one by name.
- 1200–2500 words. Don't pad.

Don't ask clarifying questions.
