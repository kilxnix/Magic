/**
 * Slice 2: Conditional self-buff — "This creature gets +N/+N as long as <condition>"
 *
 * Tests that parseStaticCondition recognises and evaluateCondition evaluates:
 *   - "there is a [type] card in your graveyard" → CardsInZoneAtLeast { zone:'graveyard', count:1, filter }
 *   - "it's untapped" / "it is untapped"          → SelfIsUntapped
 *   - "it's attacking" / "it is attacking"         → SelfIsAttacking
 *   - "you control a Desert"                       → ControlsType { filter: { types:['land'], subtypes:['desert'] } }
 *   - "no opponent controls a white or blue creature" → ControlsNone { controller:'opponent', filter:{ types:['creature'], colors:['W','U'] } }
 *   - "you control another Merfolk or an Island"   → ControlsType with anyOf filter
 *
 * Real oracle wordings from:
 *   Murasa Behemoth: "This creature gets +3/+3 as long as there is a land card in your graveyard."
 *   Giant Tortoise: "This creature gets +0/+3 as long as it's untapped."
 *   Ramunap Hydra: "...This creature gets +1/+1 as long as you control a Desert..."
 *   Skittish Kavu: "This creature gets +1/+1 as long as no opponent controls a white or blue creature."
 *   Kumena's Speaker: "This creature gets +1/+1 as long as you control another Merfolk or an Island."
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { getEffectivePower, getEffectiveToughness, evaluateCondition } from '../effects/continuous';
import { initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import type { CardDefinition, GameState } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function creature(
  id: string,
  opts: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Creature — Test',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{2}',
    cmc: opts.cmc ?? 2,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

function land(
  id: string,
  opts: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Land',
    oracle_text: opts.oracle_text ?? '{T}: Add {C}.',
    mana_cost: opts.mana_cost ?? null as unknown as string,
    cmc: opts.cmc ?? 0,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['land'],
    power: undefined,
    toughness: undefined,
  };
}

function spell(
  id: string,
  opts: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Instant',
    oracle_text: opts.oracle_text ?? 'Draw a card.',
    mana_cost: opts.mana_cost ?? '{1}',
    cmc: opts.cmc ?? 1,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['instant'],
    power: undefined,
    toughness: undefined,
  };
}

/** Build a two-player state with all cards on the battlefield and statics registered. */
function setup(
  p1Defs: CardDefinition[],
  p2Defs: CardDefinition[] = [creature('dummy-p2')],
) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'none1' },
    { playerId: 'p2', name: 'Bob', cards: p2Defs, commanderId: 'none2' },
  ];
  let state = initGameState(decks);
  for (const [, card] of state.cards) {
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', summoningSick: false });
  }
  for (const card of state.cards.values()) {
    state = registerContinuousAbilitiesForPermanent(state, card.instanceId);
  }
  const idFor = (defId: string) =>
    [...state.cards.values()].find(c => c.definitionId === defId)!.instanceId;
  return { state, idFor };
}

/** Move a card to graveyard. */
function toGraveyard(state: GameState, instanceId: string): GameState {
  const card = state.cards.get(instanceId);
  if (!card) return state;
  const next = new Map(state.cards);
  next.set(instanceId, { ...card, zone: 'graveyard' });
  return { ...state, cards: next };
}

/** Tap a card. */
function tapCard(state: GameState, instanceId: string): GameState {
  const card = state.cards.get(instanceId);
  if (!card) return state;
  const next = new Map(state.cards);
  next.set(instanceId, { ...card, tapped: true });
  return { ...state, cards: next };
}

// ---------------------------------------------------------------------------
// Parser-level tests
// ---------------------------------------------------------------------------

