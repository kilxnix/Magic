import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ---------------------------------------------------------------------------
// Family: extended tutor filters
// Search-library noun phrases beyond basic lands: subtype + permanent combos
// ("a Rebel permanent card with mana value 5 or less"), color + cmc-X bounds
// ("a green creature card with mana value X or less"), legendary/supertype
// filters ("a legendary Spirit permanent card"), and/or type lists ("up to two
// artifact, creature, and/or land cards"), plus the standalone tail sentence
// "If you search your library this way, shuffle." All route to the existing
// SearchLibrary / ShuffleLibrary executors — parse AND execution are asserted.
// ---------------------------------------------------------------------------

function def(partial: Partial<CardDefinition> & { id: string; name: string; type_line: string }): CardDefinition {
  return {
    oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: [], keywords: [], card_types: [],
    ...partial,
  } as CardDefinition;
}

const cheapRebel = def({ id: 'cheapRebel', name: 'Ramosian Sergeant', type_line: 'Creature — Human Rebel', cmc: 1, card_types: ['creature'], colors: ['W'], power: 1, toughness: 1 });
const bigRebel = def({ id: 'bigRebel', name: 'Ramosian Sky Marshal', type_line: 'Creature — Rebel', cmc: 7, card_types: ['creature'], colors: ['W'], power: 3, toughness: 3 });
const greenBear = def({ id: 'greenBear', name: 'Grizzly Bears', type_line: 'Creature — Bear', cmc: 2, card_types: ['creature'], colors: ['G'], power: 2, toughness: 2 });
const greenElder = def({ id: 'greenElder', name: 'Kozilek Elder', type_line: 'Creature — Elder', cmc: 5, card_types: ['creature'], colors: ['G'], power: 5, toughness: 5 });
const redCheap = def({ id: 'redCheap', name: 'Raging Goblin', type_line: 'Creature — Goblin', cmc: 1, card_types: ['creature'], colors: ['R'], power: 1, toughness: 1 });
const greenEnch = def({ id: 'greenEnch', name: 'Utopia Sprawl', type_line: 'Enchantment — Aura', cmc: 1, card_types: ['enchantment'], colors: ['G'] });
const plainSpirit = def({ id: 'plainSpirit', name: 'Drudge Spell Spirit', type_line: 'Creature — Spirit', cmc: 2, card_types: ['creature'], colors: ['B'], power: 1, toughness: 1 });
const legendSpirit = def({ id: 'legendSpirit', name: 'Kodama of the East Tree', type_line: 'Legendary Creature — Spirit', cmc: 6, card_types: ['creature'], colors: ['G'], power: 6, toughness: 6 });
const legendDragon = def({ id: 'legendDragon', name: 'Bladewing the Risen', type_line: 'Legendary Creature — Zombie Dragon', cmc: 6, card_types: ['creature'], colors: ['B', 'R'], power: 4, toughness: 4 });
const cheapArtifact = def({ id: 'cheapArtifact', name: 'Sol Talisman', type_line: 'Artifact', cmc: 1, card_types: ['artifact'] });
const bigArtifact = def({ id: 'bigArtifact', name: 'Coalition Relic', type_line: 'Artifact', cmc: 3, card_types: ['artifact'] });
const basicForest = def({ id: 'basicForest', name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, card_types: ['land'] });
const auraCard = def({ id: 'auraCard', name: 'Pacifism', type_line: 'Enchantment — Aura', cmc: 2, card_types: ['enchantment'], colors: ['W'] });
const equipCard = def({ id: 'equipCard', name: 'Bonesplitter', type_line: 'Artifact — Equipment', cmc: 1, card_types: ['artifact'] });

const ALL_DEFS: CardDefinition[] = [
  cheapRebel, bigRebel, greenBear, greenElder, redCheap, greenEnch,
  plainSpirit, legendSpirit, legendDragon, cheapArtifact, bigArtifact,
  basicForest, auraCard, equipCard,
];

function mk(id: string, defId: string, owner: string, zone: CardInstance['zone']): CardInstance {
  return { instanceId: id, definitionId: defId, ownerId: owner, zone, tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false };
}

/** Game state with the given definition ids in p0's library (one instance each, map order = arg order). */
function libState(defIds: string[]): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map<string, CardInstance>(defIds.map((d, i) => [`c${i}`, mk(`c${i}`, d, 'p0', 'library')])),
    cardDefinitions: new Map<string, CardDefinition>(ALL_DEFS.map(d => [d.id, d])),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 3,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function inZone(s: GameState, zone: string): string[] {
  return [...s.cards.values()].filter(c => c.zone === zone).map(c => c.definitionId).sort();
}

