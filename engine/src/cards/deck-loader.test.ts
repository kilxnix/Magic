import { describe, it, expect } from 'vitest';
import {
  ScryfallCard,
  GeneratedDeck,
  convertCard,
  convertGeneratedDeck,
  createCardLookup,
  parseCardsJsonl,
} from './deck-loader';

// Sample Scryfall card data
const sampleCommander: ScryfallCard = {
  id: 'commander-001',
  name: 'Atraxa, Praetors\' Voice',
  type_line: 'Legendary Creature — Phyrexian Angel Horror',
  oracle_text: 'Flying, vigilance, deathtouch, lifelink\nAt the beginning of your end step, proliferate.',
  mana_cost: '{G}{W}{U}{B}',
  cmc: '4.0',
  colors: ['W', 'U', 'B', 'G'],
  color_identity: ['W', 'U', 'B', 'G'],
  keywords: ['Flying', 'Vigilance', 'Deathtouch', 'Lifelink'],
  power: '4',
  toughness: '4',
};

const samplePartnerA: ScryfallCard = {
  id: 'partner-ravos',
  name: 'Ravos, Soultender',
  type_line: 'Legendary Creature - Human Cleric',
  oracle_text: 'Partner\nOther creatures you control get +1/+1.',
  mana_cost: '{3}{W}{B}',
  cmc: 5,
  colors: ['W', 'B'],
  color_identity: ['W', 'B'],
  keywords: ['Partner'],
  power: '2',
  toughness: '2',
};

const samplePartnerB: ScryfallCard = {
  id: 'partner-tana',
  name: 'Tana, the Bloodsower',
  type_line: 'Legendary Creature - Elf Druid',
  oracle_text: 'Partner\nTrample',
  mana_cost: '{2}{R}{G}',
  cmc: 4,
  colors: ['R', 'G'],
  color_identity: ['R', 'G'],
  keywords: ['Partner', 'Trample'],
  power: '2',
  toughness: '2',
};

const sampleCreature: ScryfallCard = {
  id: 'creature-001',
  name: 'Grizzly Bears',
  type_line: 'Creature — Bear',
  oracle_text: '',
  mana_cost: '{1}{G}',
  cmc: 2,
  colors: ['G'],
  color_identity: ['G'],
  keywords: [],
  power: '2',
  toughness: '2',
};

const sampleInstant: ScryfallCard = {
  id: 'instant-001',
  name: 'Lightning Bolt',
  type_line: 'Instant',
  oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  mana_cost: '{R}',
  cmc: '1.0',
  colors: ['R'],
  color_identity: ['R'],
  keywords: [],
};

const sampleLand: ScryfallCard = {
  id: 'land-001',
  name: 'Forest',
  type_line: 'Basic Land — Forest',
  oracle_text: '({T}: Add {G}.)',
  mana_cost: '',
  cmc: 0,
  colors: [],
  color_identity: ['G'],
  keywords: [],
};

const sampleArtifact: ScryfallCard = {
  id: 'artifact-001',
  name: 'Sol Ring',
  type_line: 'Artifact',
  oracle_text: '{T}: Add {C}{C}.',
  mana_cost: '{1}',
  cmc: '1.0',
  colors: [],
  color_identity: [],
  keywords: [],
};

