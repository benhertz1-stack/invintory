# Invintory

Personal wine-cellar manager. One owner, one passphrase, three ways in:

- **Claude app (phone / desktop / web)** via a remote MCP connector — add wines from label photos, place them on a shelf from a fridge photo, ask where a bottle is (you get a picture of the fridge with the shelf pulled out and the bottle lit, plus a link to the interactive 3D view), mark bottles drunk and rate them, get recommendations from your ratings.
- **Web app** — browse the collection, 3D fridge browser, full-screen locate view, rate after drinking, in-app chat with the same tools.
- **Claude Code / Claude Desktop on this PC** via the stdio MCP server (`.mcp.json`).

Data lives in Firestore (project `invintory-495823`). The server runs on Cloud Run.

## Layout

```
server/
  index.ts            Express app: auth, owner API, /mcp (Streamable HTTP), agent loop, static SPA
  auth.ts             Passphrase login + OAuth 2.1 authorization server (PKCE, dynamic registration)
  tools.ts            THE tool registry — shared by MCP, stdio MCP and the in-app agent
  wine-mcp-server.ts  MCP server wrapper + workflow instructions Claude sees
  render.ts           SVG→PNG fridge renders (sharp) for tool results
  db.ts               Firestore access, document types, helpers
  migrate.ts          Idempotent data migrations (run at boot, or `npm run migrate`)
  seed.ts             One-time CSV import for an empty database
  mcp.ts              stdio entry for local Claude clients
  passphrase.ts       Generates OWNER_PASSPHRASE_HASH + AUTH_SECRET
src/                  React 19 + Vite + Tailwind + react-three-fiber
scripts/mcp-smoke.mjs End-to-end test of the OAuth flow and MCP tools
```

Bottle positions: **fridge → shelf (1 = top) → position (1 = leftmost) → depth (1 front, 2 back)**.

## Local development

```bash
npm install
npm run passphrase          # prints a passphrase + the two env values; put them in .env
npm run dev                 # Vite on :5173, API on :3001 (Firestore via gcloud ADC)
npm run typecheck
node scripts/mcp-smoke.mjs http://localhost:3001 "<passphrase>" out.png
```

`.env` needs `ANTHROPIC_API_KEY`, `OWNER_PASSPHRASE_HASH`, `AUTH_SECRET`, `PUBLIC_BASE_URL=http://localhost:5173`.
Firestore locally uses `gcloud auth application-default login`.

## Deploy (Cloud Run)

```powershell
.\deploy.ps1 -SetSecrets    # first time / after changing the passphrase: pushes the two auth secrets
.\deploy.ps1                # build from source and deploy
```

Billing must be enabled on the project. The service stays `--allow-unauthenticated` at the
Cloud Run layer because the OAuth discovery endpoints must be public; everything else requires
the passphrase (session cookie) or a bearer token issued by the OAuth flow.

## Connecting the Claude app

Settings → Connectors → Add custom connector → URL `https://<service>/mcp`. Claude registers itself,
opens the sign-in page once, and you enter the passphrase. Tokens refresh automatically for 180 days.

## Monthly report

`server/report.ts` builds the monthly cellar email: drink-window alerts (past peak / last call / just
opened), current per-bottle prices (Claude Opus 5 looks them up with web search and updates the cellar's
market values; a monthly snapshot in `price_snapshots` powers the "vs last month" column), activity
since the previous report (added, opened, ratings, price moves), 5 buying ideas that balance price and
value against your ratings/preferences, and market notes on producers you own. Every report is stored in
`reports` and viewable at `/reports` in the web app.

- **Schedule:** a claude.ai routine (`invintory-monthly-report`, manage at claude.ai/code/routines) fires
  on the 1st ≈9:00 ET. It runs on the owner's Claude subscription: it fetches
  `GET /api/reports/context`, researches prices and picks with its own web tools, and POSTs them to
  `/api/reports/run` — so the scheduled run costs no API money. Both endpoints accept the
  `X-Report-Key` header (Secret Manager `REPORT_KEY`). A Cloud Scheduler job with the same name exists
  as a **paused** fallback that uses the API-key path (`gcloud scheduler jobs resume` to switch back;
  never run both).
- **Email:** Gmail SMTP via nodemailer — secrets `SMTP_USER` (your Gmail address) and `SMTP_PASS`
  (a Google App Password), env `REPORT_TO`. Until `SMTP_PASS` is set the report is generated and saved
  but not emailed.
- **On demand:** the Reports page ("Run now"), or ask Claude: *"send me my monthly cellar report"*
  (`send_monthly_report` tool). `drink_soon` gives the alerts alone.
- **Cost:** roughly $1–3 per run (Opus 5 + ~60 web searches).

To set the Gmail app password: Google Account → Security → 2-Step Verification → App passwords →
create one for "Invintory", then
`printf 'the 16 chars' | gcloud secrets versions add SMTP_PASS --data-file=- --project invintory-495823`
and redeploy (`.\deploy.ps1`).

## Changing the passphrase

`npm run passphrase -- "new words"` → update `.env` → `.\deploy.ps1 -SetSecrets`. Rotating `AUTH_SECRET`
logs every client out (the connector will ask for the passphrase again).
