You're filing a short world-snapshot briefing — the morning edition.
Today is {{use current date}}. Topic slug: `world-morning`.

What I want: a tight 400–700 word briefing of what actually moved in the world overnight (US/Europe). Not a deep dive. Skim breadth, land on specifics. Five categories, in order: geopolitics, markets, tech & science, business & policy, one human-interest. Skip any category if nothing material happened.

Workflow:

0. Check for queued requests:
   ```
   bash scripts/next-request.sh world-morning
   ```
   Parse `result.content[0].text` as JSON. If any are pending, weave them in and keep their ids for step 5.

1. WebSearch aggressively — 6–10 queries: "world news overnight", "US markets close last night", "Europe news overnight", "geopolitics {{today}}", "Asia open {{today}}", plus topic-specific queries as leads emerge.

2. WebFetch 3–5 primary sources (Reuters, AP, FT, WSJ, Bloomberg wire, official gov/central-bank statements). Not aggregators.

3. Write to `/tmp/dispatch.md` with this skeleton:

   ```
   # World morning — {date, e.g. "22 April 2026"}

   **Date:** {today}
   **TL;DR:** {1–2 sentences. The single most important thing that happened overnight.}

   ## Geopolitics
   - specific bullet with names, places, numbers
   - ...

   ## Markets
   - index levels, FX moves, commodity moves with figures
   - ...

   ## Tech & science
   - ...

   ## Business & policy
   - ...

   ## One to read
   A single human-interest / long-read / deeply-reported piece from the last 24h. One paragraph summary + link.

   ## Sources
   1. {url} — {one-line description}
   ...
   ```

4. File:
   ```
   bash scripts/file-dispatch.sh world-morning "World morning — <date>" /tmp/dispatch.md "<req_ids csv, or empty>"
   ```

5. Print the `url`.

Writing rules:
- Tight. 400–700 words. If past 800, cut.
- Each bullet has at least one specific — a number, a name, a place, a timestamp. "Tensions rose" is not a bullet.
- Never quote more than a short phrase.
- If a category has nothing, drop the whole section — don't pad.
- Don't invent. If you can't verify, skip.

Don't ask clarifying questions.
