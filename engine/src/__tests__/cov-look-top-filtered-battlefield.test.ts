/**
 * Slice 8/12: Look-at-top "up to M filtered" family leftovers.
 *
 * Covers:
 *   1. Storm the Festival shape: "You may put up to M permanent cards with mana
 *      value K or less from among them onto the battlefield" (new "you may" prefix
 *      on matchRevealTopOntoBattlefield).
 *   2. Mayael the Anima shape: "You may put a creature card with power N or greater
 *      from among them onto the battlefield" (matchLookAtTopPowerFilterOntoBattlefield).
 *   3. Kamahl's Druidic Vow shape: "put any number of land cards and/or legendary
 *      permanent cards from among them onto the battlefield" with a dynamic-X count
 *      (matchLookAtTopAnyNumberMultiTypeOntoBattlefield).
 *   4. Information Dealer shape: dynamic-X Wizard reorder (matchLookAtTopDynamicCountReorderBack)
 *      — already parsed, regression check.
 *   5. Honesty: Skyclave Plunder "where X is your party count" stays Unparsed.
 */
import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ---------------------------------------------------------------------------
// Card definitions used across tests
// ---------------------------------------------------------------------------
const forest: CardDefinition = {
  id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
  keywords: [], card_types: ['land'],
};
const bear: CardDefinition = {
  id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear',
  oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 2, toughness: 2,
};
const bolt: CardDefinition = {
  id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant',
  oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'],
  keywords: [], card_types: ['instant'],
};
const titan: CardDefinition = {
  id: 'titan', name: 'Primeval Titan', type_line: 'Legendary Creature — Giant',
  oracle_text: '', mana_cost: '{4}{G}{G}', cmc: 6, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 6, toughness: 6,
};
const angel: CardDefinition = {
  id: 'angel', name: 'Serra Angel', type_line: 'Creature — Angel',
  oracle_text: '', mana_cost: '{3}{W}{W}', cmc: 5, colors: ['W'], color_identity: ['W'],
  keywords: ['Flying', 'Vigilance'], card_types: ['creature'], power: 4, toughness: 4,
};
const vault: CardDefinition = {
  id: 'vault', name: "Thran Temporal Gateway", type_line: 'Legendary Artifact',
  oracle_text: '', mana_cost: '{4}', cmc: 4, colors: [], color_identity: [],
  keywords: [], card_types: ['artifact'],
};
const perm: CardDefinition = {
  // generic permanent (enchantment) with cmc 3
  id: 'perm', name: 'Pacifism', type_line: 'Enchantment — Aura',
  oracle_text: '', mana_cost: '{1}{W}', cmc: 2, colors: ['W'], color_identity: ['W'],
  keywords: [], card_types: ['enchantment'],
};
const heavyPerm: CardDefinition = {
  // high-cmc permanent, should be filtered by MV <= 5 cut
  id: 'heavyPerm', name: 'Blightsteel Colossus', type_line: 'Artifact Creature — Golem',
  oracle_text: '', mana_cost: '{12}', cmc: 12, colors: [], color_identity: [],
  keywords: [], card_types: ['artifact', 'creature'], power: 11, toughness: 11,
};

