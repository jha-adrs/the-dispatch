Research and file a dispatch on personal improvement — actionable research on sleep, focus, longevity, habits, exercise, nutrition, or learning — at the level of working engineers, not self-help. Topic slug: `personal-improvement`.
Today is {{use current date}}. The environment has `DISPATCH_URL` and `DISPATCH_TOKEN` set.

## Step 0 — check for queued requests

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"next_request","arguments":{"topic_slug":"personal-improvement"}}}'
```

Parse `result.content[0].text` as JSON. Weave pending items in; keep ids for step 5.

## Step 1–3 — research

- WebSearch 5+ queries: recent papers on PubMed/biorxiv, long-form pieces from researcher-operators (Huberman, Attia, Peter Walker on sleep, etc.), new meta-analyses. Prefer last 30 days.
- WebFetch 3–6 primary sources in full — the actual paper or the researcher's blog/podcast transcript, not a tertiary summary.
- Cross-reference. Note effect sizes, sample sizes, conflicts of interest, replication status.

## Step 4 — assemble /tmp/dispatch.md section-by-section

**Do NOT write the whole briefing in one shot — the stream will time out.** One Bash call per section.

```bash
# 4a. Header
cat > /tmp/dispatch.md <<'EOF'
# <descriptive title — a concrete claim or question>

**Date:** <today>
**TL;DR:** <2–3 sentences>

EOF
```

```bash
# 4b. Key Findings: 5–8 bullets with effect sizes, n, duration
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
# 4d. Detailed Analysis
cat >> /tmp/dispatch.md <<'EOF'
## Detailed Analysis

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
# 4f. Open Questions & Disagreements — this section matters a lot here; health research is noisy
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

Total 1200–2500 words.

## Step 5 — file the dispatch

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

- Skeptical by default. Flag small-n, unblinded, industry-funded.
- Effect sizes as numbers ("0.34 Cohen's d"), not vibes.
- Actionable: what's the smallest thing a reader could try this week?
- When queued requests exist, address each one by name.
- 1200–2500 words.

Don't ask clarifying questions.
