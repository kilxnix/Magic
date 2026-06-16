import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { getIntrinsicCostReduction, getCostReduction } from '../effects/continuous';
import { castSpell, registerContinuousAbilitiesForPermanent } from '../stack';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

// ============================================================================
// Test helpers (mirrors continuous.test.ts)
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

function makeCard(instanceId: string, definitionId: string, ownerId: string, zone = 'battlefield' as const): CardInstance {
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
// RECOGNITION: the parser now reports these faces as parsed (non-Unparsed),
// emitting the ReduceCost marker the engine's getIntrinsicCostReduction enforces.
// ============================================================================

describe('self cost reduction — parser recognition', () => {
  it('recognizes flat "This spell costs {N} less to cast."', () => {
    const r = parseOracleText('This spell costs {2} less to cast.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ReduceCost', amount: 2 });
    expect(r.ability.selfOnly).toBe(true);
  });

  it('recognizes "for each" dynamic form', () => {
    const r = parseOracleText('This spell costs {1} less to cast for each creature on the battlefield.');
    expect(r.kind).toBe('StaticAbility');
  });

  it('recognizes "greatest mana value among" dynamic form', () => {
    const r = parseOracleText('This spell costs {X} less to cast, where X is the greatest mana value among artifacts your opponents control.');
    expect(r.kind).toBe('StaticAbility');
  });

  it('recognizes the cost line alongside engine-handled keywords', () => {
    expect(parseOracleText('Flying\nThis spell costs {2} less to cast.').kind).toBe('StaticAbility');
    expect(parseOracleText('This spell costs {1} less to cast.\nTrample').kind).toBe('StaticAbility');
  });

  // HONESTY GATES — do NOT claim faces the intrinsic reducer does not enforce.
  it('does NOT claim a face carrying a real (non-keyword) effect beside the cost line', () => {
    // "Draw a card." is a genuine unrun function — must stay parsed AS the spell
    // effect (Spell), not masked by the cost marker.
    const r = parseOracleText('This spell costs {1} less to cast.\nDraw a card.');
    expect(r.kind).not.toBe('StaticAbility');
  });

  it('does not let the self matcher swallow battlefield "OTHER spells cost less" statics', () => {
    // These ARE parsed (by the pre-existing static matcher -> continuous
    // getCostReduction), but as a battlefield static, not a selfOnly marker.
    const r = parseOracleText('Creature spells you cast cost {1} less to cast.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    // The battlefield static is controller 'you' but NOT selfOnly.
    expect(r.ability.selfOnly).not.toBe(true);
  });
});

// ============================================================================
// ENFORCEMENT: prove the engine actually makes the spell cost less by EXECUTING
// a real cast through castSpell and observing the mana actually paid.
// ============================================================================

describe('self cost reduction — engine enforcement (executing cast)', () => {
  it('flat: a {4} spell with "costs {2} less" actually pays only 2 mana', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('spell_1', makeCard('spell_1', 'spell_def', 'p1', 'hand'));

    const defs = new Map<string, CardDefinition>();
    defs.set('spell_def', makeDef('spell_def', {
      name: 'Cheap Spell',
      type_line: 'Sorcery',
      oracle_text: 'This spell costs {2} less to cast.',
      mana_cost: '{4}',
      cmc: 4,
      card_types: ['sorcery'],
      power: undefined,
      toughness: undefined,
    }));

    const players = [makePlayer('p1'), makePlayer('p2')];
    // Give exactly the REDUCED cost (2 generic). If the engine did NOT apply the
    // reduction the {4} cost would be unpayable and castSpell would throw.
    players[0] = { ...players[0], manaPool: { ...emptyManaPool(), C: 2 } };

    const state = makeState({ players, cards, cardDefinitions: defs });

    // Sanity: the intrinsic reducer reports the printed amount.
    expect(getIntrinsicCostReduction(state, 'p1', defs.get('spell_def')!)).toBe(2);

    const after = castSpell(state, 'p1', 'spell_1');
    const p1After = after.players.find(p => p.id === 'p1')!;
    // All 2 mana consumed (4 - 2 reduction = 2 paid). Pool is now empty.
    expect(totalMana(p1After)).toBe(0);
    // Spell made it onto the stack — the cast resolved past payment.
    expect(after.cards.get('spell_1')!.zone).toBe('stack');
  });

  it('flat: paying with surplus leaves exactly (cost - reduction) consumed', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('spell_1', makeCard('spell_1', 'spell_def', 'p1', 'hand'));

    const defs = new Map<string, CardDefinition>();
    defs.set('spell_def', makeDef('spell_def', {
      name: 'Cheap Spell',
      type_line: 'Sorcery',
      oracle_text: 'This spell costs {1} less to cast.',
      mana_cost: '{3}',
      cmc: 3,
      card_types: ['sorcery'],
      power: undefined,
      toughness: undefined,
    }));

    const players = [makePlayer('p1'), makePlayer('p2')];
    players[0] = { ...players[0], manaPool: { ...emptyManaPool(), C: 5 } };

    const state = makeState({ players, cards, cardDefinitions: defs });

    const after = castSpell(state, 'p1', 'spell_1');
    const p1After = after.players.find(p => p.id === 'p1')!;
    // 3 cost - 1 reduction = 2 paid; 5 - 2 = 3 remaining.
    expect(totalMana(p1After)).toBe(3);
  });

  it('dynamic per-thing: "costs {1} less for each creature" reduces by board count at cast', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('spell_1', makeCard('spell_1', 'spell_def', 'p1', 'hand'));
    // 3 creatures on the battlefield => reduction of 3.
    for (let i = 0; i < 3; i += 1) {
      cards.set(`bear_${i}`, makeCard(`bear_${i}`, 'bear_def', i % 2 === 0 ? 'p1' : 'p2', 'battlefield'));
    }

    const defs = new Map<string, CardDefinition>();
    defs.set('spell_def', makeDef('spell_def', {
      name: 'Scaling Spell',
      type_line: 'Sorcery',
      oracle_text: 'This spell costs {1} less to cast for each creature on the battlefield.',
      mana_cost: '{6}',
      cmc: 6,
      card_types: ['sorcery'],
      power: undefined,
      toughness: undefined,
    }));
    defs.set('bear_def', makeDef('bear_def', { name: 'Bear', type_line: 'Creature - Bear', card_types: ['creature'] }));

    const players = [makePlayer('p1'), makePlayer('p2')];
    // Provide exactly the reduced cost: 6 - 3 = 3.
    players[0] = { ...players[0], manaPool: { ...emptyManaPool(), C: 3 } };

    const state = makeState({ players, cards, cardDefinitions: defs });

    expect(getIntrinsicCostReduction(state, 'p1', defs.get('spell_def')!)).toBe(3);

    const after = castSpell(state, 'p1', 'spell_1');
    const p1After = after.players.find(p => p.id === 'p1')!;
    expect(totalMana(p1After)).toBe(0);
    expect(after.cards.get('spell_1')!.zone).toBe('stack');
  });

  it('does NOT leak the self-reducer to other spells when the card is on the battlefield', () => {
    // A creature whose only non-keyword line is "This spell costs {N} less to
    // cast" registers a selfOnly ReduceCost marker when it enters the field.
    // That marker must NOT reduce the controller's OTHER spells (it only ever
    // mattered while the card itself was being cast). Guarded in getCostReduction.
    const cards = new Map<string, CardInstance>();
    cards.set('dragon_1', makeCard('dragon_1', 'dragon_def', 'p1', 'battlefield'));

    const defs = new Map<string, CardDefinition>();
    defs.set('dragon_def', makeDef('dragon_def', {
      name: 'Self Reducer Dragon',
      type_line: 'Creature - Dragon',
      oracle_text: 'This spell costs {3} less to cast.',
      mana_cost: '{6}{R}',
      cmc: 7,
      card_types: ['creature'],
      colors: ['R'],
      power: 6,
      toughness: 6,
    }));

    let state = makeState({ players: [makePlayer('p1'), makePlayer('p2')], cards, cardDefinitions: defs });
    state = registerContinuousAbilitiesForPermanent(state, 'dragon_1');

    // The marker is registered (selfOnly), but getCostReduction must ignore it.
    expect(getCostReduction(state, 'p1')).toBe(0);
  });
});
