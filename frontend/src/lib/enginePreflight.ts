export interface EnginePreflightDeck {
  label: string;
  commander?: string;
  cards?: string[];
  lands?: string[];
  sideboard?: string[];
}

export interface UnsupportedEngineCard {
  deckLabel: string;
  name: string;
  reason: string;
}

// Cards the engine can technically parse but a player/bot cannot actually run
// (physical dexterity or a sub-game). This is a deliberately NARROW hard-block
// list — it must stay in sync with the backend's canonical known-manual set
// (engine/scripts/build-support-manifest.cjs KNOWN_MANUAL_CARDS, surfaced via
// the /api/card-support endpoints) so the client pre-launch gate and the server
// never give a different answer for the same card. The reason strings below are
// the manifest's exact `knownManual` wording; the drift test in
// frontend/tests/enginePreflight.test.ts cross-checks both the card set and the
// wording against mtg_data/card_support.json.
//
// NOTE: this is intentionally not the full server preflight. The server reports
// every card with any unparsed clause; using that as a hard launch gate would
// block far more decks than intended. This list only blocks the truly-unplayable
// manual cards.
export const ENGINE_UNSUPPORTED_CARD_REASONS: Record<string, string> = {
  'Chaos Orb': 'Manual dexterity / subgame not automated',
  'Falling Star': 'Manual dexterity / subgame not automated',
  Shahrazad: 'Manual dexterity / subgame not automated',
};

function normalizeCardNameForPreflight(raw: string | undefined): string {
  let name = (raw || '')
    .replace(/\s+#.*$/, '')
    .replace(/^[*\-]\s*/, '')
    .trim();
  const quantityMatch = name.match(/^\s*\d+\s*x?\s*(?:\[[^\]]+\]\s*)?(.+)$/i);
  if (quantityMatch) name = quantityMatch[1].trim();
  while (true) {
    const cleaned = name.replace(/\s+\*[^*]+\*\s*$/g, '').trim();
    if (cleaned === name) break;
    name = cleaned;
  }
  return name
    .replace(/\s+\[[^\]]+\](?:\s+\S+)?$/i, '')
    .replace(/\s+\([^)]+\).*$/i, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function findUnsupportedEngineCards(decks: EnginePreflightDeck[]): UnsupportedEngineCard[] {
  const unsupported: UnsupportedEngineCard[] = [];
  const seen = new Set<string>();
  for (const deck of decks) {
    const names = [
      deck.commander,
      ...(deck.cards || []),
      ...(deck.lands || []),
      ...(deck.sideboard || []),
    ];
    for (const rawName of names) {
      const name = normalizeCardNameForPreflight(rawName);
      const reason = ENGINE_UNSUPPORTED_CARD_REASONS[name];
      const key = `${deck.label}:${name}`;
      if (!reason || seen.has(key)) continue;
      seen.add(key);
      unsupported.push({ deckLabel: deck.label, name, reason });
    }
  }
  return unsupported;
}

export function formatUnsupportedEngineCards(unsupported: UnsupportedEngineCard[]): string {
  if (unsupported.length === 0) return '';
  const details = unsupported
    .map(card => `${card.deckLabel}: ${card.name} - ${card.reason}`)
    .join('; ');
  return `Engine preflight failed: ${details}`;
}
