/**
 * Slice 10/12 — Cost-reduction long-tail: new recognizer and executor forms
 *
 * Tests Forms 47-50 added to isSelfCostReductionSentence and
 * getIntrinsicCostReduction:
 *
 *  47. Historic total MV: "costs {X} less, where X is the total mana value of
 *      historic permanents you control" (Excalibur, Sword of Eden).
 *      Historic = legendary | artifact | Saga (CR 700.4a).
 *
 *  48. Differently named lands: "costs {X} less, where X is the number of
 *      differently named lands you control" (Fungal Colossus).
 *
 *  49. Controls counter creature: "costs {N} less if you control a creature
 *      with a +1/+1 counter on it" (Prehistoric Turtlesaurus).
 *
 *  50. Target flying: "costs {N} less if it targets a creature with flying"
 *      (Swampsnare Trap).
 *
 * Deferred (no state helper):
 *   "for each creature that attacked this turn" — state.combat is null in
 *   postcombat_main; no per-creature attack history in GameState. Skipped.
 *
 * Each form is tested at three levels:
 *   1. RECOGNITION — isSelfCostReductionSentence returns 'dynamic'
 *   2. PARSE       — parseOracleText returns StaticAbility (not Unparsed)
 *   3. RUNTIME     — getIntrinsicCostReduction returns the correct value
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { isSelfCostReductionSentence } from '../effects/matchers/static-abilities';
import { getIntrinsicCostReduction } from '../effects/continuous';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

// ============================================================================
// Test helpers
// ============================================================================

function makePlayer(id: string, life = 40): Player {
  return {
    id, name: id, life,
    poisonCounters: 0,
    commanderDamage: {}, commanderTax: 0,
    commanderInstanceId: null, commanderCastCount: 0,
    commanderInstanceIds: [],
    commanderCastCounts: {},
    manaPool: emptyManaPool(),
    snowManaPool: emptyManaPool(),
    restrictedMana: [],
    conditionalMana: [],
    hasPlayedLand: false,
    landsPlayedThisTurn: 0,
    hasPriority: false, hasLost: false,
  };
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: CardInstance['zone'] = 'battlefield',
  counters: Record<string, number> = {},
): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone,
    tapped: false, summoningSick: false, counters, damage: 0, isCommander: false,
  };
}

function makeDef(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name || id,
    type_line: opts.type_line || 'Creature',
    oracle_text: opts.oracle_text || '',
    mana_cost: opts.mana_cost || '',
    cmc: opts.cmc ?? 0,
    colors: opts.colors || [],
    color_identity: opts.color_identity || [],
    keywords: opts.keywords || [],
    card_types: opts.card_types || ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: overrides.players || [makePlayer('p1'), makePlayer('p2')],
    cards: overrides.cards || new Map(),
    cardDefinitions: overrides.cardDefinitions || new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as any,
    step: 'main' as any,
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    continuousEffects: overrides.continuousEffects || [],
    ...overrides,
  };
}

// ============================================================================
// Form 47 — "where X is the total mana value of historic permanents you control"
// ============================================================================

describe('Form 47 — "where X is the total mana value of historic permanents you control"', () => {
  const oracle = 'This spell costs {X} less to cast, where X is the total mana value of historic permanents you control.';
  const sentence = 'This spell costs {X} less to cast, where X is the total mana value of historic permanents you control';

  describe('parser recognition', () => {
    it('isSelfCostReductionSentence returns dynamic', () => {
      expect(isSelfCostReductionSentence(sentence)).toBe('dynamic');
    });

    it('parseOracleText returns StaticAbility (not Unparsed)', () => {
      const r = parseOracleText(oracle);
      expect(r.kind).toBe('StaticAbility');
      if (r.kind !== 'StaticAbility') return;
      expect(r.ability.modifier.kind).toBe('ReduceCost');
      expect(r.ability.selfOnly).toBe(true);
    });
  });

  describe('getIntrinsicCostReduction runtime', () => {
    it('sums MV of legendary permanent + artifact (total historic)', () => {
      // Legendary creature CMC=4, artifact CMC=2 → total 6
      const cards = new Map<string, CardInstance>();
      const defs = new Map<string, CardDefinition>();

      const legendaryDef = makeDef('legendary_creature', {
        name: 'Legendary Lord',
        type_line: 'Legendary Creature — Human',
        card_types: ['creature'],
        cmc: 4,
      });
      const artifactDef = makeDef('artifact_card', {
        name: 'Sol Ring',
        type_line: 'Artifact',
        card_types: ['artifact'],
        cmc: 2,
      });
      const spellDef = makeDef('excalibur', {
        oracle_text: oracle,
        card_types: ['artifact'],
        mana_cost: '{X}{W}{W}',
        cmc: 3,
        name: 'Excalibur, Sword of Eden',
      });

      cards.set('leg_0', makeCard('leg_0', 'legendary_creature', 'p1'));
      cards.set('art_0', makeCard('art_0', 'artifact_card', 'p1'));
      defs.set('legendary_creature', legendaryDef);
      defs.set('artifact_card', artifactDef);

      const state = makeState({ cards, cardDefinitions: defs });
      const result = getIntrinsicCostReduction(state, 'p1', spellDef);
      expect(result).toBe(6);
    });

    it('includes Saga as historic', () => {
      const cards = new Map<string, CardInstance>();
      const defs = new Map<string, CardDefinition>();

      const sagaDef = makeDef('saga_card', {
        name: 'The Eldest Reborn',
        type_line: 'Enchantment — Saga',
        card_types: ['enchantment'],
        cmc: 5,
      });
      const spellDef = makeDef('excalibur', {
        oracle_text: oracle,
        card_types: ['artifact'],
        mana_cost: '{X}{W}{W}',
        cmc: 3,
      });

      cards.set('saga_0', makeCard('saga_0', 'saga_card', 'p1'));
      defs.set('saga_card', sagaDef);

      const state = makeState({ cards, cardDefinitions: defs });
      const result = getIntrinsicCostReduction(state, 'p1', spellDef);
      expect(result).toBe(5);
    });

    it('ignores non-historic permanents and opponent permanents', () => {
      const cards = new Map<string, CardInstance>();
      const defs = new Map<string, CardDefinition>();

      // Plain creature (not historic) owned by caster — should NOT count
      const creatureDef = makeDef('plain_creature', {
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        card_types: ['creature'],
        cmc: 2,
      });
      // Legendary artifact owned by opponent — should NOT count
      const oppLegArtDef = makeDef('opp_legendary_art', {
        name: 'Black Lotus',
        type_line: 'Legendary Artifact',
        card_types: ['artifact'],
        cmc: 0,
      });
      const spellDef = makeDef('excalibur', {
        oracle_text: oracle,
        card_types: ['artifact'],
        mana_cost: '{X}{W}{W}',
        cmc: 3,
      });

      cards.set('bear_0', makeCard('bear_0', 'plain_creature', 'p1'));
      cards.set('opp_art_0', makeCard('opp_art_0', 'opp_legendary_art', 'p2'));
      defs.set('plain_creature', creatureDef);
      defs.set('opp_legendary_art', oppLegArtDef);

      const state = makeState({ cards, cardDefinitions: defs });
      const result = getIntrinsicCostReduction(state, 'p1', spellDef);
      expect(result).toBe(0);
    });
  });
});

// ============================================================================
// Form 48 — "where X is the number of differently named lands you control"
// ============================================================================

describe('Form 48 — "where X is the number of differently named lands you control"', () => {
  const oracle = 'This spell costs {X} less to cast, where X is the number of differently named lands you control.';
  const sentence = 'This spell costs {X} less to cast, where X is the number of differently named lands you control';

  describe('parser recognition', () => {
    it('isSelfCostReductionSentence returns dynamic', () => {
      expect(isSelfCostReductionSentence(sentence)).toBe('dynamic');
    });

    it('parseOracleText returns StaticAbility (not Unparsed)', () => {
      const r = parseOracleText(oracle);
      expect(r.kind).toBe('StaticAbility');
      if (r.kind !== 'StaticAbility') return;
      expect(r.ability.modifier.kind).toBe('ReduceCost');
    });
  });

  describe('getIntrinsicCostReduction runtime', () => {
    it('counts distinct land names (2 Forests = 1 differently named land)', () => {
      const cards = new Map<string, CardInstance>();
      const defs = new Map<string, CardDefinition>();

      const forestDef = makeDef('forest', {
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        card_types: ['land'],
        cmc: 0,
      });
      const islandDef = makeDef('island', {
        name: 'Island',
        type_line: 'Basic Land — Island',
        card_types: ['land'],
        cmc: 0,
      });
      const spellDef = makeDef('fungal_colossus', {
        oracle_text: oracle,
        card_types: ['creature'],
        mana_cost: '{X}{G}{G}',
        cmc: 8,
        name: 'Fungal Colossus',
      });

      // Two Forests + one Island = 2 distinct names
      cards.set('forest_0', makeCard('forest_0', 'forest', 'p1'));
      cards.set('forest_1', makeCard('forest_1', 'forest', 'p1'));
      cards.set('island_0', makeCard('island_0', 'island', 'p1'));
      defs.set('forest', forestDef);
      defs.set('island', islandDef);

      const state = makeState({ cards, cardDefinitions: defs });
      const result = getIntrinsicCostReduction(state, 'p1', spellDef);
      expect(result).toBe(2);
    });

    it('ignores non-land permanents and opponent lands', () => {
      const cards = new Map<string, CardInstance>();
      const defs = new Map<string, CardDefinition>();

      const swampDef = makeDef('swamp', {
        name: 'Swamp',
        type_line: 'Basic Land — Swamp',
        card_types: ['land'],
        cmc: 0,
      });
      const creatureDef = makeDef('bear', {
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        card_types: ['creature'],
        cmc: 2,
      });
      const spellDef = makeDef('fungal_colossus', {
        oracle_text: oracle,
        card_types: ['creature'],
        mana_cost: '{X}{G}{G}',
        cmc: 8,
      });

      // Caster has 1 Swamp, opponent has 1 Swamp + 1 Mountain
      cards.set('swamp_0', makeCard('swamp_0', 'swamp', 'p1'));
      cards.set('bear_0', makeCard('bear_0', 'bear', 'p1'));
      cards.set('opp_swamp', makeCard('opp_swamp', 'swamp', 'p2'));
      defs.set('swamp', swampDef);
      defs.set('bear', creatureDef);

      const state = makeState({ cards, cardDefinitions: defs });
      const result = getIntrinsicCostReduction(state, 'p1', spellDef);
      // Only caster's Swamp counts (1 distinct name)
      expect(result).toBe(1);
    });

    it('returns 0 when no lands controlled', () => {
      const spellDef = makeDef('fungal_colossus', {
        oracle_text: oracle,
        card_types: ['creature'],
        mana_cost: '{X}{G}{G}',
        cmc: 8,
      });
      const state = makeState();
      const result = getIntrinsicCostReduction(state, 'p1', spellDef);
      expect(result).toBe(0);
    });
  });
});

// ============================================================================
// Form 49 — "if you control a creature with a +1/+1 counter on it"
// ============================================================================

describe('Form 49 — "if you control a creature with a +1/+1 counter on it"', () => {
  const oracle = 'This spell costs {2} less to cast if you control a creature with a +1/+1 counter on it.';
  const sentence = 'This spell costs {2} less to cast if you control a creature with a +1/+1 counter on it';

  describe('parser recognition', () => {
    it('isSelfCostReductionSentence returns dynamic', () => {
      expect(isSelfCostReductionSentence(sentence)).toBe('dynamic');
    });

    it('parseOracleText returns StaticAbility (not Unparsed)', () => {
      const r = parseOracleText(oracle);
      expect(r.kind).toBe('StaticAbility');
      if (r.kind !== 'StaticAbility') return;
      expect(r.ability.modifier.kind).toBe('ReduceCost');
    });
  });

  describe('getIntrinsicCostReduction runtime', () => {
    it('returns 2 when caster controls a creature with +1/+1 counter', () => {
      const cards = new Map<string, CardInstance>();
      const defs = new Map<string, CardDefinition>();

      const creatureDef = makeDef('countered_creature', {
        name: 'Veteran Adventurer',
        type_line: 'Creature — Human',
        card_types: ['creature'],
        cmc: 2,
      });
      const spellDef = makeDef('turtlesaurus', {
        oracle_text: oracle,
        card_types: ['creature'],
        mana_cost: '{3}{G}{G}',
        cmc: 5,
        name: 'Prehistoric Turtlesaurus',
      });

      // Creature with one +1/+1 counter
      cards.set('creature_0', makeCard('creature_0', 'countered_creature', 'p1', 'battlefield', { '+1/+1': 1 }));
      defs.set('countered_creature', creatureDef);

      const state = makeState({ cards, cardDefinitions: defs });
      const result = getIntrinsicCostReduction(state, 'p1', spellDef);
      expect(result).toBe(2);
    });

    it('returns 0 when no creature has a +1/+1 counter', () => {
      const cards = new Map<string, CardInstance>();
      const defs = new Map<string, CardDefinition>();

      const creatureDef = makeDef('plain_creature', {
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        card_types: ['creature'],
        cmc: 2,
      });
      const spellDef = makeDef('turtlesaurus', {
        oracle_text: oracle,
        card_types: ['creature'],
        mana_cost: '{3}{G}{G}',
        cmc: 5,
      });

      // Creature with no counters
      cards.set('bear_0', makeCard('bear_0', 'plain_creature', 'p1'));
      defs.set('plain_creature', creatureDef);

      const state = makeState({ cards, cardDefinitions: defs });
      const result = getIntrinsicCostReduction(state, 'p1', spellDef);
      expect(result).toBe(0);
    });

    it('returns 0 when only opponent controls a countered creature', () => {
      const cards = new Map<string, CardInstance>();
      const defs = new Map<string, CardDefinition>();

      const creatureDef = makeDef('opp_creature', {
        name: 'Resilient Warrior',
        type_line: 'Creature — Human Warrior',
        card_types: ['creature'],
        cmc: 3,
      });
      const spellDef = makeDef('turtlesaurus', {
        oracle_text: oracle,
        card_types: ['creature'],
        mana_cost: '{3}{G}{G}',
        cmc: 5,
      });

      // Opponent's creature has the counter, caster's does not
      cards.set('opp_c', makeCard('opp_c', 'opp_creature', 'p2', 'battlefield', { '+1/+1': 2 }));
      defs.set('opp_creature', creatureDef);

      const state = makeState({ cards, cardDefinitions: defs });
      const result = getIntrinsicCostReduction(state, 'p1', spellDef);
      expect(result).toBe(0);
    });
  });
});

// ============================================================================
// Form 50 — "if it targets a creature with flying"
// ============================================================================

describe('Form 50 — "if it targets a creature with flying"', () => {
  const oracle = 'This spell costs {3} less to cast if it targets a creature with flying.';
  const sentence = 'This spell costs {3} less to cast if it targets a creature with flying';

  describe('parser recognition', () => {
    it('isSelfCostReductionSentence returns dynamic', () => {
      expect(isSelfCostReductionSentence(sentence)).toBe('dynamic');
    });

    it('parseOracleText returns StaticAbility (not Unparsed)', () => {
      const r = parseOracleText(oracle);
      expect(r.kind).toBe('StaticAbility');
      if (r.kind !== 'StaticAbility') return;
      expect(r.ability.modifier.kind).toBe('ReduceCost');
    });
  });

  describe('getIntrinsicCostReduction runtime', () => {
    it('returns 3 when target has Flying in printed keywords', () => {
      const cards = new Map<string, CardInstance>();
      const defs = new Map<string, CardDefinition>();

      const flyerDef = makeDef('azure_flyer', {
        name: 'Azure Flyer',
        type_line: 'Creature — Bird',
        card_types: ['creature'],
        keywords: ['Flying'],
        cmc: 2,
      });
      const spellDef = makeDef('swampsnare_trap', {
        oracle_text: oracle,
        card_types: ['instant'],
        mana_cost: '{4}{U}',
        cmc: 5,
        name: 'Swampsnare Trap',
      });

      cards.set('flyer_0', makeCard('flyer_0', 'azure_flyer', 'p2'));
      defs.set('azure_flyer', flyerDef);

      const state = makeState({ cards, cardDefinitions: defs });
      const result = getIntrinsicCostReduction(state, 'p1', spellDef, ['flyer_0']);
      expect(result).toBe(3);
    });

    it('returns 0 when target has no Flying keyword', () => {
      const cards = new Map<string, CardInstance>();
      const defs = new Map<string, CardDefinition>();

      const groundDef = makeDef('ground_walker', {
        name: 'Ground Walker',
        type_line: 'Creature — Beast',
        card_types: ['creature'],
        keywords: ['Trample'],
        cmc: 3,
      });
      const spellDef = makeDef('swampsnare_trap', {
        oracle_text: oracle,
        card_types: ['instant'],
        mana_cost: '{4}{U}',
        cmc: 5,
      });

      cards.set('ground_0', makeCard('ground_0', 'ground_walker', 'p2'));
      defs.set('ground_walker', groundDef);

      const state = makeState({ cards, cardDefinitions: defs });
      const result = getIntrinsicCostReduction(state, 'p1', spellDef, ['ground_0']);
      expect(result).toBe(0);
    });

    it('returns 0 when no targets provided (Form 50 requires targets)', () => {
      const cards = new Map<string, CardInstance>();
      const defs = new Map<string, CardDefinition>();

      const flyerDef = makeDef('azure_flyer', {
        name: 'Azure Flyer',
        type_line: 'Creature — Bird',
        card_types: ['creature'],
        keywords: ['Flying'],
        cmc: 2,
      });
      const spellDef = makeDef('swampsnare_trap', {
        oracle_text: oracle,
        card_types: ['instant'],
        mana_cost: '{4}{U}',
        cmc: 5,
      });

      cards.set('flyer_0', makeCard('flyer_0', 'azure_flyer', 'p2'));
      defs.set('azure_flyer', flyerDef);

      const state = makeState({ cards, cardDefinitions: defs });
      // Passing empty targets — condition cannot be met
      const result = getIntrinsicCostReduction(state, 'p1', spellDef, []);
      expect(result).toBe(0);
    });

    it('returns 3 when one of multiple targets has Flying', () => {
      const cards = new Map<string, CardInstance>();
      const defs = new Map<string, CardDefinition>();

      const flyerDef = makeDef('azure_flyer', {
        name: 'Azure Flyer',
        type_line: 'Creature — Bird',
        card_types: ['creature'],
        keywords: ['Flying'],
        cmc: 2,
      });
      const groundDef = makeDef('ground_walker', {
        name: 'Ground Walker',
        type_line: 'Creature — Beast',
        card_types: ['creature'],
        keywords: [],
        cmc: 3,
      });
      const spellDef = makeDef('swampsnare_trap', {
        oracle_text: oracle,
        card_types: ['instant'],
        mana_cost: '{4}{U}',
        cmc: 5,
      });

      cards.set('flyer_0', makeCard('flyer_0', 'azure_flyer', 'p2'));
      cards.set('ground_0', makeCard('ground_0', 'ground_walker', 'p1'));
      defs.set('azure_flyer', flyerDef);
      defs.set('ground_walker', groundDef);

      const state = makeState({ cards, cardDefinitions: defs });
      const result = getIntrinsicCostReduction(state, 'p1', spellDef, ['ground_0', 'flyer_0']);
      expect(result).toBe(3);
    });
  });
});

// ============================================================================
// Honesty gate: "for each creature that attacked this turn" stays deferred
// ============================================================================

describe('Honesty gate — deferred form "for each creature that attacked this turn"', () => {
  it('remains null (not dynamic/unsupported) since no per-creature attack tracker exists', () => {
    // The Mary Janes: "This spell costs {1} less to cast for each creature that attacked this turn."
    // state.combat is null in postcombat_main — no state helper for individual creature attack history.
    // isSelfCostReductionSentence should return null for this form (not absorbed, honest).
    const sentence = 'This spell costs {1} less to cast for each creature that attacked this turn';
    const result = isSelfCostReductionSentence(sentence);
    // Must NOT be 'dynamic' — we can't compute this honestly
    expect(result).not.toBe('dynamic');
    // May be null (not a recognized form) or 'unsupported' — either is honest
    expect(result === null || result === 'unsupported').toBe(true);
  });
});
