Research and file a dispatch on Indian equity markets close — indices, sectors, flows, macro drivers, and any central-bank or policy development that moved the tape today.

Today is {{use current date}}. Topic slug: `markets`.

Workflow:

0. Check for queued requests:
   ```
   bash scripts/next-request.sh markets
   ```
   Parse JSON. Weave any pending `request_text` into the research focus; keep their `id`s for step 5.

1. WebSearch aggressively (5+ queries) — Nifty close, Sensex close, sectoral leaders/laggards, FII/DII flows, RBI/SEBI actions, top movers, global cues that affected the open/close.

2. WebFetch 3–6 primary sources: BSE/NSE exchange pages, AMFI for fund flows, RBI for any governor remarks, bseindia.com, nseindia.com, company disclosures for earnings-driven moves.

3. Cross-reference the numbers. Note where sources disagree.

4. Write to `/tmp/dispatch.md`:
   - `# Indian markets close — {today} ({descriptor, e.g. "RBI focus" or "IT drag"})`
   - `**Date:** {today}`
   - `**TL;DR:** {2–3 sentences. Lead with index direction + magnitude + the single biggest driver.}`
   - `## Key Findings` (5–8 bullets: index closes with %, top gainers/losers, sectoral moves, FII ₹X cr net, DII ₹X cr net, headline macro or policy item)
   - `## Background`
   - `## Detailed Analysis`
     - `### Index moves`
     - `### Sector rotation`
     - `### Flows & derivatives`
     - `### Macro & policy`
   - `## What's New / Recent Developments`
   - `## Open Questions & Disagreements`
   - `## Sources`

5. File:
   ```
   bash scripts/file-dispatch.sh markets "<title without leading '# '>" /tmp/dispatch.md "<req_ids csv, or empty>"
   ```

6. Print the `url`.

Writing rules:
- Numbers always. "Nifty closed 24,250, down 0.8%" beats "markets fell."
- ₹ figures in crores. Rupee level at close if material.
- Skip sections that had nothing material.
- 1200–2500 words. Don't pad.

Don't ask clarifying questions.
