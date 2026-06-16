# Card-Support API

> Per-card and per-deck engine-support data for the Commander rules engine.
> Built for bot / AI integrators who need to know, **before** they sit down to
> play, whether the engine can actually run a given card or an entire deck.

- **Base URL:** `https://deckreps.app/api/card-support`
- **Format:** JSON over HTTPS.
- **Auth:** API key required on every endpoint (see [Authentication](#authentication)).
- **Versioned:** every response is tied to a manifest `version` (see
  [Versioning & caching](#versioning--caching)).
- **Status:** live. Current snapshot — 36,917 cards, 30,247 supported,
  30,245 playable, engine coverage 83.98%.

---

## The one concept that matters: `supported` vs `playable`

The whole point of this API is **honesty**: it never claims a card works when
the engine can't actually run it. Two booleans encode that promise.

| Field | Meaning |
|-------|---------|
| `supported` | The engine **parses and executes every ability** on the card. |
| `playable`  | `supported` **AND** not a "known-manual" card. This is the boolean a bot should gate on. |

`playable = supported && !knownManual`.

A *known-manual* card is one the engine technically parses but that requires
something a bot can't do — physical dexterity (Chaos Orb, Falling Star) or
running a sub-game (Shahrazad). Those report `supported: true, playable: false`
with a `knownManual` reason.

**Gate your bot on `playable`.** Treat `supported` as engine-internal detail.

The guarantee is one-directional and deliberately conservative: a card may be
reported *not* playable when in doubt, but a card is **never** reported playable
unless the engine can run it. A card the engine has never seen (not in the data
set) is reported as **unknown**, which also counts against a deck's playability.

---

## Authentication

Every endpoint requires an API key, issued per integrator. Send it on each
request in **either**:

- the `X-API-Key` header, **or**
- the `Authorization: Bearer <key>` header.

```bash
curl -H 'X-API-Key: YOUR_KEY' https://deckreps.app/api/card-support
curl -H 'Authorization: Bearer YOUR_KEY' https://deckreps.app/api/card-support
```

A missing or invalid key returns `401 Unauthorized` with a
`WWW-Authenticate: Bearer` header. Keep your key secret — send it only over
HTTPS, in a header (never a query string, which leaks into logs). Contact the
operator to obtain or rotate a key.

Your requests are metered **per key** (see [Limits](#limits)) — rotating IPs
won't change your quota, and another integrator's traffic can't consume yours.

A key may also carry a **request allowance (quota)**. Each successful call counts
against it; failed calls (4xx/5xx) are not charged. When the allowance is
exhausted the API returns `403` until the operator tops it up. Keys without a
quota are unlimited.

---

## Endpoints at a glance

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/card-support` | Manifest metadata (counts, coverage %, version). |
| `GET`  | `/api/card-support/{name}` | Support status for one card. |
| `POST` | `/api/card-support/batch` | Support status for up to 500 cards. |
| `POST` | `/api/card-support/preflight` | **Whole-deck verdict** — the headline endpoint. |
| `GET`  | `/api/card-support/unsupported` | Paginated feed of every card a bot **cannot** run. |

---

## `GET /api/card-support` — metadata

Returns overall statistics and the manifest version. Emits an `ETag`; send it
back via `If-None-Match` to get a cheap `304 Not Modified` when nothing changed.

**Response `200`:**

```json
{
  "generatedAt": "2026-06-15T18:30:00Z",
  "engineCoveragePercent": 83.98,
  "totalCards": 36917,
  "supportedCards": 30247,
  "playableCards": 30245,
  "source": "mtg_data/cards_min.jsonl",
  "version": "e5d616617f4a3024"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `generatedAt` | string\|null | ISO-8601 timestamp the manifest was built. |
| `engineCoveragePercent` | number\|null | Honest parser coverage of the engine. |
| `totalCards` | int | Cards in the data set. |
| `supportedCards` | int | Cards where every ability parses. |
| `playableCards` | int | Cards a bot can run (`supported && !knownManual`). |
| `version` | string\|null | 16-char content hash; changes iff the data changes. Also the `ETag`. |

**Example:**

```bash
curl https://deckreps.app/api/card-support
# Conditional request — returns 304 with an empty body if unchanged:
curl -H 'If-None-Match: "e5d616617f4a3024"' https://deckreps.app/api/card-support
```

---

## `GET /api/card-support/{name}` — single card

`{name}` may be a bare card name or a decorated decklist token — quantities,
set codes, foil markers, and collector numbers are stripped automatically (see
[Name resolution](#name-resolution)). Double-faced / split / adventure cards
resolve from the front-face name.

**Response `200`** ([`CardSupportEntry`](#cardsupportentry)):

```json
{
  "name": "Chaos Orb",
  "supported": true,
  "playable": false,
  "viaOverride": false,
  "faces": [
    { "name": "Chaos Orb", "kind": "Activated", "supported": true }
  ],
  "knownManual": "Manual dexterity / subgame not automated"
}
```

**Status codes:** `200` found · `404` not in the data set · `503` manifest not built.

**Examples:**

```bash
curl 'https://deckreps.app/api/card-support/Sol%20Ring'
curl 'https://deckreps.app/api/card-support/1%20Sol%20Ring%20(LEA)%201'   # -> resolves to "Sol Ring"
curl 'https://deckreps.app/api/card-support/Westvale%20Abbey'             # -> DFC front face
```

---

## `POST /api/card-support/batch` — many cards

Look up up to **500** names in one call.

**Request:**

```json
{ "names": ["Sol Ring", "Shahrazad", "No Such Card"] }
```

**Response `200`:**

```json
{
  "results": {
    "Sol Ring":     { "name": "Sol Ring", "supported": true,  "playable": true,  "faces": [/* … */], "knownManual": null },
    "Shahrazad":    { "name": "Shahrazad", "supported": false, "playable": false, "faces": [/* … */], "knownManual": "Manual dexterity / subgame not automated" },
    "No Such Card": null
  },
  "summary": { "requested": 3, "supported": 1, "playable": 1, "unsupported": 1, "unknown": 1 }
}
```

- `results` is keyed by the **exact string you sent**; unknown names map to `null`.
- Counts in `summary`: `supported`/`unsupported` are by `supported`; `playable`
  counts entries with `playable: true`; `unknown` is names not in the data set.

**Status codes:** `200` · `400` more than 500 names · `503` manifest not built.

---

## `POST /api/card-support/preflight` — whole-deck verdict

The endpoint most integrators want. Hand it a raw decklist (or a list of names)
and get back a single conservative **"can my bot run this whole deck"** answer
plus the exact problem cards.

**Request** — supply `decklist`, `names`, or both (they're merged):

```json
{ "decklist": "Commander\n1 Sol Ring\n1 Westvale Abbey\n1 Shahrazad\n1 Made Up Card\nRamp (3)" }
```

```json
{ "names": ["Sol Ring", "Westvale Abbey", "Shahrazad"] }
```

The `decklist` field accepts the export text of Moxfield / Archidekt / MTGO /
MTGGoldfish as-is. Quantities, set codes, foil markers, `SB:` sideboard
prefixes, blank lines, `//` and `#` comments, and section / category headers
(`Commander`, `Deck`, `Sideboard`, `Ramp (10)`, …) are all parsed or skipped.
Cards are resolved and deduplicated by canonical identity, so printing and
case variants of the same card collapse and their quantities sum.

**Response `200`:**

```json
{
  "deckPlayable": false,
  "summary": {
    "totalCards": 4,
    "uniqueCards": 4,
    "playableCards": 2,
    "unsupportedCards": 1,
    "unknownCards": 1
  },
  "unsupported": [
    {
      "name": "Shahrazad",
      "quantity": 1,
      "reasons": ["Players play a Magic subgame, using their libraries as their decks. …"],
      "knownManual": "Manual dexterity / subgame not automated"
    }
  ],
  "unknown": [
    { "name": "Made Up Card", "quantity": 1, "reasons": [], "knownManual": null }
  ],
  "engineCoveragePercent": 83.98,
  "generatedAt": "2026-06-15T18:30:00Z"
}
```

| Field | Meaning |
|-------|---------|
| `deckPlayable` | `true` only if **every** card is playable **and** none are unknown. |
| `summary.totalCards` | Sum of quantities across recognized lines. |
| `summary.uniqueCards` | Distinct resolved cards. |
| `summary.playableCards` / `unsupportedCards` / `unknownCards` | Distinct-card counts. |
| `unsupported[]` | Cards the engine can't fully run, each with `quantity`, `reasons` (the offending oracle clauses, or the `knownManual` note), and `knownManual`. |
| `unknown[]` | Cards not in the data set (typos, brand-new cards, non-card lines). |

> **Strict vs. lenient gating.** `deckPlayable` is the strict, conservative
> verdict (unknowns count against it). If you'd rather ignore unknowns and only
> block on cards the engine *knows* it can't run, gate on
> `summary.unsupportedCards === 0` instead.

**Status codes:** `200` · `400` neither `decklist` nor `names` given · `400`
`decklist` over 200,000 chars · `400` more than 1,000 distinct cards · `503`
manifest not built.

**Example:**

```bash
curl -X POST https://deckreps.app/api/card-support/preflight \
  -H 'Content-Type: application/json' \
  -d '{"decklist":"1 Sol Ring\n1 Westvale Abbey\n1 Shahrazad"}'
```

---

## `GET /api/card-support/unsupported` — the "can't run" feed

Every card a bot **cannot** run (unsupported **or** known-manual), with reasons.
This is the small set (relative to the whole DB), so a licensee can pull it
once and pre-filter a card pool / ban-list offline instead of paging the entire
catalog through `/batch`.

**Query params:** `offset` (default `0`, ≥ 0) · `limit` (default `2000`, 1–10,000).

**Response `200`:**

```json
{
  "count": 6672,
  "returned": 3,
  "offset": 0,
  "version": "e5d616617f4a3024",
  "cards": [
    {
      "name": "\"Rumors of My Death . . .\"",
      "supported": false,
      "playable": false,
      "knownManual": null,
      "reasons": ["{3}{B}, Exile a permanent you control with a … watermark: …"]
    }
  ]
}
```

`count` is the total not-playable set; page with `offset`/`limit`. Cards are
sorted by name and every entry has `playable: false`.

**Example:**

```bash
curl 'https://deckreps.app/api/card-support/unsupported?offset=0&limit=2000'
```

---

## Data models

### CardSupportEntry

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Resolved card name. |
| `supported` | bool | Engine parses & runs every ability. |
| `playable` | bool | `supported && !knownManual` — **gate on this**. |
| `viaOverride` | bool | Support comes from a manual override definition rather than the auto-parser. |
| `faces` | [CardSupportFace](#cardsupportface)[] | One entry per card face. |
| `knownManual` | string\|null | Why a parsed card still isn't bot-playable. |

### CardSupportFace

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Face name. |
| `kind` | string | What the parser produced for this face (see below). |
| `supported` | bool | This face parses & runs. |
| `unsupportedText` | string\|null | The oracle clause that couldn't be run (present only when `supported: false`). |

**`kind` values:** `Spell`, `Activated`, `ETB`, `StaticAbility`, `Triggered`,
`KeywordOnly`, `Dies`, `Modal`, `EntryCounters`, `ManaAbility`, `Unparsed`.

---

## Name resolution

Both single-card and deck inputs go through the same lenient normalization, so
you can paste decklist lines verbatim. It strips, in order:

- a leading quantity — `1`, `2x`, `3 x` …
- an MTGO section prefix — `SB:`, `SIDEBOARD:`, `CMDR:`, `MB:` …
- foil / annotation markers — `*F*`, `*Foil*` …
- a trailing set code / collector number — `[LEA]`, `(LEA) 123`, `(M21) 45` …
- a trailing `# comment`.

Resolution tries the **exact** card name first, then the normalized form, so a
card whose real name contains parentheses (`Need for Speed (Not the Odyssey
One)`) or starts with a number (`1996 World Champion`) is never mis-read.
Double-faced, modal-DFC, split, adventure, and aftermath cards
(`Front // Back`) resolve from either the full name or the front-face name.
Matching is case-insensitive.

---

## Versioning & caching

- The `version` field (and the `ETag` header on the metadata endpoint) is a
  16-char content hash of the manifest. It changes **iff** the support data
  changes — which happens as the engine's coverage improves.
- Poll `GET /api/card-support` with `If-None-Match: "<version>"`; a `304`
  means your cached data is still current. Re-sync only when the version moves.
- The data is regenerated and redeployed alongside every engine coverage
  increment, so coverage trends upward over time and previously-unsupported
  cards become supported.

---

## Limits

| Limit | Value |
|-------|-------|
| Batch names per request | 500 |
| Preflight decklist size | 200,000 characters |
| Preflight distinct cards | 1,000 |
| Unsupported-feed page size | 10,000 |
| Single card-name length | 256 characters (longer is truncated → reported unknown) |
| Rate limit (authenticated) | 600 requests / minute / key |
| Rate limit (anonymous, if a deployment allows it) | 60 requests / minute / IP |

Rate limits are metered per API key (not per IP), so they can't be evaded by
rotating addresses and one integrator can't exhaust another's quota. Exceeding
the limit returns `429 Too Many Requests` with a `Retry-After` header. Inputs are
hardened against malformed and adversarial payloads; over-long or malformed
names resolve to `unknown` rather than erroring.

---

## Error responses

All errors are JSON: `{ "detail": "<message>" }`.

| Status | When |
|--------|------|
| `400` | Bad request — oversized batch/decklist, too many distinct cards, or no input. |
| `401` | Missing, invalid, or revoked API key. |
| `403` | Valid key, but its request allowance (quota) is exhausted. |
| `404` | Single-card lookup for a name not in the data set. |
| `429` | Rate limit exceeded (see `Retry-After`). |
| `503` | The support manifest isn't built/loaded on the server. |

---

## Integration recipes

> All examples need your API key. The snippets below assume `KEY=YOUR_KEY`; the
> per-endpoint examples above omit `-H "X-API-Key: ..."` only for brevity.

**1 — Gate a bot before a game (whole deck):**

```bash
curl -X POST https://deckreps.app/api/card-support/preflight \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  --data-binary @my-deck.txt-as-json
# Proceed iff deckPlayable === true (or summary.unsupportedCards === 0 to ignore unknowns).
```

**2 — Pre-filter a card pool offline:**

```bash
# Pull the "can't run" set once, cache by version, and exclude those names locally.
curl -H "X-API-Key: $KEY" 'https://deckreps.app/api/card-support/unsupported?limit=10000'
```

**3 — Poll for updates cheaply:**

```bash
curl -H "X-API-Key: $KEY" -H 'If-None-Match: "<your cached version>"' \
  https://deckreps.app/api/card-support
# 304 => no change; 200 => re-sync the data you depend on.
```

---

## Implementation notes

- Source: [`backend/main.py`](../backend/main.py) (the `Per-card engine-support
  manifest API` section).
- Data: `mtg_data/card_support.json`, produced by
  [`engine/scripts/build-support-manifest.cjs`](../engine/scripts/build-support-manifest.cjs)
  using the **same** honesty crediting as the engine's parser-coverage audit.
- Tests: [`backend/tests/test_card_support.py`](../backend/tests/test_card_support.py).
- Live functional probe: [`engine/scripts/probe_card_support_api.py`](../engine/scripts/probe_card_support_api.py).
