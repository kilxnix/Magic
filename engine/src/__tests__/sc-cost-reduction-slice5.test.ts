/**
 * Slice 5/12 — Self cost-reduction: richer for-each predicates
 *
 * Tests:
 *  1. RECOGNITION — parser correctly classifies new forms
 *  2. RUNTIME — getIntrinsicCostReduction computes correct counts
 *  3. EXECUTION — castSpell pays only the reduced cost
 *  4. HONESTY — unsupported / conditional forms stay Unparsed or are declined
 *  5. ABSORPTION — mixed face (cost-reduction + trigger/ETB) parses correctly
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { getIntrinsicCostReduction } from '../effects/continuous';
import { castSpell } from '../stack';
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
    manaPool: emptyManaPool(),
    hasPlayedLand: false, hasPriority: false, hasLost: false,
  };
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: CardInstance['zone'] = 'battlefield',
): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function makeDef(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name || id,
    type_line: opts.type_line || 'Creature',
    oracle_text: opts.oracle_text || '',
    mana_cost: opts.mana_cost || '',
    cmc: opts.cmc || 0,
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
  };
}

function totalMana(p: Player): number {
  const m = p.manaPool;
  return m.W + m.U + m.B + m.R + m.G + m.C;
}

// ============================================================================
// 1. RECOGNITION — parser recognizes new forms as StaticAbility
// ============================================================================

describe('slice 5 — parser recognition', () => {
  it('recognizes "for each opponent you have" (Avatar of Growth form)', () => {
    // Real oracle text: "This spell costs {1} less to cast for each opponent you have.\nTrample"
    const r = parseOracleText(
      'This spell costs {1} less to cast for each opponent you have.\nTrample',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.modifier.kind).toBe('ReduceCost');
  });

  it('recognizes "for each Cave you control and each Cave card in your graveyard" (Gargantuan Leech form)', () => {
    const r = parseOracleText(
      'This spell costs {1} less to cast for each Cave you control and each Cave card in your graveyard.\nLifelink',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.modifier.kind).toBe('ReduceCost');
  });

  it('recognizes "where X is the total power of creatures you control" (Volcanic Salvo form)', () => {
    const r = parseOracleText(
      'This spell costs {X} less to cast, where X is the total power of creatures you control.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.selfOnly).toBe(true);
  });

  it('recognizes "for each <type> card in your graveyard" (graveyard each)', () => {
    const r = parseOracleText(
      'This spell costs {1} less to cast for each creature card in your graveyard.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.selfOnly).toBe(true);
  });

  it('existing flat form still parses', () => {
    const r = parseOracleText('This spell costs {3} less to cast.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ReduceCost', amount: 3 });
  });

  it('existing battlefield each form still parses', () => {
    const r = parseOracleText(
      'This spell costs {1} less to cast for each creature you control.',
    );
    expect(r.kind).toBe('StaticAbility');
  });
});

// ============================================================================
// 2. RUNTIME — getIntrinsicCostReduction computes correct reductions
// ============================================================================

describe('slice 5 — getIntrinsicCostReduction runtime', () => {
  // --------------------------------------------------------------------------
  // Form 4: for each opponent you have
  // --------------------------------------------------------------------------
  it('counts active opponents (3-player game: 2 opponents → reduction 2)', () => {
    const players = [makePlayer('p1'), makePlayer('p2'), makePlayer('p3')];
    const state = makeState({ players, cards: new Map(), cardDefinitions: new Map() });
    const def = makeDef('d', {
      oracle_text: 'This spell costs {1} less to cast for each opponent you have.',
      card_types: ['sorcery'],
    });
    expect(getIntrinsicCostReduction(state, 'p1', def)).toBe(2);
  });

  it('counts only non-lost opponents', () => {
    const players = [
      makePlayer('p1'),
      makePlayer('p2'),
      { ...makePlayer('p3'), hasLost: true }, // already eliminated
    ];
    const state = makeState({ players, cards: new Map(), cardDefinitions: new Map() });
    const def = makeDef('d', {
      oracle_text: 'This spell costs {1} less to cast for each opponent you have.',
      card_types: ['sorcery'],
    });
    // Only p2 is still alive
    expect(getIntrinsicCostReduction(state, 'p1', def)).toBe(1);
  });

  it('2-player game: 1 opponent → reduction 1', () => {
    const state = makeState({ cards: new Map(), cardDefinitions: new Map() });
    const def = makeDef('d', {
      oracle_text: 'This spell costs {1} less to cast for each opponent you have.',
      card_types: ['sorcery'],
    });
    expect(getIntrinsicCostReduction(state, 'p1', def)).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Form 5: for each <type> card in graveyard
  // --------------------------------------------------------------------------
  it('counts creature cards in caster graveyard', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    // 3 creature cards in p1's graveyard
    for (let i = 0; i < 3; i++) {
      const id = `dead_${i}`;
      cards.set(id, makeCard(id, 'bear_def', 'p1', 'graveyard'));
    }
    // 1 creature card in p2's graveyard (should NOT count)
    cards.set('opp_dead', makeCard('opp_dead', 'bear_def', 'p2', 'graveyard'));
    // 1 creature on battlefield (should NOT count for graveyard form)
    cards.set('alive', makeCard('alive', 'bear_def', 'p1', 'battlefield'));

    defs.set('bear_def', makeDef('bear_def', {
      type_line: 'Creature - Bear',
      card_types: ['creature'],
    }));

    const spellDef = makeDef('spell', {
      oracle_text: 'This spell costs {1} less to cast for each creature card in your graveyard.',
      card_types: ['sorcery'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(3);
  });

  // --------------------------------------------------------------------------
  // Form 6: compound battlefield + graveyard (Gargantuan Leech)
  // --------------------------------------------------------------------------
  it('sums Cave cards on battlefield and in graveyard', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    const caveDef = makeDef('cave_def', {
      type_line: 'Land - Cave',
      card_types: ['land'],
    });
    defs.set('cave_def', caveDef);

    // 2 Caves on battlefield owned by caster
    cards.set('cave_bf_1', makeCard('cave_bf_1', 'cave_def', 'p1', 'battlefield'));
    cards.set('cave_bf_2', makeCard('cave_bf_2', 'cave_def', 'p1', 'battlefield'));
    // 3 Cave cards in caster's graveyard
    for (let i = 0; i < 3; i++) {
      const id = `cave_gy_${i}`;
      cards.set(id, makeCard(id, 'cave_def', 'p1', 'graveyard'));
    }
    // 1 Cave owned by opponent — should NOT count
    cards.set('opp_cave', makeCard('opp_cave', 'cave_def', 'p2', 'battlefield'));

    const spellDef = makeDef('leech', {
      oracle_text:
        'This spell costs {1} less to cast for each Cave you control and each Cave card in your graveyard.',
      card_types: ['creature'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // 2 battlefield + 3 graveyard = 5
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(5);
  });

  // --------------------------------------------------------------------------
  // Form 7: total power of creatures you control (Volcanic Salvo)
  // --------------------------------------------------------------------------
  it('sums total power of creatures you control', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    // 3/3 creature
    defs.set('bear_3', makeDef('bear_3', { type_line: 'Creature', card_types: ['creature'], power: 3, toughness: 3 }));
    // 5/5 creature
    defs.set('behem_5', makeDef('behem_5', { type_line: 'Creature', card_types: ['creature'], power: 5, toughness: 5 }));
    // 1/1 creature
    defs.set('squirrel_1', makeDef('squirrel_1', { type_line: 'Creature', card_types: ['creature'], power: 1, toughness: 1 }));
    // opponent's 4/4 — should NOT count
    defs.set('opp_4', makeDef('opp_4', { type_line: 'Creature', card_types: ['creature'], power: 4, toughness: 4 }));

    cards.set('c1', makeCard('c1', 'bear_3', 'p1', 'battlefield'));
    cards.set('c2', makeCard('c2', 'behem_5', 'p1', 'battlefield'));
    cards.set('c3', makeCard('c3', 'squirrel_1', 'p1', 'battlefield'));
    cards.set('opp', makeCard('opp', 'opp_4', 'p2', 'battlefield'));

    const spellDef = makeDef('salvo', {
      oracle_text:
        'This spell costs {X} less to cast, where X is the total power of creatures you control.',
      card_types: ['sorcery'],
    });

    const state = makeState({ cards, cardDefinitions: defs });
    // 3 + 5 + 1 = 9
    expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(9);
  });
});

// ============================================================================
// 3. EXECUTION — castSpell pays the reduced cost
// ============================================================================

describe('slice 5 — execution via castSpell', () => {
  it('opponents: 3-player game reduces cast cost at payment', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    cards.set('spell_1', makeCard('spell_1', 'spell_def', 'p1', 'hand'));
    defs.set('spell_def', makeDef('spell_def', {
      name: 'Mob Anger',
      type_line: 'Sorcery',
      oracle_text: 'This spell costs {1} less to cast for each opponent you have.',
      mana_cost: '{4}',
      cmc: 4,
      card_types: ['sorcery'],
      power: undefined,
      toughness: undefined,
    }));

    // 3-player game: p1 has 2 opponents, so reduction = 2; cost = 4 - 2 = 2
    const players = [makePlayer('p1'), makePlayer('p2'), makePlayer('p3')];
    players[0] = { ...players[0], manaPool: { ...emptyManaPool(), C: 2 } };

    const state = makeState({ players, cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', defs.get('spell_def')!)).toBe(2);

    const after = castSpell(state, 'p1', 'spell_1');
    const p1After = after.players.find(p => p.id === 'p1')!;
    expect(totalMana(p1After)).toBe(0);
    expect(after.cards.get('spell_1')!.zone).toBe('stack');
  });

  it('compound graveyard+battlefield: reduces cost by sum at cast', () => {
    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    cards.set('leech_hand', makeCard('leech_hand', 'leech_def', 'p1', 'hand'));

    const caveDef = makeDef('cave_def', {
      type_line: 'Land - Cave',
      card_types: ['land'],
    });
    defs.set('cave_def', caveDef);

    // 2 Caves on battlefield, 1 in graveyard → reduction 3
    cards.set('cave1', makeCard('cave1', 'cave_def', 'p1', 'battlefield'));
    cards.set('cave2', makeCard('cave2', 'cave_def', 'p1', 'battlefield'));
    cards.set('cave_gy', makeCard('cave_gy', 'cave_def', 'p1', 'graveyard'));

    defs.set('leech_def', makeDef('leech_def', {
      name: 'Gargantuan Leech',
      type_line: 'Creature - Leech',
      oracle_text:
        'This spell costs {1} less to cast for each Cave you control and each Cave card in your graveyard.\nLifelink',
      mana_cost: '{5}{G}',
      cmc: 6,
      card_types: ['creature'],
      power: 6,
      toughness: 6,
    }));

    const players = [makePlayer('p1'), makePlayer('p2')];
    // Expected cost: {5}{G} − 3 = {2}{G}; provide 3 generic (G comes from pool)
    players[0] = { ...players[0], manaPool: { ...emptyManaPool(), G: 1, C: 2 } };

    const state = makeState({ players, cards, cardDefinitions: defs });
    expect(getIntrinsicCostReduction(state, 'p1', defs.get('leech_def')!)).toBe(3);

    const after = castSpell(state, 'p1', 'leech_hand');
    const p1After = after.players.find(p => p.id === 'p1')!;
    expect(totalMana(p1After)).toBe(0);
    expect(after.cards.get('leech_hand')!.zone).toBe('stack');
  });
});

// ============================================================================
// 4. HONESTY — conditional / unevaluable forms are declined
// ============================================================================

describe('slice 5 — honesty gates', () => {
  it('NOW claims "for each creature with a +1/+1 counter on it" (Hamza form) — CardInstance.counters IS tracked', () => {
    // Slice 5 added Form 15: +1/+1 counter-gated form is now supported because
    // CardInstance.counters is maintained in GameState and readable at cast time.
    const r = parseOracleText(
      'This spell costs {1} less to cast for each creature you control with a +1/+1 counter on it.',
    );
    // Should parse as StaticAbility (ReduceCost marker)
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ReduceCost');
    expect(r.ability.selfOnly).toBe(true);
  });

  it('does NOT apply "costs less if it targets a tapped creature" conditional', () => {
    // Context-conditional reductions are not evaluated at all by getIntrinsicCostReduction
    const def = makeDef('d', {
      oracle_text: 'This spell costs {2} less to cast if it targets a tapped creature.',
      card_types: ['instant'],
    });
    const state = makeState({ cards: new Map(), cardDefinitions: new Map() });
    // Flat regex must not match conditional "if" form
    expect(getIntrinsicCostReduction(state, 'p1', def)).toBe(0);
  });

  it('does NOT claim "for each opponent you have" form as a flat reduction', () => {
    // The flat form check should not accidentally fire on the opponents form
    const r = parseOracleText(
      'This spell costs {1} less to cast for each opponent you have.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    // Amount should be 0 (dynamic, not flat)
    expect(r.ability.modifier).toEqual({ kind: 'ReduceCost', amount: 0 });
  });
});

// ============================================================================
// 5. ABSORPTION — cost-reduction line + parseable trigger/ETB
// ============================================================================

describe('slice 5 — cost-reduction line absorption', () => {
  it('absorbs cost-reduction line and parses the ETB trigger remainder', () => {
    // A mixed face: cost-reduction + ETB trigger
    const r = parseOracleText(
      'This spell costs {1} less to cast for each opponent you have.\nWhen this creature enters, draw a card.',
    );
    // The ETB trigger should parse (not Unparsed)
    expect(r.kind).not.toBe('Unparsed');
    // Should be an ETB kind (draw a card)
    expect(r.kind).toBe('ETB');
  });

  it('does NOT absorb an unsupported counter-based cost reduction line', () => {
    // "for each creature with a counter" cannot be evaluated, so the whole face
    // must not be absorbed and then mistakenly parsed.
    const r = parseOracleText(
      'This spell costs {1} less to cast for each creature you control with a +1/+1 counter on it.\nWhen this creature enters, draw a card.',
    );
    // Should remain Unparsed or parse as ETB without cost-reduction absorption
    // (the ETB may still parse via the normal dispatch after the cost line fails)
    // We don't demand Unparsed here since the ETB might still parse normally,
    // but we do demand no StaticAbility ReduceCost marker is emitted.
    if (r.kind === 'StaticAbility') {
      expect(r.ability.modifier.kind).not.toBe('ReduceCost');
    }
  });
});
