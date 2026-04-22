# Filing block reference (for maintainers only)

This is the canonical "how to file a dispatch from inside a routine" block — the self-contained version that doesn't depend on the repo being cloned into cwd. It's inlined into every paste-me/*.md file. Keep them in sync.

## Step 0 — check queued requests

```bash
curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"next_request","arguments":{"topic_slug":"<SLUG>"}}}'
```

Parse the response's `result.content[0].text` as JSON — it's an array of `{id, request_text, submitted_at}`.

## Step 5 — file the dispatch

After the markdown is at `/tmp/dispatch.md`:

```bash
# Put your title on the first line (no leading '# '), req_ids csv on the second (or empty).
cat > /tmp/dispatch-meta <<'META'
<TITLE HERE>
<REQ_IDS_CSV_OR_EMPTY>
META

node -e '
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
    jsonrpc:"2.0", id:1, method:"tools/call",
    params:{ name:"save_report", arguments: args }
  }));
' | SLUG=<SLUG> curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
    -H "Authorization: Bearer $DISPATCH_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    --data-binary @-
```

The response `result.content[0].text` is JSON with `{id, url, word_count, sources_count, fulfilled_request_ids}`. Print the `url`.

Why this works: `node -e` reads the markdown from disk and does `JSON.stringify` on it, so no manual escaping of quotes/newlines/backticks. The title is also read from disk (so Claude doesn't have to escape it inside a shell arg). `--data-binary @-` streams the JSON straight to curl without shell re-interpretation.