describe('convertCard', () => {
  it('converts a creature card', () => {
    const def = convertCard(sampleCreature);

    expect(def.id).toBe('creature-001');
    expect(def.name).toBe('Grizzly Bears');
    expect(def.type_line).toBe('Creature — Bear');
    expect(def.mana_cost).toBe('{1}{G}');
    expect(def.cmc).toBe(2);
    expect(def.colors).toEqual(['G']);
    expect(def.card_types).toEqual(['creature']);
    expect(def.power).toBe(2);
    expect(def.toughness).toBe(2);
  });

  it('converts a legendary creature', () => {
    const def = convertCard(sampleCommander);

    expect(def.name).toBe('Atraxa, Praetors\' Voice');
    expect(def.card_types).toEqual(['creature']);
    expect(def.colors).toEqual(['W', 'U', 'B', 'G']);
    expect(def.color_identity).toEqual(['W', 'U', 'B', 'G']);
    expect(def.keywords).toContain('Flying');
    expect(def.keywords).toContain('Lifelink');
  });

  it('converts an instant', () => {
    const def = convertCard(sampleInstant);

    expect(def.card_types).toEqual(['instant']);
    expect(def.power).toBeUndefined();
    expect(def.toughness).toBeUndefined();
  });

  it('converts a land', () => {
    const def = convertCard(sampleLand);

    expect(def.card_types).toEqual(['land']);
    expect(def.mana_cost).toBe('');
    expect(def.cmc).toBe(0);
    expect(def.colors).toEqual([]);
    expect(def.color_identity).toEqual(['G']);
  });

  it('converts an artifact', () => {
    const def = convertCard(sampleArtifact);

    expect(def.card_types).toEqual(['artifact']);
    expect(def.colors).toEqual([]);
    expect(def.color_identity).toEqual([]);
  });

  it('keeps enchantment creature Gods as creatures', () => {
    const def = convertCard({
      id: 'xenagos-001',
      name: 'Xenagos, God of Revels',
      type_line: 'Legendary Enchantment Creature — God',
      oracle_text: 'Indestructible\nAs long as your devotion to red and green is less than seven, Xenagos isn\'t a creature.',
      mana_cost: '{3}{R}{G}',
      cmc: 5,
      colors: ['R', 'G'],
      color_identity: ['R', 'G'],
      keywords: ['Indestructible'],
      power: '6',
      toughness: '5',
    });

    expect(def.card_types).toEqual(['creature', 'enchantment']);
    expect(def.power).toBe(6);
    expect(def.toughness).toBe(5);
  });

  it('handles string cmc', () => {
    const def = convertCard({ ...sampleInstant, cmc: '3.5' });
    expect(def.cmc).toBe(3); // Floored
  });

  it('handles * power/toughness', () => {
    const varCard: ScryfallCard = {
      ...sampleCreature,
      power: '*',
      toughness: '*',
    };
    const def = convertCard(varCard);

    expect(def.power).toBe(0);
    expect(def.toughness).toBe(0);
  });

  it('handles missing oracle text', () => {
    const card: ScryfallCard = {
      ...sampleLand,
      oracle_text: undefined as any,
    };
    const def = convertCard(card);

    expect(def.oracle_text).toBe('');
  });
});