function mk(id: string, defId: string, owner = 'p0'): CardInstance {
  return {
    instanceId: id, definitionId: defId, ownerId: owner, zone: 'library',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function makeState(libraryIds: [string, string][], extraDefs: CardDefinition[] = []): GameState {
  const cards = new Map<string, CardInstance>(libraryIds.map(([id, defId]) => [id, mk(id, defId)]));
  const defs = new Map<string, CardDefinition>([
    ['forest', forest], ['bear', bear], ['bolt', bolt], ['titan', titan],
    ['angel', angel], ['vault', vault], ['perm', perm], ['heavyPerm', heavyPerm],
    ...extraDefs.map(d => [d.id, d] as [string, CardDefinition]),
  ]);
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards, cardDefinitions: defs,
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function onBf(s: GameState): string[] {
  return [...s.cards.values()].filter(c => c.zone === 'battlefield').map(c => c.instanceId).sort();
}
function inLib(s: GameState): string[] {
  return [...s.cards.values()].filter(c => c.zone === 'library').map(c => c.instanceId);
}
function inHand(s: GameState): string[] {
  return [...s.cards.values()].filter(c => c.zone === 'hand').map(c => c.instanceId);
}

// ===========================================================================
// 1. Storm the Festival shape: "You may put up to M permanent cards with mv
//    K or less from among them onto the battlefield" (you-may prefix)
// ===========================================================================
const STORM_TEXT =
  'Look at the top five cards of your library. You may put up to two permanent cards with mana value 5 or less from among them onto the battlefield. Put the rest on the bottom of your library in a random order.';

describe('Slice 8: Storm the Festival — you may put up to M permanent (mv≤K) onto battlefield', () => {
  it('parses to ChooseFromTopOfLibrary with permanent filter, destination=battlefield', () => {
    const r = parseOracleText(STORM_TEXT, 'StormFestival');
    if (r.kind !== 'Spell') throw new Error('expected Spell, got ' + r.kind);
    const e = r.effects[0] as any;
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    expect(e.count).toBe(5);
    expect(e.destination).toBe('battlefield');
    expect(e.restDestination).toBe('bottom');
    expect(e.minSelections).toBe(0);
    expect(e.maxSelections).toBe(2);
    expect(e.filter.permanent).toBe(true);
    expect(e.filter.cmc).toEqual({ op: 'lte', value: 5 });
  });

  it('puts up to 2 matching permanents onto the battlefield, bottoms the rest', () => {
    const r = parseOracleText(STORM_TEXT, 'StormFestival');
    if (r.kind !== 'Spell') throw new Error('expected Spell');
    // Library top-5: forest(land=permanent,cmc0), bear(creature=permanent,cmc2),
    //   bolt(instant=NOT permanent), perm(enchantment=permanent,cmc2), heavyPerm(cmc12—filtered),
    //   and one more deeper card: 'deep'
    const s0 = makeState([
      ['f1', 'forest'],      // permanent, cmc 0 — eligible
      ['b1', 'bear'],        // permanent, cmc 2 — eligible
      ['bolt1', 'bolt'],     // NOT a permanent
      ['p1', 'perm'],        // permanent, cmc 2 — eligible (but cap is 2)
      ['hp1', 'heavyPerm'],  // permanent, cmc 12 — filtered out by mv<=5
      ['deep', 'forest'],    // below the top 5
    ]);
    const s = executeEffects(s0, r.effects, 'p0', [], []);

    const bf = onBf(s);
    // Only 2 eligible permanents should hit the battlefield (cap = maxSelections=2)
    expect(bf.length).toBe(2);
    // Both must be permanents (auto-selection takes first eligible)
    for (const id of bf) {
      const def = s.cardDefinitions.get(s.cards.get(id)!.definitionId)!;
      expect(def.card_types.some(t => ['land', 'creature', 'artifact', 'enchantment', 'planeswalker'].includes(t))).toBe(true);
      expect(def.cmc).toBeLessThanOrEqual(5);
    }
    // 'deep' card must remain in library (not part of revealed top 5)
    expect(s.cards.get('deep')!.zone).toBe('library');
    // Total library = original 6 minus 2 that hit the battlefield = 4
    expect(inLib(s).length).toBe(4);
  });

  it('bottoms everything when no revealed card is a permanent with mv≤5', () => {
    const r = parseOracleText(STORM_TEXT, 'StormFestival');
    if (r.kind !== 'Spell') throw new Error('expected Spell');
    // All top 5 are non-permanents or high-mv
    const s0 = makeState([
      ['b1', 'bolt'], ['b2', 'bolt'], ['b3', 'bolt'], ['b4', 'bolt'], ['b5', 'bolt'],
      ['deep', 'forest'],
    ]);
    const s = executeEffects(s0, r.effects, 'p0', [], []);
    expect(onBf(s).length).toBe(0);
    // All 6 remain in library (5 revealed + 1 deep)
    expect(inLib(s).length).toBe(6);
  });
});

// ===========================================================================
// 2. Mayael the Anima shape: "put a creature card with power 5 or greater"
// ===========================================================================
const MAYAEL_BODY =
  'Look at the top five cards of your library. You may put a creature card with power 5 or greater from among them onto the battlefield. Put the rest on the bottom of your library in a random order.';
const MAYAEL_ORACLE =
  '{G}{W}{R}, {T}: ' + MAYAEL_BODY;

describe('Slice 8: Mayael the Anima — creature with power≥5 onto battlefield (activated)', () => {
  it('body text parses to ChooseFromTopOfLibrary with power>=5 creature filter', () => {
    const r = parseOracleText(MAYAEL_BODY, 'MayaelBody');
    if (r.kind !== 'Spell') throw new Error('expected Spell, got ' + r.kind);
    const e = r.effects[0] as any;
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    expect(e.count).toBe(5);
    expect(e.destination).toBe('battlefield');
    expect(e.restDestination).toBe('bottom');
    expect(e.maxSelections).toBe(1);
    expect(e.filter.types).toContain('creature');
    expect(e.filter.power).toEqual({ op: 'gte', value: 5 });
  });

  it('full oracle (activated ability) parses to Activated with ChooseFromTopOfLibrary effect', () => {
    const r = parseOracleText(MAYAEL_ORACLE, 'Mayael');
    if (r.kind !== 'Activated') throw new Error('expected Activated, got ' + r.kind);
    expect(r.abilities.length).toBeGreaterThanOrEqual(1);
    const e = r.abilities[0].effects?.find((ef: any) => ef.kind === 'ChooseFromTopOfLibrary') as any;
    expect(e).toBeDefined();
    expect(e.filter.types).toContain('creature');
    expect(e.filter.power).toEqual({ op: 'gte', value: 5 });
    expect(e.destination).toBe('battlefield');
  });

  it('puts the first qualifying creature (power>=5) onto the battlefield, bottoms the rest', () => {
    const r = parseOracleText(MAYAEL_BODY, 'MayaelBody');
    if (r.kind !== 'Spell') throw new Error('expected Spell');
    // Top 5: bear(power 2), angel(power 4), titan(power 6 >= 5 ✓), bear, bolt
    const s0 = makeState([
      ['b1', 'bear'],    // power 2 — not eligible
      ['a1', 'angel'],   // power 4 — not eligible
      ['t1', 'titan'],   // power 6 — eligible!
      ['b2', 'bear'],    // power 2 — not eligible
      ['bolt1', 'bolt'], // not a creature
      ['deep', 'forest'],
    ]);
    const s = executeEffects(s0, r.effects, 'p0', [], []);

    const bf = onBf(s);
    // Only the titan should hit the battlefield
    expect(bf).toEqual(['t1']);
    expect(s.cards.get('t1')!.zone).toBe('battlefield');
    expect(s.cards.get('t1')!.summoningSick).toBe(true);
    // 'deep' stays in library (never revealed)
    expect(s.cards.get('deep')!.zone).toBe('library');
    // Library = 4 (deep + 4 bottomed revealed cards)
    expect(inLib(s).length).toBe(5);
  });

  it('puts nothing on the battlefield when no revealed creature has power>=5', () => {
    const r = parseOracleText(MAYAEL_BODY, 'MayaelBody');
    if (r.kind !== 'Spell') throw new Error('expected Spell');
    const s0 = makeState([
      ['b1', 'bear'], ['b2', 'bear'], ['a1', 'angel'], ['b3', 'bear'], ['f1', 'forest'],
    ]);
    const s = executeEffects(s0, r.effects, 'p0', [], []);
    expect(onBf(s).length).toBe(0);
    expect(inLib(s).length).toBe(5);
  });
});

// ===========================================================================
// 3. Kamahl's Druidic Vow: "any number of land cards and/or legendary
//    permanent cards from among them onto the battlefield", where X is count
// ===========================================================================
const KAMAHL_TEXT =
  "Look at the top X cards of your library, where X is the number of legendary permanents you control. You may put any number of land cards and/or legendary permanent cards from among them onto the battlefield. Put the rest on the bottom of your library in a random order.";

describe("Slice 8: Kamahl's Druidic Vow — any number of land or legendary permanent onto battlefield", () => {
  it('parses to ChooseFromTopOfLibrary with anyOf filter, destination=battlefield', () => {
    const r = parseOracleText(KAMAHL_TEXT, 'KamahlDruidicVow');
    if (r.kind !== 'Spell') throw new Error('expected Spell, got ' + r.kind);
    const e = r.effects[0] as any;
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    expect(e.destination).toBe('battlefield');
    expect(e.restDestination).toBe('bottom');
    expect(e.minSelections).toBe(0);
    // dynamic ForEach count from "where X is the number of legendary permanents you control"
    expect(typeof e.count).toBe('object');
    expect(e.count.kind).toBe('ForEach');
    // multi-type filter (anyOf)
    expect(e.filter.anyOf).toBeDefined();
    expect(e.filter.anyOf.length).toBe(2);
    // first branch: land
    const landBranch = e.filter.anyOf.find((b: any) => b.types?.includes('land'));
    expect(landBranch).toBeDefined();
    // second branch: legendary permanent
    const legendaryBranch = e.filter.anyOf.find((b: any) => b.supertypes?.some((s: string) => s.toLowerCase() === 'legendary'));
    expect(legendaryBranch).toBeDefined();
    expect(legendaryBranch.permanent).toBe(true);
  });

  it('auto-selects all lands and legendary permanents, bottoms the rest', () => {
    const r = parseOracleText(KAMAHL_TEXT, 'KamahlDruidicVow');
    if (r.kind !== 'Spell') throw new Error('expected Spell');

    // We have a legendary creature on the battlefield (titan) owned by p0,
    // so the "where X is the number of legendary permanents you control" count = 1.
    // That means top 1 card is revealed.
    // Top 1: forest (land — eligible)
    // Put 2 cards on battlefield already (titan) to get X=1.
    const bfTitan: CardInstance = {
      instanceId: 'bf_titan', definitionId: 'titan', ownerId: 'p0', zone: 'battlefield',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    };
    const s0Base = makeState([
      ['f1', 'forest'],   // land — eligible
      ['bolt1', 'bolt'],  // instant — not eligible
      ['deep', 'bear'],
    ]);
    // Add the bf titan so X resolves to 1
    const cards2 = new Map(s0Base.cards);
    cards2.set('bf_titan', bfTitan);
    const s0: GameState = { ...s0Base, cards: cards2 };

    const s = executeEffects(s0, r.effects, 'p0', [], []);

    // The forest (land) should be on the battlefield
    expect(s.cards.get('f1')!.zone).toBe('battlefield');
    // bolt should be in library still (either bottomed or not revealed if X=1)
    // titan should remain on battlefield
    expect(s.cards.get('bf_titan')!.zone).toBe('battlefield');
  });
});

// ===========================================================================
// 4. Information Dealer (regression): dynamic X Wizards, reorder
// ===========================================================================
describe('Slice 8: Information Dealer — dynamic X Wizard reorder (regression)', () => {
  it('parses to Activated with ChooseFromTopOfLibrary reorder effect', () => {
    const r = parseOracleText('{T}: Look at the top X cards of your library, where X is the number of Wizards you control. Put them back in any order.', 'InformationDealer');
    if (r.kind !== 'Activated') throw new Error('expected Activated, got ' + r.kind);
    const e = r.abilities[0].effects?.find((ef: any) => ef.kind === 'ChooseFromTopOfLibrary') as any;
    expect(e).toBeDefined();
    expect(e.maxSelections).toBe(0); // reorder — no cards taken
    expect(e.restDestination).toBe('top');
    // dynamic count (ForEach Wizards)
    expect(typeof e.count).toBe('object');
    expect(e.count.kind).toBe('ForEach');
  });
});

// ===========================================================================
// 5. Honesty guard: Skyclave Plunder "party count" stays Unparsed
// ===========================================================================
describe('Slice 8: Skyclave Plunder — party count stays Unparsed (honest)', () => {
  it('does not emit a ChooseFromTopOfLibrary effect (no executor support for party)', () => {
    const r = parseOracleText(
      'Look at the top X cards of your library, where X is your party count. Put three of those cards into your hand and the rest on the bottom of your library in a random order.',
      'SkyclavePlunder',
    );
    const hasEffect = r.kind === 'Spell' && r.effects.some(e => e.kind === 'ChooseFromTopOfLibrary');
    expect(hasEffect).toBe(false);
  });
});
