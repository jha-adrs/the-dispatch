# Routine prompt template — no custom connector required

Use this when your workspace blocks custom connectors (admin approval). The routine uses only **built-in** Claude Code tools (`WebSearch`, `WebFetch`, `Bash`, `Write`) plus two curl-wrapping shell scripts that live in this repo. No connector registration needed.

## One-time setup

1. **Attach this repo to the routine** (routines require ≥1 GitHub repo anyway). The scripts live at `scripts/next-request.sh` and `scripts/file-dispatch.sh`; they're cloned on every run.
2. **Create a cloud environment** at [claude.ai/code/environments](https://claude.ai/code/environments) (or edit the Default). Add two environment variables:
   - `DISPATCH_URL` = `https://dispatch.platinumj.xyz`
   - `DISPATCH_TOKEN` = `<MCP_BEARER_TOKEN>` (or `MCP_CLIENT_TOKEN` — either works)

   Env vars on environments are stored encrypted and are visible only to runs that use that environment. They are **not** exposed in session UI.
3. **Select that environment** when creating the routine.

## Prompt template

Paste into the routine prompt, substituting `{{TOPIC}}` and `{{slug}}`:

````
Research and file a dispatch on {{TOPIC}}.

Today is {{use current date}}. Topic slug: `{{slug}}`.

Workflow:

0. Check for queued requests:
   ```
   bash scripts/next-request.sh {{slug}}
   ```
   The response is JSON-RPC. Parse `result.content[0].text` as JSON — it's an
   array of `{ id, request_text, submitted_at }`. If non-empty, treat each
   `request_text` as a priority angle for this run and keep their `id` values
   (you'll pass them back in step 5 as a comma-separated string).

1. Use WebSearch aggressively (5+ distinct queries) for current, authoritative
   information. Focus on the last 14 days for fast-moving topics.

2. WebFetch the 3–6 most important sources in full (primary sources, papers,
   official blogs — not aggregators).

3. Cross-reference; note where sources disagree.

4. Write a structured markdown briefing to `/tmp/dispatch.md` with this exact
   skeleton:
   - `# {descriptive title — not just the topic name}`
   - `**Date:** {today}`
   - `**TL;DR:** {2–3 sentences, the single most important takeaway}`
   - `## Key Findings` (5–8 concrete bullets with specifics — numbers, names,
     dates)
   - `## Background` (1–2 paragraphs of context)
   - `## Detailed Analysis` (subsections with ### headings)
   - `## What's New / Recent Developments`
   - `## Open Questions & Disagreements`
   - `## Sources` (numbered, full URLs, one-line description each)

5. File the dispatch:
   ```
   bash scripts/file-dispatch.sh {{slug}} "<title line without the leading '# '>" /tmp/dispatch.md "<comma-separated request_ids from step 0, or empty>"
   ```
   Example with queued requests:
   `bash scripts/file-dispatch.sh markets "Markets close 22 Apr — RBI focus" /tmp/dispatch.md "req_20260422T120649Z_ed6e90,req_20260422T113622Z_30f0df"`

   Example without:
   `bash scripts/file-dispatch.sh markets "Markets close 22 Apr" /tmp/dispatch.md ""`

6. Print the `url` field from the response. That's my read link.

Writing rules:
- Write in your own words. Never quote more than a short phrase.
- Specific beats vague: "Nifty closed 24,250, down 0.8%" beats "markets declined."
- If a source was paywalled or inaccessible, say so briefly and move on.
- Aim for 1200–2500 words. Don't pad.
- When queued requests exist, they take priority — address each one by name
  in the briefing, even if briefly, so the dashboard shows them fulfilled.

Don't ask clarifying questions — I'm not watching this run. If the brief is
vague, pick the most interesting recent angle.
````

## What each script does

- **`scripts/next-request.sh <slug>`** — POSTs a `next_request` tool call to `/mcp`. Prints the raw JSON-RPC response. Requires `DISPATCH_URL` + `DISPATCH_TOKEN` in env.
- **`scripts/file-dispatch.sh <slug> <title> <md-file> [req_ids_csv]`** — reads the markdown file, JSON-encodes it via `node` (handles newlines/quotes/backticks safely), POSTs a `save_report` tool call. On success, the response contains `{ id, url, word_count, sources_count, fulfilled_request_ids }`.

Both scripts fail loudly on HTTP errors (`--fail-with-body`), so the routine session will surface any 401/400/500 directly in its log.

## Testing before you schedule

From your laptop, with env vars exported:
```bash
export DISPATCH_URL=https://dispatch.platinumj.xyz
export DISPATCH_TOKEN=<your client token>

./scripts/next-request.sh markets    # → should print "[]" text or pending items
echo '# Test dispatch\n\n**TL;DR:** testing file-dispatch.sh works end-to-end via curl.\n\n## Key Findings\n\n- one\n\n## Sources\n\n1. https://example.com' > /tmp/d.md
./scripts/file-dispatch.sh markets "Test dispatch" /tmp/d.md ""
```

You should see the response with the new report id + url, and the report should show up in the dashboard within one poll cycle.