describe('createCardLookup', () => {
  const cards = [sampleCommander, sampleCreature, sampleInstant, sampleLand];
  const lookup = createCardLookup(cards);

  it('finds cards by exact name', () => {
    expect(lookup('Grizzly Bears')).toBe(sampleCreature);
    expect(lookup('Lightning Bolt')).toBe(sampleInstant);
  });

  it('finds cards case-insensitively', () => {
    expect(lookup('grizzly bears')).toBe(sampleCreature);
    expect(lookup('FOREST')).toBe(sampleLand);
  });

  it('finds cards with accent-insensitive names', () => {
    const seanceBoard: ScryfallCard = {
      id: 'seance-board',
      name: 'Séance Board',
      type_line: 'Artifact',
      oracle_text: '{T}: Add mana.',
      mana_cost: '{2}',
      cmc: 2,
      colors: [],
      color_identity: [],
      keywords: [],
    };

    const seanceLookup = createCardLookup([seanceBoard]);

    expect(seanceLookup('Seance Board')?.name).toBe('Séance Board');
  });

  it('returns undefined for missing cards', () => {
    expect(lookup('Nonexistent Card')).toBeUndefined();
  });

  it('finds individual MDFC faces by face name', () => {
    const disciple: ScryfallCard = {
      id: 'disciple-mdfc',
      name: 'Disciple of Freyalise // Garden of Freyalise',
      type_line: 'Creature — Elf Druid // Land',
      oracle_text: null,
      mana_cost: null,
      cmc: 6,
      colors: ['G'],
      color_identity: ['G'],
      keywords: [],
      card_faces: [
        {
          name: 'Disciple of Freyalise',
          type_line: 'Creature — Elf Druid',
          oracle_text: 'When Disciple of Freyalise enters the battlefield, sacrifice another creature. You gain X life and draw X cards.',
          mana_cost: '{3}{G}{G}{G}',
          colors: ['G'],
          power: '3',
          toughness: '3',
        },
        {
          name: 'Garden of Freyalise',
          type_line: 'Land',
          oracle_text: 'As Garden of Freyalise enters the battlefield, you may pay 3 life. If you don\'t, it enters tapped.\n{T}: Add {G}.',
          mana_cost: '',
          colors: [],
        },
      ],
    };

    const faceLookup = createCardLookup([disciple]);
    const creatureFace = faceLookup('Disciple of Freyalise');
    const landFace = faceLookup('Garden of Freyalise');

    expect(creatureFace?.name).toBe('Disciple of Freyalise');
    expect(landFace?.name).toBe('Garden of Freyalise');

    const def = convertCard(creatureFace!);
    expect(def.card_types).toEqual(['creature']);
    expect(def.mana_cost).toBe('{3}{G}{G}{G}');
    expect(def.power).toBe(3);
    expect(def.toughness).toBe(3);
  });

  it('finds slash-collapsed split card names', () => {
    const springMind: ScryfallCard = {
      id: 'spring-mind',
      name: 'Spring // Mind',
      type_line: 'Sorcery // Instant',
      oracle_text: null,
      mana_cost: null,
      cmc: 3,
      colors: ['G', 'U'],
      color_identity: ['G', 'U'],
      keywords: [],
      card_faces: [
        {
          name: 'Spring',
          type_line: 'Sorcery',
          oracle_text: 'Search your library for a basic land card.',
          mana_cost: '{2}{G}',
          colors: ['G'],
        },
        {
          name: 'Mind',
          type_line: 'Instant',
          oracle_text: 'Draw two cards.',
          mana_cost: '{4}{U}{U}',
          colors: ['U'],
        },
      ],
    };

    const splitLookup = createCardLookup([springMind]);

    expect(splitLookup('Spring/Mind')?.name).toBe('Spring // Mind');
  });

  it('prefers playable cards over art-series faces with the same name', () => {
    const artSeriesMountain: ScryfallCard = {
      id: 'art-mountain',
      name: 'Mountain // Mountain',
      layout: 'art_series',
      type_line: 'Card // Card',
      oracle_text: null,
      mana_cost: null,
      cmc: 0,
      colors: null,
      color_identity: [],
      keywords: [],
      legalities: { commander: 'not_legal' },
      card_faces: [
        { name: 'Mountain', type_line: 'Card', oracle_text: '', mana_cost: '', colors: [] },
      ],
    };
    const realMountain: ScryfallCard = {
      id: 'real-mountain',
      name: 'Mountain',
      type_line: 'Basic Land — Mountain',
      oracle_text: '({T}: Add {R}.)',
      mana_cost: '',
      cmc: 0,
      colors: [],
      color_identity: ['R'],
      keywords: [],
      legalities: { commander: 'legal' },
    };

    const mountainLookup = createCardLookup([artSeriesMountain, realMountain]);

    expect(mountainLookup('Mountain')?.id).toBe('real-mountain');
  });
});

