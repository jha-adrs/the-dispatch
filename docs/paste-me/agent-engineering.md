Research and file a dispatch on new agent frameworks, evals, scaffolds, and notable papers in agent engineering.

Today is {{use current date}}. Topic slug: `agent-engineering`.

Workflow:

0. Check for queued requests:
   ```
   bash scripts/next-request.sh agent-engineering
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
   - `## Key Findings` (5–8 concrete bullets with specifics — numbers, names, dates)
   - `## Background` (1–2 paragraphs of context)
   - `## Detailed Analysis` (subsections with ### headings)
   - `## What's New / Recent Developments`
   - `## Open Questions & Disagreements`
   - `## Sources` (numbered, full URLs, one-line description each)

5. File the dispatch:
   ```
   bash scripts/file-dispatch.sh agent-engineering "<title line without leading '# '>" /tmp/dispatch.md "<comma-separated request_ids from step 0, or empty>"
   ```

6. Print the `url` field from the response.

Writing rules:
- Write in your own words. Never quote more than a short phrase.
- Specific beats vague: "Framework X released v0.4.0 with async tool-routing" beats "frameworks improved."
- If a source was paywalled, say so briefly and move on.
- Aim for 1200–2500 words. Don't pad.
- When queued requests exist, they take priority — address each one by name.

Don't ask clarifying questions — I'm not watching this run. If the brief is vague, pick the most interesting recent angle.