describe('extended tutor filters: subtype + permanent + mana-value bound (Ramosian Commander)', () => {
  const text = '{6}, {T}: Search your library for a Rebel permanent card with mana value 5 or less, put it onto the battlefield, then shuffle.';

  it('parses as an activated ability with the full honest filter', () => {
    const p = parseOracleText(text);
    if (p.kind !== 'Activated') throw new Error('expected Activated, got ' + p.kind);
    const sl = p.abilities[0].effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(sl).toBeDefined();
    expect(sl.filter.subtypes).toEqual(['Rebel']);
    expect(sl.filter.permanent).toBe(true);
    expect(sl.filter.cmc).toMatchObject({ op: 'lte', value: 5 });
    expect(sl.destination).toBe('battlefield');
    expect(sl.shuffle).toBe(true);
  });

  it('executes: fetches only a Rebel with mana value 5 or less', () => {
    const p = parseOracleText(text);
    if (p.kind !== 'Activated') throw new Error('expected Activated');
    // bigRebel (mv 7) listed FIRST so passing requires real cmc filtering.
    const s = executeEffects(libState(['bigRebel', 'redCheap', 'cheapRebel']), p.abilities[0].effects, 'p0', [], []);
    expect(inZone(s, 'battlefield')).toEqual(['cheapRebel']);
    // The mv-7 Rebel and the non-Rebel stayed in the library.
    expect(inZone(s, 'library')).toEqual(['bigRebel', 'redCheap']);
  });
});

describe('extended tutor filters: color + type + "mana value X or less" (Green Sun\'s Zenith)', () => {
  const text = 'Search your library for a green creature card with mana value X or less, put it onto the battlefield, then shuffle. Shuffle ~ into its owner\'s library.';

  it('parses with colors, types, and an X-flagged cmc bound', () => {
    const p = parseOracleText(text, '{X}{G}');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const sl = p.effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(sl.filter.colors).toEqual(['G']);
    expect(sl.filter.types).toEqual(['creature']);
    expect(sl.filter.cmc).toEqual({ op: 'lte', value: 0, x: true });
    expect(sl.destination).toBe('battlefield');
    expect(sl.shuffle).toBe(true);
  });

  it('executes with X=2: only the green creature with mv<=2 is fetched', () => {
    const p = parseOracleText(text, '{X}{G}');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // greenElder (mv 5) and greenEnch (green NON-creature, mv 1) listed first:
    // both must be skipped, proving cmc-X AND type filtering are real.
    const s = executeEffects(libState(['greenElder', 'greenEnch', 'redCheap', 'greenBear']), p.effects, 'p0', [], [], 2);
    expect(inZone(s, 'battlefield')).toEqual(['greenBear']);
  });

  it('executes with X=5: the mv-5 green creature is now a legal fetch', () => {
    const p = parseOracleText(text, '{X}{G}');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s = executeEffects(libState(['greenElder', 'redCheap']), p.effects, 'p0', [], [], 5);
    expect(inZone(s, 'battlefield')).toEqual(['greenElder']);
  });

  it('executes with X=0: nothing with mv>0 is fetched (conservative floor)', () => {
    const p = parseOracleText(text, '{X}{G}');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s = executeEffects(libState(['greenElder', 'greenBear']), p.effects, 'p0', [], [], 0);
    expect(inZone(s, 'battlefield')).toEqual([]);
  });
});

describe('extended tutor filters: legendary supertype + subtype + permanent (Lifespinner)', () => {
  const text = '{T}, Sacrifice three Spirits: Search your library for a legendary Spirit permanent card, put it onto the battlefield, then shuffle.';

  it('parses with supertype AND subtype AND permanent', () => {
    const p = parseOracleText(text);
    if (p.kind !== 'Activated') throw new Error('expected Activated, got ' + p.kind);
    const sl = p.abilities[0].effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(sl.filter.supertypes).toEqual(['Legendary']);
    expect(sl.filter.subtypes).toEqual(['Spirit']);
    expect(sl.filter.permanent).toBe(true);
    expect(sl.destination).toBe('battlefield');
  });

  it('executes: only the LEGENDARY Spirit is fetched', () => {
    const p = parseOracleText(text);
    if (p.kind !== 'Activated') throw new Error('expected Activated');
    // Non-legendary Spirit and legendary non-Spirit listed first — both must be skipped.
    const s = executeEffects(libState(['plainSpirit', 'legendDragon', 'legendSpirit']), p.abilities[0].effects, 'p0', [], []);
    expect(inZone(s, 'battlefield')).toEqual(['legendSpirit']);
    expect(inZone(s, 'library')).toEqual(['legendDragon', 'plainSpirit']);
  });
});