describe('convertGeneratedDeck', () => {
  // Create 99 unique card entries for a valid deck
  function create99Cards(): ScryfallCard[] {
    const cards: ScryfallCard[] = [];
    for (let i = 0; i < 99; i++) {
      cards.push({
        id: `card-${i}`,
        name: `Test Card ${i}`,
        type_line: 'Creature — Test',
        oracle_text: '',
        mana_cost: '{1}',
        cmc: 1,
        colors: [],
        color_identity: [],
        keywords: [],
        power: '1',
        toughness: '1',
      });
    }
    return cards;
  }

  it('converts a valid 100-card deck', () => {
    const testCards = create99Cards();
    const allCards = [sampleCommander, ...testCards];
    const lookup = createCardLookup(allCards);

    const deck: GeneratedDeck = {
      id: 'deck-001',
      commander: 'Atraxa, Praetors\' Voice',
      list: testCards.map(c => c.name),
      colors: ['W', 'U', 'B', 'G'],
      bracket: 3,
      theme: 'Counters',
    };

    const result = convertGeneratedDeck(deck, lookup);

    expect(result.commander?.name).toBe('Atraxa, Praetors\' Voice');
    expect(result.library.length).toBe(99);
  });

  it('keeps sideboard cards outside the starting library', () => {
    const testCards = create99Cards();
    const allCards = [sampleCommander, sampleInstant, ...testCards];
    const lookup = createCardLookup(allCards);

    const deck: GeneratedDeck = {
      id: 'deck-sideboard',
      commander: 'Atraxa, Praetors\' Voice',
      list: testCards.map(c => c.name),
      sideboard: ['Lightning Bolt'],
      colors: ['W', 'U', 'B', 'G'],
      bracket: 3,
      theme: 'Counters',
    };

    const result = convertGeneratedDeck(deck, lookup);

    expect(result.library.length).toBe(99);
    expect(result.library.some(card => card.name === 'Lightning Bolt')).toBe(false);
    expect(result.sideboard.map(card => card.name)).toEqual(['Lightning Bolt']);
  });

  it('throws when a sideboard card is missing', () => {
    const testCards = create99Cards();
    const lookup = createCardLookup([sampleCommander, ...testCards]);

    const deck: GeneratedDeck = {
      id: 'deck-missing-sideboard',
      commander: 'Atraxa, Praetors\' Voice',
      list: testCards.map(c => c.name),
      sideboard: ['Missing Sideboard Card'],
      colors: ['W', 'U', 'B', 'G'],
      bracket: 3,
      theme: 'Counters',
    };

    expect(() => convertGeneratedDeck(deck, lookup)).toThrow('Sideboard cards not found');
  });

  it('keeps double-faced commander names intact', () => {
    const testCards = create99Cards();
    const aclazotz: ScryfallCard = {
      id: 'aclazotz',
      name: 'Aclazotz, Deepest Betrayal // Temple of the Dead',
      type_line: 'Legendary Creature - Bat God // Land',
      oracle_text: 'Flying, lifelink',
      mana_cost: '{3}{B}{B}',
      cmc: 5,
      colors: ['B'],
      color_identity: ['B'],
      keywords: ['Flying', 'Lifelink', 'Transform'],
      power: '4',
      toughness: '4',
    };
    const lookup = createCardLookup([aclazotz, ...testCards]);

    const deck: GeneratedDeck = {
      id: 'deck-dfc',
      commander: 'Aclazotz, Deepest Betrayal // Temple of the Dead',
      list: testCards.map(c => c.name),
      colors: ['B'],
      bracket: 3,
      theme: 'Discard',
    };

    const result = convertGeneratedDeck(deck, lookup);

    expect(result.commander?.name).toBe('Aclazotz, Deepest Betrayal // Temple of the Dead');
    expect(result.library.length).toBe(99);
  });

  it('uses the front face when a modal commander full name is split but only the front card is available', () => {
    const testCards = create99Cards();
    const tergrid: ScryfallCard = {
      id: 'tergrid-front',
      name: 'Tergrid, God of Fright',
      type_line: 'Legendary Creature - God',
      oracle_text: 'Menace',
      mana_cost: '{3}{B}{B}',
      cmc: 5,
      colors: ['B'],
      color_identity: ['B'],
      keywords: ['Menace'],
      power: '4',
      toughness: '5',
    };
    const lookup = createCardLookup([tergrid, ...testCards]);

    const deck: GeneratedDeck = {
      id: 'deck-tergrid-front-only',
      commander: "Tergrid, God of Fright // Tergrid's Lantern",
      list: testCards.map(c => c.name),
      colors: ['B'],
      bracket: 3,
      theme: 'Discard',
    };

    const result = convertGeneratedDeck(deck, lookup);

    expect(result.commander?.name).toBe('Tergrid, God of Fright');
    expect(result.commanders?.map(card => card.name)).toEqual(['Tergrid, God of Fright']);
    expect(result.library).toHaveLength(99);
  });

  it('keeps partner commanders together and leaves the library at 98 cards', () => {
    const testCards = create99Cards();
    const lookup = createCardLookup([samplePartnerA, samplePartnerB, ...testCards]);

    const deck: GeneratedDeck = {
      id: 'deck-partners',
      commander: 'Ravos, Soultender // Tana, the Bloodsower',
      list: testCards.map(c => c.name),
      colors: ['W', 'B', 'R', 'G'],
      bracket: 3,
      theme: 'Partners',
    };

    const result = convertGeneratedDeck(deck, lookup);

    expect(result.commander?.name).toBe('Ravos, Soultender');
    expect(result.commanders?.map(card => card.name)).toEqual([
      'Ravos, Soultender',
      'Tana, the Bloodsower',
    ]);
    expect(result.library).toHaveLength(98);
    expect(result.library.some(card => card.name === 'Tana, the Bloodsower')).toBe(false);
  });

  it('throws for missing commander', () => {
    const testCards = create99Cards();
    const lookup = createCardLookup(testCards); // No commander

    const deck: GeneratedDeck = {
      id: 'deck-001',
      commander: 'Missing Commander',
      list: testCards.map(c => c.name),
      colors: [],
      bracket: 1,
      theme: '',
    };

    expect(() => convertGeneratedDeck(deck, lookup)).toThrow('Commander not found');
  });

  it('pads short decks with basic lands', () => {
    const island: ScryfallCard = {
      id: 'island', name: 'Island', type_line: 'Basic Land — Island',
      oracle_text: '({T}: Add {U}.)', mana_cost: '', cmc: 0,
      colors: [], color_identity: ['U'], keywords: [],
    };
    const allCards = [sampleCommander, sampleCreature, sampleLand, island];
    const lookup = createCardLookup(allCards);

    const deck: GeneratedDeck = {
      id: 'deck-001',
      commander: 'Atraxa, Praetors\' Voice',
      list: ['Grizzly Bears', 'Forest'], // Only 2 cards
      colors: ['U'],
      bracket: 1,
      theme: '',
    };

    const result = convertGeneratedDeck(deck, lookup);
    expect(result.library.length).toBe(99);
  });

  it('pads missing cards with basic lands when enough cards found', () => {
    const island: ScryfallCard = {
      id: 'island', name: 'Island', type_line: 'Basic Land — Island',
      oracle_text: '({T}: Add {U}.)', mana_cost: '', cmc: 0,
      colors: [], color_identity: ['U'], keywords: [],
    };
    const testCards = create99Cards().slice(0, 90); // Only 90 cards
    const allCards = [sampleCommander, island, ...testCards];
    const lookup = createCardLookup(allCards);

    const missingNames = [];
    for (let i = 90; i < 99; i++) {
      missingNames.push(`Test Card ${i}`);
    }

    const deck: GeneratedDeck = {
      id: 'deck-001',
      commander: 'Atraxa, Praetors\' Voice',
      list: [...testCards.map(c => c.name), ...missingNames],
      colors: ['U'],
      bracket: 1,
      theme: '',
    };

    const result = convertGeneratedDeck(deck, lookup);
    expect(result.library.length).toBe(99);
  });
});

describe('parseCardsJsonl', () => {
  it('parses JSONL content', () => {
    const jsonl = [
      JSON.stringify(sampleCreature),
      JSON.stringify(sampleInstant),
      '', // Empty line
      JSON.stringify(sampleLand),
    ].join('\n');

    const cards = parseCardsJsonl(jsonl);

    expect(cards.length).toBe(3);
    expect(cards[0].name).toBe('Grizzly Bears');
    expect(cards[1].name).toBe('Lightning Bolt');
    expect(cards[2].name).toBe('Forest');
  });

  it('skips invalid JSON lines', () => {
    const jsonl = [
      JSON.stringify(sampleCreature),
      'not valid json',
      JSON.stringify(sampleLand),
    ].join('\n');

    const cards = parseCardsJsonl(jsonl);

    expect(cards.length).toBe(2);
  });

  it('handles empty content', () => {
    const cards = parseCardsJsonl('');
    expect(cards.length).toBe(0);
  });
});
