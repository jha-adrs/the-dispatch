#!/usr/bin/env bash
# Read pending queued requests for a topic_slug.
#
# Usage:  scripts/next-request.sh <slug>
# Env:    DISPATCH_URL   e.g. https://dispatch.platinumj.xyz
#         DISPATCH_TOKEN MCP bearer (MCP_BEARER_TOKEN or MCP_CLIENT_TOKEN)
#
# Prints the raw JSON-RPC response to stdout. Parse the result.content[0].text
# as JSON to get the array of { id, request_text, submitted_at } items.

set -euo pipefail

SLUG="${1:?usage: next-request.sh <slug>}"
: "${DISPATCH_URL:?DISPATCH_URL env var required}"
: "${DISPATCH_TOKEN:?DISPATCH_TOKEN env var required}"

curl -sS --fail-with-body -X POST "${DISPATCH_URL%/}/mcp" \
  -H "Authorization: Bearer ${DISPATCH_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"next_request\",\"arguments\":{\"topic_slug\":\"${SLUG}\"}}}"
echo
