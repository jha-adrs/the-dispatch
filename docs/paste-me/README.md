# Copy-paste routines — the 10-minute version

Seven files in this folder, one per routine. Each is the **complete prompt** — no substitution needed, just copy → paste into the routine prompt field on claude.ai.

**Self-contained — no repo checkout required.** The prompts inline the `node` → `curl` call, so they work regardless of whether the session's cwd matches the cloned repo. You still attach a repo (routines require ≥1), but none of its contents matter.

## Setup order

**Once (5 min):**
1. claude.ai/code/environments → **New environment** → name it `dispatch`. Add:
   - `DISPATCH_URL` = `https://dispatch.platinumj.xyz`
   - `DISPATCH_TOKEN` = your `MCP_BEARER_TOKEN` from the VPS `install.sh` output.

**Per routine (≈45 seconds each):**
1. claude.ai/code/routines → **New routine**.
2. Name per the table below.
3. **Prompt:** paste the file contents verbatim.
4. **Repository:** none needed — the prompt is fully self-contained. If the routine form insists on one, attach anything (a throwaway); contents are never read by Claude during the run.
5. **Environment:** `dispatch`.
6. **Connectors:** remove all (none needed).
7. **Trigger:** set the cadence below.
8. **Create**, then **Run now** to smoke-test.

## The 7 routines

| # | Name | File to paste | Trigger | Slug |
|---|---|---|---|---|
| 1 | World morning snapshot | `world-morning.md` | Daily 08:00 | `world-morning` |
| 2 | Agent engineering roundup | `agent-engineering.md` | Daily 10:00 | `agent-engineering` |
| 3 | Dev skills & tooling | `dev-skills.md` | Daily 13:00 | `dev-skills` |
| 4 | Indian markets close | `markets.md` | Weekdays 18:00 | `markets` |
| 5 | Personal improvement & research | `personal-improvement.md` | Daily 20:00 | `personal-improvement` |
| 6 | World evening snapshot | `world-evening.md` | Daily 21:00 | `world-evening` |
| 7 | Tech & AI industry | `tech-ai.md` | Daily 23:00 | `tech-ai` |

All times are your local zone (IST if you're in India) — Claude converts them automatically. 7 runs/day fits comfortably in the Team 25/day cap.

## After all 7 are live

- Watch the first real cycle. If a routine fails at the `curl … save_report` step, the session log shows the exact response — usually a 401 (wrong `DISPATCH_TOKEN`) or 400 (markdown doesn't pass `# `/`**TL;DR:**` validation).
- Queue ad-hoc briefs via the **Queue a Brief** card on the dashboard. Pick the slug of whichever routine's next run you want to hijack; the next `next_request` call that routine makes (step 0) will see the pending item.
- Set up a nightly rsync of `~/dispatch/reports.db*` + `~/dispatch/archive/` to offsite.
