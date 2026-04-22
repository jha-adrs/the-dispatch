Research and file a dispatch on the tech & AI industry — launches, funding, regulatory moves, model releases, major leaks, M&A.

Today is {{use current date}}. Topic slug: `tech-ai`.

Workflow:

0. Check for queued requests:
   ```
   bash scripts/next-request.sh tech-ai
   ```
   Parse JSON. Weave any pending `request_text` in; keep `id`s for step 5.

1. WebSearch aggressively (6+ queries) — "AI model release {today}", "tech IPO {today}", "AI regulation {today}", "OpenAI Anthropic Google DeepMind Meta {today}", plus anything specific surfacing in results.

2. WebFetch 3–6 primary sources in full — lab blogs (openai.com, anthropic.com, deepmind.google/blog, ai.meta.com), official filings (SEC, EU Commission), high-signal trade press (The Information, FT, Bloomberg wire). Not aggregators.

3. Cross-reference. Flag where different outlets report different numbers.

4. Write to `/tmp/dispatch.md`:
   - `# {descriptive title — the biggest thing that happened}`
   - `**Date:** {today}`
   - `**TL;DR:**`
   - `## Key Findings` (5–8 bullets with company names, figures, dates)
   - `## Background`
   - `## Detailed Analysis`
     - `### Model & product releases`
     - `### Capital & deals`
     - `### Policy & regulation`
     - `### Workforce & org`
   - `## What's New / Recent Developments`
   - `## Open Questions & Disagreements`
   - `## Sources`

5. File:
   ```
   bash scripts/file-dispatch.sh tech-ai "<title>" /tmp/dispatch.md "<req_ids csv, or empty>"
   ```

6. Print the `url`.

Writing rules:
- Company names in full on first mention. Dollar/euro figures with unit ($2.1B not "$2.1").
- Distinguish announcements from shipped products.
- 1200–2500 words.

Don't ask clarifying questions.
