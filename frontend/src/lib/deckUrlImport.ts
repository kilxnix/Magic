export interface LocalDeckUrlImportResult {
  format: 'standard';
  title: string;
  deckText: string;
  source: 'bundled-mtggoldfish';
}

const MONO_GREEN_LANDFALL = [
  "1 Archdruid's Charm",
  '4 Ba Sing Se',
  '4 Badgermole Cub',
  '4 Earthbender Ascension',
  '3 Escape Tunnel',
  '4 Esper Origins',
  '4 Fabled Passage',
  '13 Forest',
  '4 Icetill Explorer',
  '4 Llanowar Elves',
  "2 Meltstrider's Resolve",
  '4 Mightform Harmonizer',
  '2 Mossborn Hydra',
  '2 Promising Vein',
  '1 Royal Treatment',
  "4 Sazh's Chocobo",
  '',
  'Sideboard',
  "2 Meltstrider's Resolve",
  '2 Mossborn Hydra',
  '2 Pawpatch Formation',
  '1 Royal Treatment',
  '4 Sapling Nursery',
  '2 Soul-Guide Lantern',
  '2 Surrak, Elusive Hunter',
].join('\n');

const MTGGOLDFISH_DECKS: Record<string, LocalDeckUrlImportResult> = {
  'standard-mono-green-landfall-woe': {
    format: 'standard',
    title: 'Mono-Green Landfall',
    deckText: MONO_GREEN_LANDFALL,
    source: 'bundled-mtggoldfish',
  },
  '7752458': {
    format: 'standard',
    title: 'Mono-Green Landfall',
    deckText: MONO_GREEN_LANDFALL,
    source: 'bundled-mtggoldfish',
  },
};

function parseDeckUrl(url: string): URL | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(candidate);
  } catch {
    return null;
  }
}

function mtggoldfishIdFromUrl(url: string): string | null {
  const parsed = parseDeckUrl(url);
  if (!parsed) return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'mtggoldfish.com') return null;

  const [kind, deckId] = parsed.pathname.split('/').filter(Boolean);
  if ((kind === 'archetype' || kind === 'deck') && deckId) {
    return decodeURIComponent(deckId);
  }

  return null;
}

export function importDeckUrlLocally(url: string): LocalDeckUrlImportResult | null {
  const mtggoldfishId = mtggoldfishIdFromUrl(url);
  if (mtggoldfishId) {
    return MTGGOLDFISH_DECKS[mtggoldfishId] ?? null;
  }

  return null;
}
