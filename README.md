# Plate

Photo calorie tracker you install on your phone. Snap a meal, scan a barcode, or read a label; set a goal with a deadline and track your pace.

- **Frontend:** one `index.html` (no build step) + PWA manifest and service worker
- **Backend:** two Vercel serverless functions
  - `api/ai.js` sends photos/prompts to the Claude API (your key stays on the server)
  - `api/barcode.js` looks up products in Open Food Facts (free)
- **Data:** stored on your device (localStorage). Use *Targets → App settings → Export backup* to move phones.

## Deploy (about 10 minutes)

1. **Get an API key** at https://console.anthropic.com and add a little credit. It's pay-per-use, see the pricing page in https://docs.claude.com.
2. **Push this folder to GitHub** (private repo is fine).
3. **Import it on https://vercel.com** → New Project → pick the repo. Framework preset: *Other*. No build command.
4. **Add environment variables** in Vercel → Settings → Environment Variables:
   - `ANTHROPIC_API_KEY`: your key
   - `APP_PASSCODE`: a long passcode. **Don't skip this.** Without it, anyone who finds your URL can spend your credits.
5. Deploy, then open the URL on your phone and enter the passcode when asked.

## Install on your phone

- **iPhone (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** menu → *Install app*

It opens full-screen with its own icon, and the shell works offline (estimates need a connection).

## Run locally

```bash
npm i -g vercel
cp .env.example .env.local   # fill in your key
vercel dev                   # http://localhost:3000
```

## Using Gemini instead

Set `AI_PROVIDER=gemini` and `GEMINI_API_KEY` (free key from https://aistudio.google.com) in Vercel. Nothing else changes. Google's free tier has daily and per-minute limits; if you hit them you'll see "Too many requests," and linking billing raises them. Set `GEMINI_MODEL` to whichever current Flash model you want (see Google's model list).

## Settings

| Variable | Default | Notes |
|---|---|---|
| `MODEL` | `claude-sonnet-5-5` | Meal photos, labels, plans |
| `FAST_MODEL` | `claude-haiku-4-5-20251001` | Barcode digit reading fallback. Set `MODEL` to this too for cheaper photo estimates, with somewhat lower accuracy. |

## Ideas for v2

- Accounts + cloud sync (Supabase or Firebase) instead of on-device storage
- Rate limiting per IP on `/api/ai` (e.g. Upstash)
- Wrap it with Capacitor to ship to the App Store / Play Store
