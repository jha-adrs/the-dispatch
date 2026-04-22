Research and file a dispatch on Indian equity markets close — indices, sectors, flows, macro drivers, and any central-bank or policy development that moved the tape today. Topic slug: `markets`.
Today is {{use current date}}. The environment has `DISPATCH_URL` and `DISPATCH_TOKEN` set.

## Step 0 — check for queued requests

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"next_request","arguments":{"topic_slug":"markets"}}}'
```

Parse `result.content[0].text` as JSON. Weave pending items in; keep ids for step 5.

## Step 1–3 — research

- WebSearch 5+ queries: Nifty close, Sensex close, sectoral leaders/laggards, FII/DII flows, RBI/SEBI actions, top movers, global cues.
- WebFetch 3–6 primary sources: BSE/NSE exchange pages, AMFI for fund flows, RBI for governor remarks, company disclosures for earnings moves.
- Cross-reference the numbers.

## Step 4 — assemble /tmp/dispatch.md section-by-section

**Do NOT write the whole briefing in one shot — the stream will time out.** One Bash call per section.

```bash
# 4a. Header
cat > /tmp/dispatch.md <<'EOF'
# Indian markets close — <today> (<descriptor, e.g. "RBI focus" or "IT drag">)

**Date:** <today>
**TL;DR:** <Lead with index direction + magnitude + the biggest driver, 2–3 sentences>

EOF
```

```bash
# 4b. Key Findings: 5–8 bullets. Index closes with %, gainers/losers, FII ₹X cr, DII ₹X cr, headline macro item.
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

Detailed Analysis — one Bash call per subsection. Skip sections with nothing material.

```bash
# 4d-i. Index moves
cat >> /tmp/dispatch.md <<'EOF'
## Detailed Analysis

### Index moves

...

EOF
```

```bash
# 4d-ii. Sector rotation
cat >> /tmp/dispatch.md <<'EOF'
### Sector rotation

...

EOF
```

```bash
# 4d-iii. Flows & derivatives
cat >> /tmp/dispatch.md <<'EOF'
### Flows & derivatives

...

EOF
```

```bash
# 4d-iv. Macro & policy
cat >> /tmp/dispatch.md <<'EOF'
### Macro & policy

...

EOF
```

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

Total 1200–2500 words. Skip any section that has nothing.

## Step 5 — file the dispatch

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

- Numbers always. "Nifty closed 24,250, down 0.8%" beats "markets fell."
- ₹ figures in crores. Rupee level at close if material.
- Skip sections that had nothing material.
- When queued requests exist, address each one by name.
- 1200–2500 words.

Don't ask clarifying questions.
