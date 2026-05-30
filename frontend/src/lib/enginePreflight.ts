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

export const ENGINE_UNSUPPORTED_CARD_REASONS: Record<string, string> = {
  'Chaos Orb': 'Manual dexterity / physical-card resolution is not automated.',
  'Falling Star': 'Manual dexterity / physical-card resolution is not automated.',
  Shahrazad: 'Subgame creation is not automated.',
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
