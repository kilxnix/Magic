export interface LocalDeckUrlImportResult {
  format: 'standard' | 'commander';
  title: string;
  deckText: string;
  source: 'bundled-mtggoldfish' | 'bundled-moxfield';
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

const DARGO_THRASIOS_DUEL_COMMANDER = [
  'Commander',
  '1 Dargo, the Shipwrecker',
  '1 Thrasios, Triton Hero',
  '',
  'Deck',
  '1 Shadowspear',
  '1 Oko, Thief of Crowns',
  '1 Daze',
  '1 Eldritch Evolution',
  "1 Thespian's Stage",
  '1 Force Spike',
  "1 Urza's Bauble",
  '1 Flame Slash',
  '1 Breeding Pool',
  '1 Stomping Ground',
  '1 Island',
  '1 Mountain',
  '1 Steam Vents',
  '1 Kuldotha Rebirth',
  '1 Memnite',
  '1 Spellbook',
  '1 Phyrexian Walker',
  '1 Primeval Titan',
  '1 Gitaxian Probe',
  '1 Mental Misstep',
  '1 Gilded Drake',
  '1 Red Elemental Blast',
  '1 Tropical Island',
  '1 Taiga',
  '1 Volcanic Island',
  '1 Underworld Breach',
  '1 Ketria Triome',
  '1 Raking Claws',
  '1 Shield Sphere',
  '1 Bone Saw',
  '1 Simian Spirit Guide',
  '1 Opt',
  '1 Flusterstorm',
  '1 Brainstorm',
  '1 Swan Song',
  "1 Tormod's Crypt",
  '1 Welding Jar',
  '1 Dryad Arbor',
  "1 Urza's Saga",
  '1 Misty Rainforest',
  '1 Subtlety',
  '1 Zuran Orb',
  '1 Endurance',
  '1 Lose Focus',
  '1 Gemstone Caverns',
  '1 Voldaren Epicure',
  '1 Sokenzan, Crucible of Defiance',
  '1 Otawara, Soaring City',
  '1 Boseiju, Who Endures',
  '1 Lightning Bolt',
  '1 Wrenn and Six',
  '1 Force of Negation',
  '1 Mana Leak',
  '1 Force of Will',
  "1 Mishra's Bauble",
  '1 Elvish Spirit Guide',
  '1 Chain Lightning',
  '1 Sylvan Library',
  '1 Gamble',
  '1 Ornithopter',
  '1 Skirk Prospector',
  '1 Wild Growth',
  '1 Worldly Tutor',
  "1 Minamo, School at Water's Edge",
  '1 Narset, Parter of Veils',
  '1 Soul-Guide Lantern',
  '1 Fiery Islet',
  '1 Waterlogged Grove',
  '1 Command Tower',
  '1 Broadside Bombardiers',
  '1 Faithless Looting',
  '1 Arboreal Grazer',
  '1 Flooded Strand',
  '1 Polluted Delta',
  '1 Wooded Foothills',
  '1 Bloodstained Mire',
  '1 Windswept Heath',
  '1 Impulsive Pilferer',
  '1 Forest',
  '1 Six',
  '1 Fury',
  '1 Strix Serenade',
  '1 Sink into Stupor // Soporific Springs',
  '1 Shifting Woodland',
  '1 Bountiful Landscape',
  '1 Arena of Glory',
  '1 Yavimaya, Cradle of Growth',
  '1 Dark Depths',
  '1 Lightning Greaves',
  '1 Talon Gates of Madara',
  '1 Birds of Paradise',
  '1 Gilded Goose',
  '1 Karplusan Forest',
  '1 Yavimaya Coast',
  '1 Scalding Tarn',
  '1 Scalding Tarn',
  '1 Arid Mesa',
  '1 Verdant Catacombs',
].join('\n');

const MOXFIELD_DECKS: Record<string, LocalDeckUrlImportResult> = {
  '6PzAgSJtFUirDSqAxkRV6Q': {
    format: 'commander',
    title: 'Dargo / Thrasios Duel Commander',
    deckText: DARGO_THRASIOS_DUEL_COMMANDER,
    source: 'bundled-moxfield',
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

function moxfieldIdFromUrl(url: string): string | null {
  const parsed = parseDeckUrl(url);
  if (!parsed) return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'moxfield.com') return null;

  const [kind, deckId] = parsed.pathname.split('/').filter(Boolean);
  if (kind === 'decks' && deckId) {
    return decodeURIComponent(deckId);
  }

  return null;
}

export function importDeckUrlLocally(url: string): LocalDeckUrlImportResult | null {
  const mtggoldfishId = mtggoldfishIdFromUrl(url);
  if (mtggoldfishId) {
    return MTGGOLDFISH_DECKS[mtggoldfishId] ?? null;
  }

  const moxfieldId = moxfieldIdFromUrl(url);
  if (moxfieldId) {
    return MOXFIELD_DECKS[moxfieldId] ?? null;
  }

  return null;
}
