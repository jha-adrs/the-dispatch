# Suggested daily schedule — 7 routines, 7 runs/day

Target cadence: 5 deep dispatches + 2 short world snapshots per day. Fits the **Max / Team / Enterprise** plan (25 runs/day cap). **Does not fit Pro (5/day)** — trim to 5 total if you're on Pro, or drop one of the deep topics per weekday.

All times are your local zone (IST in the examples below — Claude Code converts automatically). Minimum interval between routine triggers is 1 hour.

## Deep dispatches (template: `docs/routine-prompt-no-connector.md`, 1200–2500 words)

| Routine name                     | Slug                    | Trigger     | Time      | Focus                                                   |
| -------------------------------- | ----------------------- | ----------- | --------- | ------------------------------------------------------- |
| Agent engineering roundup        | `agent-engineering`     | daily       | 10:00     | New agent frameworks, evals, papers                     |
| Dev skills & tooling             | `dev-skills`            | daily       | 13:00     | Notable engineering techniques, tooling, changelogs     |
| Indian equity markets close      | `markets`               | weekdays    | 18:00     | Nifty/Sensex close, FII/DII, top movers, central bank   |
| Personal improvement & research  | `personal-improvement`  | daily       | 20:00     | Sleep, focus, longevity, habit formation research       |
| Tech & AI industry               | `tech-ai`               | daily       | 23:00     | Launches, funding, regulatory moves, major leaks        |

Swap any slug/topic for whatever you care about — the architecture doesn't care what the slugs are.

## World snapshots (template: `docs/world-update-prompt.md`, 400–700 words)

| Routine name              | Slug            | Trigger | Time  | Focus                                              |
| ------------------------- | --------------- | ------- | ----- | -------------------------------------------------- |
| World morning snapshot    | `world-morning` | daily   | 08:00 | What moved overnight US/Europe                     |
| World evening snapshot    | `world-evening` | daily   | 21:00 | Asian close + US midday, end-of-day geopolitics    |

## Timeline at a glance (IST)

```
08:00  ── world-morning          (short)
10:00  ── agent-engineering      (deep)
13:00  ── dev-skills             (deep)
18:00  ── markets                (deep, weekdays only)
20:00  ── personal-improvement   (deep)
21:00  ── world-evening          (short)
23:00  ── tech-ai                (deep)
```

That's 7 runs weekdays, 6 on weekends (markets paused). Well under the 25/day Max/Team/Enterprise cap; each run draws from subscription usage same as an interactive session.

## One-time setup (per routine)

1. claude.ai/code/routines → **New routine**.
2. **Name** per the table above.
3. **Prompt** — paste from the relevant template (`docs/routine-prompt-no-connector.md` for deep, `docs/world-update-prompt.md` for snapshots). Substitute `{{TOPIC}}` / `{{WINDOW}}` and `{{slug}}`.
4. **Repositories:** attach `the-dispatch` (so `scripts/*.sh` are present on every run).
5. **Environment:** the one with `DISPATCH_URL` + `DISPATCH_TOKEN` set. Create it once at claude.ai/code/environments if you haven't.
6. **Connectors:** none. Remove anything preselected.
7. **Trigger:** pick the preset + time from the tables above.
8. **Run now** once to smoke-test the path. Open the session URL, watch the `bash scripts/*.sh` calls, check the dashboard for the filed report.

Once all seven are in place, turn on a nightly backup cron on the VPS (`rsync` of `reports.db*` + `archive/` to your offsite host) and you're done.

## If you're on Pro (5 runs/day)

Pick five. My suggestion:

| Slug             | Trigger  | Time  |
| ---------------- | -------- | ----- |
| `world-morning`  | daily    | 08:00 |
| `agent-engineering` | daily | 11:00 |
| `markets`        | weekdays | 18:00 |
| `world-evening`  | daily    | 21:00 |
| `tech-ai`        | daily    | 23:00 |

Leaves two deep slots (`dev-skills`, `personal-improvement`) as candidates for on-demand via the **Queue a Brief** form on the dashboard — you submit a request, and the next matching scheduled run picks it up. Or run them manually on weekends via **Run now** when you have spare capacity.
