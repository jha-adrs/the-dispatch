# World snapshot prompt — short briefing template

Use this template for the two daily world-snapshot routines (morning 08:00, evening 21:00). These are shorter than the regular dispatches — 400–700 words, focused on *what changed in the last 12 hours* rather than a deep dive.

Same no-connector mechanics as `docs/routine-prompt-no-connector.md`: attach this repo, set `DISPATCH_URL` + `DISPATCH_TOKEN` on the environment, the routine calls `scripts/file-dispatch.sh`.

## Prompt template

Paste into the routine prompt. Substitute `{{WINDOW}}` with `morning` or `evening` and `{{slug}}` with `world-morning` or `world-evening`.

````
You're filing a short world-snapshot briefing — the {{WINDOW}} edition.
Today is {{use current date}}. Topic slug: `{{slug}}`.

What I want: a tight 400–700 word briefing of what actually moved in the
world over roughly the last 12 hours. Not a deep dive. Skim breadth, land
on specifics. Five categories, in order: geopolitics, markets, tech &
science, business & policy, one human-interest. Skip any category if
nothing material happened.

Workflow:

0. Check for queued requests:
   ```
   bash scripts/next-request.sh {{slug}}
   ```
   Parse `result.content[0].text` as JSON (array of `{id, request_text, submitted_at}`).
   If any are pending, weave them in and keep their ids for step 5.

1. WebSearch aggressively — 6–10 queries covering:
   - "world news last 12 hours"
   - "markets overnight close" (or regional equivalents depending on window)
   - "geopolitics {{today}}"
   - plus topic-specific queries as leads emerge
   Prefer the last 12 hours. If it's the morning edition, prioritize what
   happened overnight US/Europe; if evening, prioritize Asian close + US
   midday.

2. WebFetch 3–5 primary sources (Reuters, AP, FT, WSJ, Bloomberg wire,
   official gov/central-bank statements). Not aggregators.

3. Write to `/tmp/dispatch.md` with this skeleton:

   ```
   # World {{WINDOW}} — {date, e.g. "22 April 2026"}

   **Date:** {today}
   **TL;DR:** {1–2 sentences. The single most important thing that happened.}

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
   A single human-interest / long-read / deeply-reported piece from the
   last 24h. One paragraph summary + link.

   ## Sources
   1. {url} — {one-line description}
   ...
   ```

4. File it:
   ```
   bash scripts/file-dispatch.sh {{slug}} "World {{WINDOW}} — <date>" /tmp/dispatch.md "<comma-separated req_ids from step 0, or empty>"
   ```

5. Print the `url` from the response.

Writing rules:
- Tight. 400–700 words. If you're past 800, cut.
- Each bullet has at least one specific — a number, a name, a place, a
  timestamp. "Tensions rose" is not a bullet. "Iran-backed Houthi forces
  struck a Greek-owned tanker in the Red Sea at 03:10 GMT" is.
- Never quote more than a short phrase.
- If a category has nothing, drop the whole section — don't pad.
- Don't invent. If you can't verify, skip.

Don't ask clarifying questions — I'm not watching this run.
````

## Scheduling

Create two routines, each with a single schedule trigger:

| Routine name                | Slug            | Preset    | Time      |
| --------------------------- | --------------- | --------- | --------- |
| World morning snapshot      | `world-morning` | daily     | 08:00     |
| World evening snapshot      | `world-evening` | daily     | 21:00     |

Times are in your local zone — Claude Code converts them automatically. If you need a cron not in the presets, save the routine first then `/schedule update` in the CLI.
