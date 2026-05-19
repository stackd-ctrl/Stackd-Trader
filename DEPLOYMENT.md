# STACKD TRADER — Deployment guide

Production deploy target: **Vercel**. Crons fire on Vercel's scheduler; the only
component that does NOT run on Vercel is the Alpaca WebSocket stream (it's a
long-lived TCP connection; serverless functions kill it after their 60s budget).
For Day 5 the WebSocket is wired but not required — the signal-scan cron pulls
Polygon candles every minute, so the system runs fine without a persistent
streaming process.

---

## 0. Prerequisites

- GitHub repo (push your local working copy to it)
- Vercel account
- Live `.env.local` with all 9 env vars filled
- Supabase migrations 001 through 006 applied
- `npm run build` completes clean locally

---

## 1. Push to GitHub

```bash
cd C:\Users\hicks\stackd-trader
git init                                       # if not already a repo
git add .
git commit -m "STACKD TRADER Day 5 ready for prod"
# create empty repo on github.com, then:
git remote add origin git@github.com:<you>/stackd-trader.git
git branch -M main
git push -u origin main
```

`.gitignore` already excludes `.env.local`, `node_modules/`, and `.next/`.

---

## 2. Connect to Vercel

1. https://vercel.com/new
2. Import the `stackd-trader` repo
3. Framework preset: **Next.js** (auto-detected)
4. Root directory: leave at repo root
5. Don't click Deploy yet — set env vars first (step 3)

---

## 3. Add environment variables

Settings → Environment Variables. Add each of the 9 vars from `.env.local`,
scoped to **Production** (and Preview if you want preview deploys to work):

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role (secret) |
| `ANTHROPIC_API_KEY` | console.anthropic.com → Settings → API keys |
| `TRADING_MODE` | `paper` (or `live` for production accounts) |
| `ALPACA_API_KEY_ID` | alpaca.markets → Paper or Live → API Keys |
| `ALPACA_API_SECRET_KEY` | same |
| `ALPACA_PAPER_BASE_URL` | `https://paper-api.alpaca.markets` |
| `ALPACA_LIVE_BASE_URL` | `https://api.alpaca.markets` |
| `ALPACA_DATA_BASE_URL` | `https://data.alpaca.markets` |
| `ALPACA_STREAM_STOCKS` | `wss://stream.data.alpaca.markets/v2/iex` |
| `ALPACA_STREAM_CRYPTO` | `wss://stream.data.alpaca.markets/v1beta3/crypto/us` |
| `POLYGON_API_KEY` | polygon.io → Dashboard → API Keys |
| `POLYGON_BASE_URL` | `https://api.polygon.io` |
| `FMP_API_KEY` | financialmodelingprep.com → API key (optional; calendar is paid) |
| `FMP_BASE_URL` | `https://financialmodelingprep.com/api/v3` |
| `CRON_SECRET` | **Vercel auto-generates** when you enable cron jobs. Set it in env so the routes can validate the bearer token. |

---

## 4. Deploy

Click **Deploy**. First build takes ~2 minutes. When done, click **Visit**.

---

## 5. Verify cron jobs

After the first deploy, go to **Project → Cron Jobs**. You should see five entries
from `vercel.json`:

| Path | Schedule | Behavior |
|---|---|---|
| `/api/cron/morning` | `0 13 * * 1-5` | 9:00am ET weekdays |
| `/api/cron/signal-scan` | `* * * * 1-5` | every minute, weekdays |
| `/api/cron/anomaly-check` | `*/15 * * * 1-5` | every 15 min, weekdays |
| `/api/cron/position-monitor` | `*/1 * * * 1-5` | every minute, weekdays |
| `/api/cron/evening` | `30 20 * * 1-5` | 4:30pm ET weekdays |

Vercel attaches `Authorization: Bearer ${CRON_SECRET}` automatically; our
`isAuthorizedCron` helper validates it.

---

## 6. Health check on production URL

```
GET https://<your-deploy>.vercel.app/api/test
```

Should return `"overall_health":"healthy"` with all 4 service checks ✓ and all
9 env vars present. If anything is red, fix and redeploy.

Also visit the dashboard at the root URL and open **Settings → Health check**
for the same view in UI.

---

## 7. First morning brief

The morning cron fires at **9:00am ET on the next weekday**. To verify before
then, trigger it manually from **Settings → Manual cron triggers → Morning Brief**.
The first run will:

1. Refresh the economic calendar (will 403 if you're on FMP free tier — non-fatal)
2. Refresh news from Polygon
3. Compute regime via Claude
4. Generate a morning brief and store it in `daily_summaries`
5. Auto-activate the bot for the day

After it runs, the dashboard Overview should show a **Morning Brief** card at
the top.

---

## 8. Post-deploy checklist

- [ ] All 6 Supabase migrations applied (001 → 006)
- [ ] Health check is `healthy`
- [ ] Paper activation completed (Overview → click ACTIVATE PAPER TRADING)
- [ ] Manual signal-scan run produces signals
- [ ] Open Alpaca paper dashboard: any new trades from the bot appear there
- [ ] Open Supabase `bot_event_log`: see `category='order'` entries on entries/exits

If any step fails, the `/api/test` endpoint pinpoints which dependency is bad.

---

## What does NOT run on Vercel

- **`lib/alpaca/stream.ts`** — long-lived WebSocket. Serverless can't host it.
  If you need real-time price ticks instead of 60s candle polling, run this
  worker on a small VPS or Railway service that imports the same lib and writes
  ticks to Supabase Realtime.

For Day 5 the candle-poll path is the production-ready setup.
