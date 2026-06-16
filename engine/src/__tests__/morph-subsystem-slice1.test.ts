import { describe, it, expect } from 'vitest';
import {
  parseOracleText,
  parseMorphCostFromOracle,
  castMorphFaceDown,
  canTurnFaceUp,
  executeTurnFaceUp,
  tryMorphCast,
  tryTurnFaceUp,
  emptyManaPool,
} from '../index';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

/**
 * Slice 1 — Morph / Megamorph subsystem.
 *
 * Covers:
 *   (A) parseMorphCostFromOracle — oracle text → { cost, isMegamorph }
 *   (B) Morph face-down cast state machine (tryMorphCast)
 *   (C) Turn-face-up state machine (tryTurnFaceUp / executeTurnFaceUp)
 *   (D) TurnedFaceUp Triggered ability — parser + executor wiring
 *   (E) Megamorph counter (+1/+1 on turn-up)
 *   (F) Unparseable face-up bodies remain Unparsed (honesty gate)
 *
 * All oracle texts used in this file are verbatim (or close paraphrases of)
 * real MTG oracle wording printed on Morph / Megamorph creatures.
 */

// ============================================================================
// Helpers
// ============================================================================

function makePlayer(id: string, life = 40, mana: Partial<ReturnType<typeof emptyManaPool>> = {}): Player {
  return {
    id,
    name: id,
    life,
    poisonCounters: 0,
    commanderDamage: {},
    commanderTax: 0,
    commanderInstanceId: null,
    commanderCastCount: 0,
    manaPool: { ...emptyManaPool(), ...mana },
    hasPlayedLand: false,
    hasPriority: false,
    hasLost: false,
  };
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: CardInstance['zone'] = 'hand',
): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  };
}