describe('Slice 2 conditional self-buff — parser recognition', () => {

  // ── "there is a [type] card in your graveyard" ─────────────────────────────

  it('Murasa Behemoth: "there is a land card in your graveyard" → CardsInZoneAtLeast count=1', () => {
    const r = parseOracleText(
      'Trample\nThis creature gets +3/+3 as long as there is a land card in your graveyard.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toMatchObject({
      kind: 'CardsInZoneAtLeast',
      controller: 'you',
      zone: 'graveyard',
      count: 1,
    });
    expect(r.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 3, toughness: 3 });
  });

  it('"there is a creature card in your graveyard" → CardsInZoneAtLeast with creature filter', () => {
    const r = parseOracleText(
      'This creature gets +2/+0 as long as there is a creature card in your graveyard.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const cond = r.ability.condition;
    expect(cond).toMatchObject({ kind: 'CardsInZoneAtLeast', zone: 'graveyard', count: 1 });
    if (cond?.kind !== 'CardsInZoneAtLeast') return;
    expect(cond.filter).toMatchObject({ types: ['creature'] });
  });

  it('prefix form: "As long as there is a land card in your graveyard, this creature gets +3/+3."', () => {
    const r = parseOracleText(
      'As long as there is a land card in your graveyard, this creature gets +3/+3.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toMatchObject({ kind: 'CardsInZoneAtLeast', zone: 'graveyard', count: 1 });
  });

  // ── "it's untapped" ────────────────────────────────────────────────────────

  it('Giant Tortoise: "it\'s untapped" → SelfIsUntapped', () => {
    const r = parseOracleText(
      "This creature gets +0/+3 as long as it's untapped.",
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'SelfIsUntapped' });
    expect(r.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 0, toughness: 3 });
    expect(r.ability.selfOnly).toBe(true);
  });

  it('"it is untapped" alternate wording → SelfIsUntapped', () => {
    const r = parseOracleText(
      'This creature gets +1/+1 as long as it is untapped.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'SelfIsUntapped' });
  });

  it('prefix form: "As long as it\'s untapped, this creature gets +0/+3."', () => {
    const r = parseOracleText(
      "As long as it's untapped, this creature gets +0/+3.",
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'SelfIsUntapped' });
  });

  // ── "it's attacking" ───────────────────────────────────────────────────────

  it('"it\'s attacking" → SelfIsAttacking', () => {
    const r = parseOracleText(
      "This creature gets +2/+0 as long as it's attacking.",
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'SelfIsAttacking' });
    expect(r.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 2, toughness: 0 });
  });

  it('"it is attacking" alternate wording → SelfIsAttacking', () => {
    const r = parseOracleText(
      'This creature gets +2/+0 as long as it is attacking.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'SelfIsAttacking' });
  });

  // ── "you control a Desert" ────────────────────────────────────────────────

  it('Ramunap Hydra: "you control a Desert" → ControlsType with desert subtype filter', () => {
    const r = parseOracleText(
      'This creature gets +1/+1 as long as you control a Desert.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toMatchObject({
      kind: 'ControlsType',
      controller: 'you',
      filter: { types: ['land'], subtypes: ['desert'] },
    });
  });

  // ── "no opponent controls a white or blue creature" ───────────────────────

  it('Skittish Kavu: "no opponent controls a white or blue creature" → ControlsNone opponent', () => {
    const r = parseOracleText(
      'This creature gets +1/+1 as long as no opponent controls a white or blue creature.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const cond = r.ability.condition;
    expect(cond?.kind).toBe('ControlsNone');
    if (cond?.kind !== 'ControlsNone') return;
    expect(cond.controller).toBe('opponent');
    // Filter should include both white and blue colors (matchesCardFilter colors = any-of)
    expect(cond.filter.types).toContain('creature');
    expect(cond.filter.colors).toContain('W');
    expect(cond.filter.colors).toContain('U');
  });

  // ── "you control another Merfolk or an Island" ────────────────────────────

  it("Kumena's Speaker: \"you control another Merfolk or an Island\" → ControlsType with anyOf", () => {
    const r = parseOracleText(
      "This creature gets +1/+1 as long as you control another Merfolk or an Island.",
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const cond = r.ability.condition;
    expect(cond?.kind).toBe('ControlsType');
    if (cond?.kind !== 'ControlsType') return;
    expect(cond.controller).toBe('you');
    // Should exclude self (another)
    expect(cond.excludeSource).toBe(true);
    // Filter should use anyOf (Merfolk creature OR Island land)
    expect(cond.filter.anyOf).toBeDefined();
    if (!cond.filter.anyOf) return;
    expect(cond.filter.anyOf.length).toBe(2);
  });

  // ── "your opponents control no white or blue creature" (existing syntax) ──

  it('"your opponents control no white or blue creature" → ControlsNone (existing path)', () => {
    const r = parseOracleText(
      'This creature gets +1/+1 as long as your opponents control no white or blue creature.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const cond = r.ability.condition;
    expect(cond?.kind).toBe('ControlsNone');
    if (cond?.kind !== 'ControlsNone') return;
    expect(cond.controller).toBe('opponent');
    expect(cond.filter.types).toContain('creature');
    // Colors may be accumulated as multi-color array OR require anyOf; either works
  });

});

// ---------------------------------------------------------------------------
// Execution tests (evaluateCondition + getEffectivePower/Toughness)
// ---------------------------------------------------------------------------

describe('Slice 2 conditional self-buff — engine execution', () => {

  // ── SelfIsUntapped ────────────────────────────────────────────────────────

  it('Giant Tortoise: +0/+3 when untapped, no buff when tapped', () => {
    const tortoise = creature('tortoise', {
      name: 'Giant Tortoise',
      oracle_text: "This creature gets +0/+3 as long as it's untapped.",
      power: 1,
      toughness: 1,
    });
    const { state, idFor } = setup([tortoise]);
    const id = idFor('tortoise');

    // Untapped: buff active
    expect(getEffectivePower(state, id)).toBe(1);    // power unchanged
    expect(getEffectiveToughness(state, id)).toBe(4); // 1 + 3

    // Tapped: buff inactive
    const tapped = tapCard(state, id);
    expect(getEffectivePower(tapped, id)).toBe(1);
    expect(getEffectiveToughness(tapped, id)).toBe(1);
  });

  it('SelfIsUntapped evaluateCondition: direct test', () => {
    const tortoise = creature('tortoise2', {
      name: 'Giant Tortoise',
      oracle_text: "This creature gets +0/+3 as long as it's untapped.",
      power: 1, toughness: 1,
    });
    const { state, idFor } = setup([tortoise]);
    const id = idFor('tortoise2');

    expect(evaluateCondition(state, { kind: 'SelfIsUntapped' }, 'p1', id)).toBe(true);

    const tapped = tapCard(state, id);
    expect(evaluateCondition(tapped, { kind: 'SelfIsUntapped' }, 'p1', id)).toBe(false);

    // No sourceInstanceId → false (conservative)
    expect(evaluateCondition(state, { kind: 'SelfIsUntapped' }, 'p1', undefined)).toBe(false);
  });

  // ── SelfIsAttacking ───────────────────────────────────────────────────────

  it('SelfIsAttacking evaluateCondition: true only when declared as attacker', () => {
    const beater = creature('beater', {
      name: 'Attack Beater',
      oracle_text: "This creature gets +2/+0 as long as it's attacking.",
      power: 2, toughness: 2,
    });
    const { state, idFor } = setup([beater]);
    const id = idFor('beater');

    // No combat: false
    expect(evaluateCondition(state, { kind: 'SelfIsAttacking' }, 'p1', id)).toBe(false);

    // Simulate combat with this creature attacking
    const stateWithCombat: GameState = {
      ...state,
      combat: {
        ...state.combat,
        phase: 'declare_attackers',
        attackers: [{ cardInstanceId: id, defendingPlayerId: 'p2', abilities: [] }],
        blockers: [],
        damageAssignment: [],
      },
    };
    expect(evaluateCondition(stateWithCombat, { kind: 'SelfIsAttacking' }, 'p1', id)).toBe(true);

    // Buff applied
    expect(getEffectivePower(stateWithCombat, id)).toBe(4);
    expect(getEffectiveToughness(stateWithCombat, id)).toBe(2);

    // Another creature is attacking but not this one: false for this id
    const otherId = [...state.cards.keys()].find(k => k !== id)!;
    expect(evaluateCondition(stateWithCombat, { kind: 'SelfIsAttacking' }, 'p1', otherId)).toBe(false);
  });

  // ── CardsInZoneAtLeast (there is a land card in graveyard) ─────────────────

  it('Murasa Behemoth: +3/+3 when a land card is in your graveyard', () => {
    const murasa = creature('murasa', {
      name: 'Murasa Behemoth',
      oracle_text: 'Trample\nThis creature gets +3/+3 as long as there is a land card in your graveyard.',
      power: 4, toughness: 4,
    });
    const testLand = land('tland', { name: 'Test Land' });
    const { state, idFor } = setup([murasa, testLand]);
    const mId = idFor('murasa');
    const lId = idFor('tland');

    // Land on battlefield: condition false → no buff
    expect(getEffectivePower(state, mId)).toBe(4);
    expect(getEffectiveToughness(state, mId)).toBe(4);

    // Land in graveyard: condition true → +3/+3
    const gy = toGraveyard(state, lId);
    expect(getEffectivePower(gy, mId)).toBe(7);
    expect(getEffectiveToughness(gy, mId)).toBe(7);
  });

  // ── ControlsType with Desert subtype ─────────────────────────────────────

  it('ControlsType Desert: buff active when you control a Desert', () => {
    const hydra = creature('hydra', {
      name: 'Ramunap Hydra',
      oracle_text: 'This creature gets +1/+1 as long as you control a Desert.',
      power: 1, toughness: 1,
    });
    const desert = land('desert', {
      name: 'Ifnir Deadlands',
      type_line: 'Land — Desert',
    });
    const plains = land('plains', {
      name: 'Plains',
      type_line: 'Basic Land — Plains',
    });

    // Without Desert
    const { state: stateNoDesert, idFor: idFor1 } = setup([hydra, plains]);
    const hId1 = idFor1('hydra');
    expect(getEffectivePower(stateNoDesert, hId1)).toBe(1);
    expect(getEffectiveToughness(stateNoDesert, hId1)).toBe(1);

    // With Desert
    const { state: stateWithDesert, idFor: idFor2 } = setup([hydra, desert]);
    const hId2 = idFor2('hydra');
    expect(getEffectivePower(stateWithDesert, hId2)).toBe(2);
    expect(getEffectiveToughness(stateWithDesert, hId2)).toBe(2);
  });

  // ── ControlsNone opponent (Skittish Kavu) ─────────────────────────────────

  it('Skittish Kavu: +1/+1 only when no opponent controls a white or blue creature', () => {
    const kavu = creature('kavu', {
      name: 'Skittish Kavu',
      oracle_text: 'This creature gets +1/+1 as long as no opponent controls a white or blue creature.',
      power: 2, toughness: 2,
      colors: ['G'] as any,
    });
    // Opponent controls a red creature (no white or blue) → buff active
    const redCreature = creature('redcreature', {
      name: 'Red Creature',
      colors: ['R'] as any,
      oracle_text: '',
    });
    const whiteCreature = creature('whitecreature', {
      name: 'White Creature',
      colors: ['W'] as any,
      oracle_text: '',
    });

    const { state: stateNoThreat, idFor: id1 } = setup([kavu], [redCreature]);
    const kavuId1 = id1('kavu');
    // No white/blue on opponent side → buff active
    expect(getEffectivePower(stateNoThreat, kavuId1)).toBe(3);
    expect(getEffectiveToughness(stateNoThreat, kavuId1)).toBe(3);

    const { state: stateWithThreat, idFor: id2 } = setup([kavu], [whiteCreature]);
    const kavuId2 = id2('kavu');
    // Opponent controls a white creature → buff inactive
    expect(getEffectivePower(stateWithThreat, kavuId2)).toBe(2);
    expect(getEffectiveToughness(stateWithThreat, kavuId2)).toBe(2);
  });

});
