# Routine prompt template

Paste this into a new Claude Code Routine's prompt (claude.ai/code/routines → **New routine**). Substitute `{{TOPIC}}` and `{{slug}}` per routine. Leave `{{use current date}}` as a literal string — Claude resolves it at run time.

```
Research and file a dispatch on {{TOPIC}}.

Today is {{use current date}}. Topic slug: `{{slug}}`.

Workflow:
0. Call the Dispatch connector's `next_request` tool with `topic_slug: "{{slug}}"`.
   - If it returns one or more items, treat their `request_text` as the
     priority angles for this run — weave them into the research focus. Keep
     each item's `id`; you'll pass them all back in step 5 as `request_ids`.
   - If it returns `[]`, proceed with the most interesting recent angle on
     the topic.
1. Use WebSearch aggressively (5+ distinct queries) for current, authoritative
   information. Focus on the last 14 days for fast-moving topics.
2. WebFetch the 3–6 most important sources in full (primary sources, papers,
   official blogs — not aggregators).
3. Cross-reference; note where sources disagree.
4. Write a structured markdown briefing with this exact skeleton:
   - `# {descriptive title — not just the topic name}`
   - `**Date:** {today}`
   - `**TL;DR:** {2–3 sentences, the single most important takeaway}`
   - `## Key Findings` (5–8 concrete bullets, each with specifics — numbers,
     names, dates)
   - `## Background` (1–2 paragraphs of context)
   - `## Detailed Analysis` (subsections with ### headings)
   - `## What's New / Recent Developments`
   - `## Open Questions & Disagreements`
   - `## Sources` (numbered, full URLs, one-line description each)
5. Call the Dispatch connector's `save_report` tool with:
   - `topic_slug`: "{{slug}}"
   - `title`: the `# ` title line from your markdown
   - `markdown_body`: the entire markdown you wrote
   - `request_ids`: the IDs from step 0 (omit if step 0 returned [])
6. Print the URL that `save_report` returned. That's my read link.

Writing rules:
- Write in your own words. Never quote more than a short phrase.
- Specific beats vague: "Nifty closed 24,250, down 0.8%" beats
  "markets declined."
- If a source was paywalled or inaccessible, say so briefly and move on.
- Aim for 1200–2500 words. Don't pad.
- When queued requests exist, they take priority — address each one by name
  in the briefing, even if briefly, so the dashboard shows them fulfilled.

Don't ask clarifying questions — I'm not watching this run. If the brief
is vague, pick the most interesting recent angle.
```

## End-to-end setup

1. **Register the connector once on claude.ai.** Settings → Connectors → Add custom connector. URL: `https://<your-host>/mcp`. Auth: `Bearer <MCP_BEARER_TOKEN from install.sh output>`. Verify that `save_report`, `list_recent_reports`, `get_report_summary`, and `next_request` show up in the tool list.
2. **Create the routine.** claude.ai/code/routines → **New routine**.
   - Paste the template above with `{{TOPIC}}` and `{{slug}}` substituted.
   - **Repositories:** attach ≥1 GitHub repo (routines require it). The Dispatch repo works; it won't be written to. Use a throwaway if you'd rather keep this repo read-only.
   - **Environment:** Default is fine — it has general outbound HTTPS, which both WebSearch/WebFetch and the MCP call need.
   - **Connectors:** include Dispatch. Remove anything the routine doesn't need to shrink blast radius.
   - **Trigger:** pick a preset (hourly / daily / weekdays / weekly). Minimum interval is 1 hour. For custom cron, save the routine first, then run `/schedule update` in the Claude Code CLI.
3. **Smoke-test with Run now.** Open the session URL to watch the tool calls. The filed report appears in the dashboard within ≤10s.

## Example routines

| Name | Slug | Cadence | Topic |
| --- | --- | --- | --- |
| Markets close — India | `markets` | Weekdays 18:30 IST | Indian equity markets close |
| Agent engineering roundup | `agent-engineering` | Weekly | New work on agent scaffolds, evals, and frameworks |
| Dev skills this week | `dev-skills` | Weekly | Notable engineering techniques and tooling |
| Personal improvement | `personal-improvement` | Weekly | Sleep, focus, longevity research |
