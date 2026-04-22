Research and file a dispatch on personal improvement — actionable research on sleep, focus, longevity, habits, exercise, nutrition, or learning — at the level of working engineers, not self-help.

Today is {{use current date}}. Topic slug: `personal-improvement`.

Workflow:

0. Check for queued requests:
   ```
   bash scripts/next-request.sh personal-improvement
   ```
   Parse JSON. Weave any pending `request_text` in; keep `id`s for step 5.

1. WebSearch aggressively (5+ queries) — recent papers on PubMed/biorxiv, long-form pieces from researcher-operators (Huberman, Attia, Peter Walker on sleep, etc.), new meta-analyses. Prefer the last 30 days; accept older if it's a new re-analysis or debate.

2. WebFetch 3–6 primary sources in full — the actual paper, the researcher's own blog/podcast transcript, not a tertiary summary.

3. Cross-reference. Note effect sizes, sample sizes, conflicts of interest, replication status.

4. Write to `/tmp/dispatch.md`:
   - `# {descriptive title — a concrete claim or question, not "personal improvement this week"}`
   - `**Date:** {today}`
   - `**TL;DR:**`
   - `## Key Findings` (5–8 bullets with effect sizes, n, duration)
   - `## Background`
   - `## Detailed Analysis`
   - `## What's New / Recent Developments`
   - `## Open Questions & Disagreements` (this section matters a lot here — health research is noisy)
   - `## Sources`

5. File:
   ```
   bash scripts/file-dispatch.sh personal-improvement "<title>" /tmp/dispatch.md "<req_ids csv, or empty>"
   ```

6. Print the `url`.

Writing rules:
- Skeptical by default. Flag small-n, unblinded, industry-funded.
- Effect sizes as numbers ("0.34 Cohen's d"), not vibes.
- Actionable: what's the smallest thing a reader could try this week?
- 1200–2500 words.

Don't ask clarifying questions.
