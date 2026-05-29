# Magic Brains Launch Readiness

Last updated: May 24, 2026

## Production Shape

The public website can run as two Docker services:

- `web`: FastAPI backend on port `8000`, serving `/api/*`, `/shelector-api/*`, and the built React app.
- `shelector`: internal FastAPI agent service on port `8100`, used by the web service for deck import, opponent spawning, generated AI decks, and selector narration.

Start locally with:

```bash
cp .env.production.example .env
docker compose up --build
```

Then open `http://localhost:8000`.

## Required Runtime Data

The production image includes the runtime MTG data files needed for deck sourcing and AI deck generation:

- `mtg_data/cards_min.jsonl`
- `mtg_data/card_embeddings.npy`
- `mtg_data/card_embeddings_meta.json`
- `mtg_data/card_index.faiss`
- `mtg_data/draft_cards.jsonl`
- `data/ai_decks/deck_pool.json`

The Docker build intentionally excludes raw Scryfall bulk files, SQLite databases, local caches, models, and generated logs.

Use `/api/readiness` after deployment. It reports whether the static app, card data, embeddings, FAISS index, and AI deck pool are present.

## AdSense Setup

Set these values in `.env` before building:

```bash
VITE_SUPPORT_EMAIL=support@your-domain.com
VITE_ENABLE_ADS=true
VITE_REQUIRE_AD_CONSENT=true
VITE_ADSENSE_CLIENT_ID=ca-pub-your-publisher-id
VITE_ADSENSE_SLOT_LEADERBOARD=your-leaderboard-slot
VITE_ADSENSE_SLOT_MOBILE_BANNER=your-mobile-slot
VITE_ADSENSE_SLOT_SIDEBAR=your-sidebar-slot
ADS_TXT_PUBLISHER_ID=pub-your-publisher-id
```

These are build-time Vite values, so rebuild after changing them:

```bash
docker compose build --no-cache web shelector
docker compose up -d
```

Ad slots are limited to separated content bands and opt-in layout rails. The live play page, generator card-click surface, deck viewer card-click surface, and game controls are ad-free.

The Docker build generates `/ads.txt` when `ADS_TXT_PUBLISHER_ID` is set. Use the publisher ID without the `ca-` prefix.

## Consent

When `VITE_ENABLE_ADS=true` and `VITE_REQUIRE_AD_CONSENT=true`, the frontend shows an ad consent banner before loading the AdSense script. Declining prevents the script and ad slots from rendering. For broad public launch, use a Google-certified CMP for regions where Google requires one, then wire it to the same consent gate.

## Domain And Proxy

Recommended domain: `deckreps.app`. It checked as unregistered by RDAP and had no DNS record on May 25, 2026. See `docs/domain-options.md` for the short list.

For a real domain, set:

```bash
ALLOWED_ORIGINS=https://deckreps.app
```

The browser calls Shelector through `/shelector-api`, and the `web` service proxies to:

```bash
SHELECTOR_API_URL=http://shelector:8100
```

Do not expose the `shelector` service publicly unless you add separate auth/rate limits.

## Launch Checks

Before turning ads on publicly:

```bash
cd frontend && npm run build
cd engine && npm run test -- ai/speed.test.ts
cd engine && npm run test
docker compose up --build
```

Then verify:

- `/api/health` returns `{"status":"healthy"}`.
- `/api/readiness` returns `status: ready`.
- `/privacy`, `/terms`, `/contact`, and `/how-training-works` load.
- `/play` has no ad slots.
- `/generate` and `/deck/:id` do not place ads near card clicks or regenerate/play controls.
- Imported decks and platform-supplied/generated AI decks both launch into training.
- After the VPS update is live, run `scripts/goldfish_pod_ui_playtest.js`
  against `https://deckreps.app` with the production QA/admin token and confirm
  both 3-player and 4-player pods finish with zero pending and zero rejected
  real-engine actions.

## Public Hardening

The FastAPI app enforces basic launch guardrails:

- `MAX_REQUEST_BODY_BYTES` rejects oversized requests before work starts.
- `RATE_LIMIT_*` settings throttle expensive deck import, deck generation, AI deck generation, opponent spawn, chat, and selector calls.
- `/api/update/trigger` requires `ADMIN_TOKEN` through `x-admin-token` or `Authorization: Bearer ...`.

Run the public site behind Caddy with `deploy/Caddyfile`. Caddy terminates HTTPS, limits request bodies, adds basic security headers, and proxies to the Docker web service on `127.0.0.1:8000`.

IONOS-specific setup steps are in `docs/ionos-vps-deploy.md`.
