#!/usr/bin/env bash
# File a completed dispatch to the Dispatch MCP via curl.
#
# Usage:  scripts/file-dispatch.sh <slug> <title> <markdown-file> [request_id1,request_id2,...]
# Env:    DISPATCH_URL   e.g. https://dispatch.platinumj.xyz
#         DISPATCH_TOKEN MCP bearer (MCP_BEARER_TOKEN or MCP_CLIENT_TOKEN)
#
# Prints the JSON-RPC response. On success the result.content[0].text contains
# { id, url, word_count, sources_count, fulfilled_request_ids } as JSON.
#
# Why node in the middle: the markdown body contains newlines, backticks,
# quotes — constructing a valid JSON-RPC body with just shell heredocs is
# fragile. Node is present in any Claude Code cloud environment and on any
# VPS with this repo installed.

set -euo pipefail

SLUG="${1:?usage: file-dispatch.sh <slug> <title> <markdown-file> [req_ids_csv]}"
TITLE="${2:?usage: file-dispatch.sh <slug> <title> <markdown-file> [req_ids_csv]}"
MDFILE="${3:?usage: file-dispatch.sh <slug> <title> <markdown-file> [req_ids_csv]}"
REQ_IDS="${4:-}"

: "${DISPATCH_URL:?DISPATCH_URL env var required}"
: "${DISPATCH_TOKEN:?DISPATCH_TOKEN env var required}"

[[ -r "$MDFILE" ]] || { echo "markdown file not readable: $MDFILE" >&2; exit 1; }

BODY=$(node -e '
  const fs = require("fs");
  const [slug, title, mdfile, reqs] = process.argv.slice(1);
  const markdown_body = fs.readFileSync(mdfile, "utf8");
  const args = { topic_slug: slug, title, markdown_body };
  if (reqs) {
    const ids = reqs.split(",").map(s => s.trim()).filter(Boolean);
    if (ids.length) args.request_ids = ids;
  }
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "save_report", arguments: args },
  }));
' "$SLUG" "$TITLE" "$MDFILE" "$REQ_IDS")

curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer ${DISPATCH_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  --data-binary "$BODY"
echo