describe('extended tutor filters: "up to two artifact, creature, and/or land cards" (Brightglass Gearhulk)', () => {
  const text = 'When this creature enters, you may search your library for up to two artifact, creature, and/or land cards with mana value 1 or less, reveal them, put them into your hand, then shuffle.';

  it('parses the and/or type list with the mv bound and selection cap', () => {
    const p = parseOracleText(text);
    if (p.kind !== 'ETB') throw new Error('expected ETB, got ' + p.kind);
    const sl = p.ability.effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(sl.filter.types).toEqual(['artifact', 'creature', 'land']);
    expect(sl.filter.cmc).toMatchObject({ op: 'lte', value: 1 });
    expect(sl.maxSelections).toBe(2);
    expect(sl.destination).toBe('hand');
    expect(sl.shuffle).toBe(true);
  });

  it('executes: moves two mv<=1 cards of the listed types to hand', () => {
    const p = parseOracleText(text);
    if (p.kind !== 'ETB') throw new Error('expected ETB');
    const s = executeEffects(libState(['bigArtifact', 'greenBear', 'cheapArtifact', 'basicForest', 'redCheap']), p.ability.effects, 'p0', [], []);
    const hand = inZone(s, 'hand');
    expect(hand.length).toBe(2);
    // Every fetched card is mv<=1 and an artifact/creature/land; the mv-3
    // artifact and the mv-2 creature never qualify.
    for (const id of hand) {
      expect(['cheapArtifact', 'basicForest', 'redCheap']).toContain(id);
    }
    expect(inZone(s, 'library')).toContain('bigArtifact');
    expect(inZone(s, 'library')).toContain('greenBear');
  });
});

describe('extended tutor filters: subtype OR-list ("an Aura or Equipment card")', () => {
  const text = 'Search your library for an Aura or Equipment card, reveal it, put it into your hand, then shuffle.';

  it('parses to an OR of the two subtypes and executes to hand', () => {
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const sl = p.effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(sl.filter.subtypes).toEqual(['Aura', 'Equipment']);
    expect(sl.destination).toBe('hand');

    const s = executeEffects(libState(['greenBear', 'equipCard']), p.effects, 'p0', [], []);
    expect(inZone(s, 'hand')).toEqual(['equipCard']);
  });
});

describe('extended tutor filters: "If you search your library this way, shuffle." tail', () => {
  it('parses standalone to a ShuffleLibrary effect', () => {
    const p = parseOracleText('If you search your library this way, shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    expect(p.effects).toEqual([{ kind: 'ShuffleLibrary', player: { kind: 'Controller' } }]);
  });

  it('is absorbed after a reveal-to-hand tutor and the whole face executes', () => {
    const p = parseOracleText('When this creature enters, you may search your library for a Rebel card, reveal it, and put it into your hand. If you search your library this way, shuffle.');
    if (p.kind !== 'ETB') throw new Error('expected ETB, got ' + p.kind);
    expect(p.ability.effects.some(e => e.kind === 'SearchLibrary')).toBe(true);
    expect(p.ability.effects.some(e => e.kind === 'ShuffleLibrary')).toBe(true);

    const s = executeEffects(libState(['redCheap', 'cheapRebel']), p.ability.effects, 'p0', [], []);
    expect(inZone(s, 'hand')).toEqual(['cheapRebel']);
    expect(inZone(s, 'library')).toEqual(['redCheap']);
  });
});

describe('extended tutor filters: honesty guards', () => {
  it('declines same-category AND ("an artifact creature card") — executor would OR it', () => {
    const p = parseOracleText('Search your library for an artifact creature card, put it onto the battlefield, then shuffle.');
    const sl = p.kind === 'Spell' ? p.effects.find(e => e.kind === 'SearchLibrary') : undefined;
    expect(sl).toBeUndefined();
  });

  it('declines cross-category OR ("an artifact or Aura card") — executor would AND it', () => {
    const p = parseOracleText('Search your library for an artifact or Aura card, put it into your hand, then shuffle.');
    const sl = p.kind === 'Spell' ? p.effects.find(e => e.kind === 'SearchLibrary') : undefined;
    expect(sl).toBeUndefined();
  });
});