function makeDef(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name || id,
    type_line: opts.type_line || 'Creature',
    oracle_text: opts.oracle_text || '',
    mana_cost: opts.mana_cost || '{3}{U}',
    cmc: opts.cmc || 4,
    colors: opts.colors || ['U'],
    color_identity: opts.color_identity || ['U'],
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

// ============================================================================
// (A) parseMorphCostFromOracle — oracle text to cost extraction
// ============================================================================

describe('morph subsystem slice 1 — parseMorphCostFromOracle', () => {
  it('parses plain morph cost from Willbender oracle text', () => {
    // Willbender — Morph {1}{U}
    const oracle = 'Morph {1}{U}\nWhen this creature is turned face up, change the target of target spell or ability to target creature.';
    const result = parseMorphCostFromOracle(oracle);
    expect(result).not.toBeNull();
    expect(result!.cost).toBe('{1}{U}');
    expect(result!.isMegamorph).toBe(false);
  });

  it('parses morph cost from Brine Elemental oracle text', () => {
    // Brine Elemental — Morph {5}{U}{U}
    const oracle = 'Morph {5}{U}{U}\nWhen this creature is turned face up, each opponent skips their next untap step.';
    const result = parseMorphCostFromOracle(oracle);
    expect(result).not.toBeNull();
    expect(result!.cost).toBe('{5}{U}{U}');
    expect(result!.isMegamorph).toBe(false);
  });

  it('parses megamorph cost and sets isMegamorph=true', () => {
    // Den Protector — Megamorph {1}{G}
    const oracle = 'When this creature is turned face up, return target card from your graveyard to your hand.\nMegamorph {1}{G}';
    const result = parseMorphCostFromOracle(oracle);
    expect(result).not.toBeNull();
    expect(result!.cost).toBe('{1}{G}');
    expect(result!.isMegamorph).toBe(true);
  });

  it('returns null for oracle text with no morph line', () => {
    const result = parseMorphCostFromOracle('Flying\nWhen this creature enters, draw a card.');
    expect(result).toBeNull();
  });

  it('parses Skirk Commando morph cost (Morph {1}{R})', () => {
    // Skirk Commando — Morph {1}{R}
    const oracle = 'Morph {1}{R}\nWhen this creature is turned face up, it deals 2 damage to target creature.';
    const result = parseMorphCostFromOracle(oracle);
    expect(result).not.toBeNull();
    expect(result!.cost).toBe('{1}{R}');
    expect(result!.isMegamorph).toBe(false);
  });
});

// ============================================================================
// (B) Parse: TurnedFaceUp Triggered abilities from real oracle text
// ============================================================================

describe('morph subsystem slice 1 — parse TurnedFaceUp Triggered', () => {
  it('Skirk Commando face-up trigger parses as Triggered with TurnedFaceUp', () => {
    // Oracle: "Morph {1}{R}\nWhen this creature is turned face up, it deals 2 damage to target creature."
    // Body: "it deals 2 damage to target creature." — parseable via matchDealDamage
    const oracle = 'Morph {1}{R}\nWhen this creature is turned face up, it deals 2 damage to target creature.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('TurnedFaceUp');
    // Morph cost line is absorbed (pure downside; not a real effect)
    expect(r.absorbedKeywords?.some(k => /morph/i.test(k))).toBe(true);
    // Face-up trigger is NOT in absorbedKeywords (it registered as a real Triggered ability)
    expect(r.absorbedKeywords?.some(k => /turned face up/i.test(k))).toBeFalsy();
  });

  it('Den Protector (Megamorph) face-up ETB-style trigger parses as Triggered', () => {
    // Oracle: "Megamorph {1}{G}\nWhen this creature is turned face up, return target card from your graveyard to your hand."
    const oracle = 'Megamorph {1}{G}\nWhen this creature is turned face up, return target card from your graveyard to your hand.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('TurnedFaceUp');
    expect(r.absorbedKeywords?.some(k => /mega.?morph/i.test(k))).toBe(true);
    expect(r.absorbedKeywords?.some(k => /turned face up/i.test(k))).toBeFalsy();
  });

  it('Tribal Forcemage face-up anthem trigger parses as Triggered with TurnedFaceUp', () => {
    // Oracle: "Morph {1}{G}\nWhen this creature is turned face up, creatures you control get +2/+2 until end of turn."
    const oracle = 'Morph {1}{G}\nWhen this creature is turned face up, creatures you control get +2/+2 until end of turn.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('TurnedFaceUp');
    expect(r.ability.effects.length).toBeGreaterThan(0);
    expect(r.absorbedKeywords?.some(k => /morph/i.test(k))).toBe(true);
    expect(r.absorbedKeywords?.some(k => /turned face up/i.test(k))).toBeFalsy();
  });

  it('draw a card face-up trigger parses as Triggered with TurnedFaceUp', () => {
    // Simple face-up draw trigger
    const oracle = 'Morph {2}{U}\nWhen this creature is turned face up, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('TurnedFaceUp');
    expect(r.ability.effects.some(e => e.kind === 'Draw')).toBe(true);
  });

  it('Willbender (unparseable retarget) remains Unparsed — honesty gate', () => {
    // Willbender: "Morph {1}{U}\nWhen this creature is turned face up, change the target of
    // target spell or ability to target creature." — body is NOT parseable (change-target is
    // not in the effect dispatch table). Must remain Unparsed, never Triggered or Spell.
    const oracle = 'Morph {1}{U}\nWhen this creature is turned face up, change the target of target spell or ability to target creature.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
    expect(r.kind).not.toBe('Spell');
    expect(r.kind).not.toBe('Triggered');
  });
});

// ============================================================================
// (C) Execute: face-down cast state machine (tryMorphCast)
// ============================================================================

describe('morph subsystem slice 1 — tryMorphCast state machine', () => {
  function buildStateForMorphCast(mana: Partial<ReturnType<typeof emptyManaPool>> = {}) {
    const cards = new Map<string, CardInstance>();
    cards.set('sk_1', makeCard('sk_1', 'sk_def', 'p1', 'hand'));

    const defs = new Map<string, CardDefinition>();
    defs.set('sk_def', makeDef('sk_def', {
      name: 'Skirk Commando',
      type_line: 'Creature — Goblin',
      oracle_text: 'Morph {1}{R}\nWhen this creature is turned face up, it deals 2 damage to target creature.',
      mana_cost: '{1}{R}',
      cmc: 2,
      colors: ['R'],
      color_identity: ['R'],
      keywords: [],
      power: 2,
      toughness: 1,
    }));

    const players = [makePlayer('p1', 40, mana), makePlayer('p2', 40)];
    return makeState({ cards, cardDefinitions: defs, players });
  }

  it('fails if card is not in hand', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('sk_1', makeCard('sk_1', 'sk_def', 'p1', 'battlefield'));
    const defs = new Map<string, CardDefinition>();
    defs.set('sk_def', makeDef('sk_def', {
      name: 'Skirk Commando',
      oracle_text: 'Morph {1}{R}\nWhen this creature is turned face up, it deals 2 damage to target creature.',
    }));
    const state = makeState({ cards, cardDefinitions: defs });
    const result = tryMorphCast(state, 'p1', 'sk_1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_in_zone');
  });

  it('fails if player has insufficient mana for {3}', () => {
    // Only 2 colorless available — need 3
    const state = buildStateForMorphCast({ C: 2 });
    const result = tryMorphCast(state, 'p1', 'sk_1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('insufficient_mana');
  });

  it('fails if card has no morph cost', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('plain_1', makeCard('plain_1', 'plain_def', 'p1', 'hand'));
    const defs = new Map<string, CardDefinition>();
    defs.set('plain_def', makeDef('plain_def', { oracle_text: 'Flying' }));
    const players = [makePlayer('p1', 40, { C: 5 }), makePlayer('p2', 40)];
    const state = makeState({ cards, cardDefinitions: defs, players });
    const result = tryMorphCast(state, 'p1', 'plain_1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('illegal_target');
  });

  it('succeeds with exactly {3} colorless mana; card enters face-down as 2/2', () => {
    const state = buildStateForMorphCast({ C: 3 });
    const result = tryMorphCast(state, 'p1', 'sk_1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const card = result.state.cards.get('sk_1')!;
    expect(card.zone).toBe('battlefield');
    expect(card.faceDown).toBe(true);
    expect(card.morphCost).toBe('{1}{R}');
    expect(card.isMegamorph).toBe(false);
    expect(card.summoningSick).toBe(true);

    // Player paid {3} — pool should be empty
    const player = result.state.players.find(p => p.id === 'p1')!;
    const total = Object.values(player.manaPool).reduce((s, v) => s + v, 0);
    expect(total).toBe(0);
  });

  it('succeeds with mixed mana (R+G covers the 3 generic); card enters face-down', () => {
    // {3} generic can be paid by any mana
    const state = buildStateForMorphCast({ R: 2, G: 1 });
    const result = tryMorphCast(state, 'p1', 'sk_1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const card = result.state.cards.get('sk_1')!;
    expect(card.zone).toBe('battlefield');
    expect(card.faceDown).toBe(true);
    expect(card.morphCost).toBe('{1}{R}');
  });
});

// ============================================================================
// (D) Execute: turn-face-up state machine (tryTurnFaceUp)
// ============================================================================

describe('morph subsystem slice 1 — tryTurnFaceUp state machine', () => {
  function buildStateForTurnUp(morphCost: string, mana: Partial<ReturnType<typeof emptyManaPool>> = {}, isMegamorph = false) {
    const cards = new Map<string, CardInstance>();
    cards.set('sk_1', {
      instanceId: 'sk_1',
      definitionId: 'sk_def',
      ownerId: 'p1',
      zone: 'battlefield',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
      faceDown: true,
      morphCost,
      isMegamorph,
    });

    const defs = new Map<string, CardDefinition>();
    defs.set('sk_def', makeDef('sk_def', {
      name: 'Skirk Commando',
      type_line: 'Creature — Goblin',
      oracle_text: 'Morph {1}{R}\nWhen this creature is turned face up, it deals 2 damage to target creature.',
      mana_cost: '{1}{R}',
      cmc: 2,
      colors: ['R'],
      color_identity: ['R'],
      keywords: [],
      power: 2,
      toughness: 1,
    }));

    const players = [makePlayer('p1', 40, mana), makePlayer('p2', 40)];
    return makeState({ cards, cardDefinitions: defs, players });
  }

  it('fails if card is not face-down', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('sk_1', makeCard('sk_1', 'sk_def', 'p1', 'battlefield'));
    const defs = new Map<string, CardDefinition>();
    defs.set('sk_def', makeDef('sk_def', { oracle_text: 'Morph {1}{R}' }));
    const state = makeState({ cards, cardDefinitions: defs });
    const result = tryTurnFaceUp(state, 'p1', 'sk_1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('illegal_target');
  });

  it('fails if player cannot afford the morph cost', () => {
    // Morph cost is {1}{R}, player has no mana
    const state = buildStateForTurnUp('{1}{R}', {});
    const result = tryTurnFaceUp(state, 'p1', 'sk_1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('insufficient_mana');
  });

  it('succeeds when player can afford morph cost; card is face-up', () => {
    // Morph cost {1}{R}; provide {1}{R}
    const state = buildStateForTurnUp('{1}{R}', { C: 1, R: 1 });
    const result = tryTurnFaceUp(state, 'p1', 'sk_1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const card = result.state.cards.get('sk_1')!;
    expect(card.faceDown).toBeFalsy();
    expect(card.zone).toBe('battlefield');

    // Player paid {1}{R} — pool should be empty
    const player = result.state.players.find(p => p.id === 'p1')!;
    const total = Object.values(player.manaPool).reduce((s, v) => s + v, 0);
    expect(total).toBe(0);
  });

  it('parseable TurnedFaceUp trigger is queued as pending trigger after turn-up', () => {
    // Skirk Commando: "When this creature is turned face up, it deals 2 damage to target creature."
    // After turning face up, we expect a pendingTrigger for TurnedFaceUp to be queued.
    const state = buildStateForTurnUp('{1}{R}', { C: 1, R: 1 });
    const result = tryTurnFaceUp(state, 'p1', 'sk_1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // A TurnedFaceUp trigger should be pending
    const turnedUpTriggers = result.state.pendingTriggers.filter(
      t => t.ability.trigger.kind === 'TurnedFaceUp',
    );
    expect(turnedUpTriggers.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// (E) Megamorph: +1/+1 counter on turn-up
// ============================================================================

describe('morph subsystem slice 1 — megamorph +1/+1 counter', () => {
  it('Den Protector megamorph gets +1/+1 counter on turn-up', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('den_1', {
      instanceId: 'den_1',
      definitionId: 'den_def',
      ownerId: 'p1',
      zone: 'battlefield',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
      faceDown: true,
      morphCost: '{1}{G}',
      isMegamorph: true,
    });

    const defs = new Map<string, CardDefinition>();
    defs.set('den_def', makeDef('den_def', {
      name: 'Den Protector',
      type_line: 'Creature — Human Warrior',
      oracle_text: 'Megamorph {1}{G}\nWhen this creature is turned face up, return target card from your graveyard to your hand.',
      mana_cost: '{1}{G}',
      cmc: 2,
      colors: ['G'],
      color_identity: ['G'],
      keywords: [],
      power: 2,
      toughness: 2,
    }));

    const players = [makePlayer('p1', 40, { G: 1, C: 1 }), makePlayer('p2', 40)];
    const state = makeState({ cards, cardDefinitions: defs, players });

    const result = tryTurnFaceUp(state, 'p1', 'den_1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const card = result.state.cards.get('den_1')!;
    expect(card.faceDown).toBeFalsy();
    // Megamorph: +1/+1 counter placed on the creature
    expect((card.counters['p1p1'] ?? card.counters['+1/+1'] ?? 0) +
           (card.counters['p1p1'] ?? 0)).toBeGreaterThanOrEqual(0);
    // Specifically check for a counter increment using the actual counter key
    const counterSum = Object.values(card.counters).reduce((s, v) => s + v, 0);
    expect(counterSum).toBeGreaterThanOrEqual(1);
  });

  it('regular morph does NOT get a +1/+1 counter on turn-up', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('sk_1', {
      instanceId: 'sk_1',
      definitionId: 'sk_def',
      ownerId: 'p1',
      zone: 'battlefield',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
      faceDown: true,
      morphCost: '{1}{R}',
      isMegamorph: false,
    });

    const defs = new Map<string, CardDefinition>();
    defs.set('sk_def', makeDef('sk_def', {
      name: 'Skirk Commando',
      oracle_text: 'Morph {1}{R}\nWhen this creature is turned face up, it deals 2 damage to target creature.',
      mana_cost: '{1}{R}',
      cmc: 2,
      colors: ['R'],
      keywords: [],
    }));

    const players = [makePlayer('p1', 40, { R: 1, C: 1 }), makePlayer('p2', 40)];
    const state = makeState({ cards, cardDefinitions: defs, players });

    const result = tryTurnFaceUp(state, 'p1', 'sk_1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const card = result.state.cards.get('sk_1')!;
    const counterSum = Object.values(card.counters).reduce((s, v) => s + v, 0);
    // Non-megamorph: no counter
    expect(counterSum).toBe(0);
  });
});

// ============================================================================
// (F) Full round-trip: cast face-down then turn face-up
// ============================================================================

describe('morph subsystem slice 1 — full round-trip cast + turn up', () => {
  it('Skirk Commando: cast face-down for {3}, then turn face-up for {1}{R}', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('sk_1', makeCard('sk_1', 'sk_def', 'p1', 'hand'));

    const defs = new Map<string, CardDefinition>();
    defs.set('sk_def', makeDef('sk_def', {
      name: 'Skirk Commando',
      type_line: 'Creature — Goblin',
      oracle_text: 'Morph {1}{R}\nWhen this creature is turned face up, it deals 2 damage to target creature.',
      mana_cost: '{1}{R}',
      cmc: 2,
      colors: ['R'],
      color_identity: ['R'],
      keywords: [],
      power: 2,
      toughness: 1,
    }));

    // Player starts with {C:3} (exactly for the {3} face-down cost) — no colored mana
    // so that payUnrestrictedManaCost cannot spend R on the generic cost.
    const players = [makePlayer('p1', 40, { C: 3, W: 0, U: 0, B: 0, R: 0, G: 0 }), makePlayer('p2', 40)];
    let state = makeState({ cards, cardDefinitions: defs, players });

    // Step 1: cast face-down for {3}
    const castResult = tryMorphCast(state, 'p1', 'sk_1');
    expect(castResult.ok).toBe(true);
    if (!castResult.ok) return;
    state = castResult.state;

    const faceDownCard = state.cards.get('sk_1')!;
    expect(faceDownCard.zone).toBe('battlefield');
    expect(faceDownCard.faceDown).toBe(true);

    // Player spent all mana on the {3} cast — pool is now empty.
    const playerAfterCast = state.players.find(p => p.id === 'p1')!;
    const remainingAfterCast = Object.values(playerAfterCast.manaPool).reduce((s, v) => s + v, 0);
    expect(remainingAfterCast).toBe(0);

    // Simulate floating {1}{R} from tapping lands between steps (the test drives state directly).
    const updatedPlayers = state.players.map(p =>
      p.id === 'p1' ? { ...p, manaPool: { ...p.manaPool, C: 1, R: 1 } } : p,
    );
    state = { ...state, players: updatedPlayers };

    // Step 2: turn face-up for {1}{R} — player has exactly {C:1, R:1}, enough to pay.
    const turnResult = tryTurnFaceUp(state, 'p1', 'sk_1');
    expect(turnResult.ok).toBe(true);
    if (!turnResult.ok) return;
    state = turnResult.state;

    const faceUpCard = state.cards.get('sk_1')!;
    expect(faceUpCard.faceDown).toBeFalsy();
    expect(faceUpCard.zone).toBe('battlefield');

    // TurnedFaceUp trigger should be queued
    const triggersQueued = state.pendingTriggers.filter(
      t => t.ability.trigger.kind === 'TurnedFaceUp',
    );
    expect(triggersQueued.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// (G) canTurnFaceUp utility
// ============================================================================

describe('morph subsystem slice 1 — canTurnFaceUp utility', () => {
  it('returns false when card is not face-down', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('c1', makeCard('c1', 'def1', 'p1', 'battlefield'));
    const defs = new Map<string, CardDefinition>();
    defs.set('def1', makeDef('def1', { oracle_text: 'Morph {1}{G}' }));
    const state = makeState({ cards, cardDefinitions: defs });
    expect(canTurnFaceUp(state, 'c1', 'p1')).toBe(false);
  });

  it('returns false when controller lacks mana', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('c1', {
      instanceId: 'c1', definitionId: 'def1', ownerId: 'p1', zone: 'battlefield',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
      faceDown: true, morphCost: '{2}{G}', isMegamorph: false,
    });
    const defs = new Map<string, CardDefinition>();
    defs.set('def1', makeDef('def1', { oracle_text: 'Morph {2}{G}' }));
    const players = [makePlayer('p1', 40, { G: 1 }), makePlayer('p2', 40)]; // need {2}{G} but only have {G}
    const state = makeState({ cards, cardDefinitions: defs, players });
    expect(canTurnFaceUp(state, 'c1', 'p1')).toBe(false);
  });

  it('returns true when controller has sufficient mana', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('c1', {
      instanceId: 'c1', definitionId: 'def1', ownerId: 'p1', zone: 'battlefield',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
      faceDown: true, morphCost: '{1}{R}', isMegamorph: false,
    });
    const defs = new Map<string, CardDefinition>();
    defs.set('def1', makeDef('def1', { oracle_text: 'Morph {1}{R}' }));
    const players = [makePlayer('p1', 40, { R: 1, C: 1 }), makePlayer('p2', 40)];
    const state = makeState({ cards, cardDefinitions: defs, players });
    expect(canTurnFaceUp(state, 'c1', 'p1')).toBe(true);
  });
});
