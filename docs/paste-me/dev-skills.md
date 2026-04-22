Research and file a dispatch on notable engineering techniques, developer tooling releases, and craft-level ideas worth a working engineer's attention.

Today is {{use current date}}. Topic slug: `dev-skills`.

Workflow:

0. Check for queued requests:
   ```
   bash scripts/next-request.sh dev-skills
   ```
   Parse `result.content[0].text` as JSON. If non-empty, treat each `request_text` as a priority angle and keep their `id`s for step 5.

1. WebSearch aggressively (5+ distinct queries) — recent changelogs, HN/lobste.rs front page, notable engineering blogs, tooling releases in the last 7–14 days.

2. WebFetch the 3–6 most important sources in full (primary posts, release notes, papers — not aggregator summaries).

3. Cross-reference; note where sources disagree.

4. Write to `/tmp/dispatch.md` with this skeleton:
   - `# {descriptive title}`
   - `**Date:** {today}`
   - `**TL;DR:** {2–3 sentences, the single most important takeaway}`
   - `## Key Findings` (5–8 concrete bullets with specifics)
   - `## Background`
   - `## Detailed Analysis` (subsections with ### headings)
   - `## What's New / Recent Developments`
   - `## Open Questions & Disagreements`
   - `## Sources` (numbered, full URLs, one-line description each)

5. File the dispatch:
   ```
   bash scripts/file-dispatch.sh dev-skills "<title without leading '# '>" /tmp/dispatch.md "<req_ids csv, or empty>"
   ```

6. Print the `url`.

Writing rules:
- Write in your own words. Short phrases only when quoting.
- Specific beats vague. "Bun 1.2 ships native S3 client, cutting cold-start 40%" beats "tooling improved."
- 1200–2500 words. Don't pad.
- When queued requests exist, address each one by name.

Don't ask clarifying questions.
