import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { validateTargetChoices } from '../effects/targets';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

/**
 * Slice 1/12: One-shot target/filter vocabulary normalization
 *
 * Covers five sole-blocker families unlocked in this slice:
 *   1. "destroy target nonland permanent" — NonlandPermanent target type in matchDestroy
 *      (Abrupt Decay, Void Rend, Fate of the Sun-Cryst)
 *   2. "return target creature an opponent controls to its owner's hand" — opponentControls
 *      constraint on matchReturnToHand (Bigfin Bouncer)
 *   3. "tap target <color> creature" — color constraint on matchTap (Homarid Shaman)
 *   4. "regenerate target <color> creature" — color constraint on matchRegenerate
 *      (Trolls of Tel-Jilad)
 *   5. "look at target opponent's hand" — opponent target on matchLookAtTargetPlayerHand
 *      (Telepathic Spies, Elite Spellbinder)
 */

// ─── Test helpers ────────────────────────────────────────────────────────────

function makePlayer(id: string, life = 40): Player {
  return {
    id,
    name: id,
    life,
    poisonCounters: 0,
    commanderDamage: {},
    commanderTax: 0,
    commanderInstanceId: null,
    commanderCastCount: 0,
    manaPool: emptyManaPool(),
    hasPlayedLand: false,
    hasPriority: false,
    hasLost: false,
  };
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: 'battlefield' | 'hand' | 'graveyard' = 'battlefield',
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
    type_line: opts.type_line || 'Creature — Test',
    oracle_text: opts.oracle_text || '',
    mana_cost: opts.mana_cost || '{2}',
    cmc: opts.cmc ?? 2,
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
    combat: overrides.combat ?? null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    continuousEffects: overrides.continuousEffects || [],
  };
}

// ─── 1. destroy target nonland permanent ─────────────────────────────────────

describe('slice 1 — destroy target nonland permanent', () => {
  it('Abrupt Decay / Void Rend: "Destroy target nonland permanent." parses to NonlandPermanent target', () => {
    const r = parseOracleText('Destroy target nonland permanent.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects).toHaveLength(1);
    expect(r.effects[0].kind).toBe('Destroy');
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].type).toBe('NonlandPermanent');
    expect(r.targets[0].constraints).toBeUndefined();
  });

  it('target legality: nonland permanent is a legal target, land is not', () => {
    const r = parseOracleText('Destroy target nonland permanent.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;

    const cards = new Map<string, CardInstance>();
    cards.set('artifact_1', makeCard('artifact_1', 'def_artifact', 'p2'));
    cards.set('land_1', makeCard('land_1', 'def_land', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('def_artifact', makeDef('def_artifact', { type_line: 'Artifact', card_types: ['artifact'] }));
    defs.set('def_land', makeDef('def_land', { type_line: 'Basic Land — Forest', card_types: ['land'] }));
    const state = makeState({ cards, cardDefinitions: defs });

    // Artifact (nonland permanent) is legal
    expect(() => validateTargetChoices(state, 'p1', r.targets, ['artifact_1'])).not.toThrow();
    // Land is illegal
    expect(() => validateTargetChoices(state, 'p1', r.targets, ['land_1'])).toThrow(/nonland permanent/);
  });

  it('execution: destroys an artifact (nonland permanent)', () => {
    const r = parseOracleText('Destroy target nonland permanent.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;

    const cards = new Map<string, CardInstance>();
    cards.set('artifact_1', makeCard('artifact_1', 'def_artifact', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('def_artifact', makeDef('def_artifact', { type_line: 'Artifact', card_types: ['artifact'] }));
    const state = makeState({ cards, cardDefinitions: defs });

    const result = executeEffects(state, r.effects, 'p1', ['artifact_1'], r.targets);
    expect(result.cards.get('artifact_1')?.zone).toBe('graveyard');
  });

  it('Fate of the Sun-Cryst: activated ability "Destroy target nonland permanent." parses', () => {
    const r = parseOracleText('{2}: Destroy target nonland permanent.');
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    expect(r.abilities).toHaveLength(1);
    expect(r.abilities[0].effects[0].kind).toBe('Destroy');
    expect(r.abilities[0].targets[0].type).toBe('NonlandPermanent');
  });
});

// ─── 2. return target creature an opponent controls ───────────────────────────

describe('slice 1 — return target creature an opponent controls to its owner\'s hand', () => {
  it('Bigfin Bouncer: parses with opponentControls constraint', () => {
    const r = parseOracleText("Return target creature an opponent controls to its owner's hand.");
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects).toHaveLength(1);
    expect(r.effects[0].kind).toBe('ReturnToHand');
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].type).toBe('Creature');
    expect(r.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('target legality: opponent creature is legal; own creature is not', () => {
    const r = parseOracleText("Return target creature an opponent controls to its owner's hand.");
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;

    const cards = new Map<string, CardInstance>();
    // p2's creature — opponent of p1
    cards.set('opp_creature', makeCard('opp_creature', 'def_bear', 'p2'));
    // p1's own creature — controller
    cards.set('own_creature', makeCard('own_creature', 'def_bear', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('def_bear', makeDef('def_bear', { name: 'Bear', type_line: 'Creature — Bear' }));
    const state = makeState({ cards, cardDefinitions: defs });

    // Opponent's creature is legal
    expect(() => validateTargetChoices(state, 'p1', r.targets, ['opp_creature'])).not.toThrow();
    // Own creature is not legal (opponentControls)
    expect(() => validateTargetChoices(state, 'p1', r.targets, ['own_creature'])).toThrow(/opponent/);
  });

  it('execution: bounces opponent creature to hand', () => {
    const r = parseOracleText("Return target creature an opponent controls to its owner's hand.");
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;

    const cards = new Map<string, CardInstance>();
    cards.set('opp_creature', makeCard('opp_creature', 'def_bear', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('def_bear', makeDef('def_bear', { name: 'Bear', type_line: 'Creature — Bear' }));
    const state = makeState({ cards, cardDefinitions: defs });

    const result = executeEffects(state, r.effects, 'p1', ['opp_creature'], r.targets);
    expect(result.cards.get('opp_creature')?.zone).toBe('hand');
  });
});

// ─── 3. tap target <color> creature ──────────────────────────────────────────

describe('slice 1 — tap target <color> creature', () => {
  it('Homarid Shaman: "{U}: Tap target green creature." parses with color constraint', () => {
    const r = parseOracleText('{U}: Tap target green creature.');
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    expect(r.abilities).toHaveLength(1);
    const ability = r.abilities[0];
    expect(ability.effects[0].kind).toBe('Tap');
    expect(ability.targets).toHaveLength(1);
    expect(ability.targets[0].type).toBe('Creature');
    expect(ability.targets[0].constraints?.colors).toEqual(['G']);
  });

  it('"Tap target white or blue creature." parses with multi-color constraint', () => {
    const r = parseOracleText('Tap target white or blue creature.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects[0].kind).toBe('Tap');
    expect(r.targets[0].constraints?.colors).toContain('W');
    expect(r.targets[0].constraints?.colors).toContain('U');
  });

  it('target legality: green creature legal; red creature illegal for green-only tap', () => {
    const r = parseOracleText('{U}: Tap target green creature.');
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const ability = r.abilities[0];

    const cards = new Map<string, CardInstance>();
    cards.set('green_creature', makeCard('green_creature', 'def_green', 'p2'));
    cards.set('red_creature', makeCard('red_creature', 'def_red', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('def_green', makeDef('def_green', { name: 'Green Bear', colors: ['G'] }));
    defs.set('def_red', makeDef('def_red', { name: 'Red Bear', colors: ['R'] }));
    const state = makeState({ cards, cardDefinitions: defs });

    expect(() => validateTargetChoices(state, 'p1', ability.targets, ['green_creature'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'p1', ability.targets, ['red_creature'])).toThrow(/color/);
  });

  it('execution: taps the green creature', () => {
    const r = parseOracleText('{U}: Tap target green creature.');
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const ability = r.abilities[0];

    const cards = new Map<string, CardInstance>();
    cards.set('green_creature', makeCard('green_creature', 'def_green', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('def_green', makeDef('def_green', { name: 'Green Bear', colors: ['G'] }));
    const state = makeState({ cards, cardDefinitions: defs });

    const result = executeEffects(state, ability.effects, 'p1', ['green_creature'], ability.targets);
    expect(result.cards.get('green_creature')?.tapped).toBe(true);
  });
});

// ─── 4. regenerate target <color> creature ────────────────────────────────────

describe('slice 1 — regenerate target <color> creature', () => {
  it('Trolls of Tel-Jilad: "{1}{G}: Regenerate target green creature." parses with color constraint', () => {
    const r = parseOracleText('{1}{G}: Regenerate target green creature.');
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    expect(r.abilities).toHaveLength(1);
    const ability = r.abilities[0];
    expect(ability.effects[0].kind).toBe('Regenerate');
    expect(ability.targets).toHaveLength(1);
    expect(ability.targets[0].type).toBe('Creature');
    expect(ability.targets[0].constraints?.colors).toEqual(['G']);
  });

  it('"Regenerate target white creature." parses', () => {
    const r = parseOracleText('Regenerate target white creature.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects[0].kind).toBe('Regenerate');
    expect(r.targets[0].constraints?.colors).toEqual(['W']);
  });

  it('target legality: green creature is legal; red creature is not', () => {
    const r = parseOracleText('{1}{G}: Regenerate target green creature.');
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const ability = r.abilities[0];

    const cards = new Map<string, CardInstance>();
    cards.set('green_troll', makeCard('green_troll', 'def_green', 'p1'));
    cards.set('red_bear', makeCard('red_bear', 'def_red', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('def_green', makeDef('def_green', { name: 'Green Troll', colors: ['G'] }));
    defs.set('def_red', makeDef('def_red', { name: 'Red Bear', colors: ['R'] }));
    const state = makeState({ cards, cardDefinitions: defs });

    expect(() => validateTargetChoices(state, 'p1', ability.targets, ['green_troll'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'p1', ability.targets, ['red_bear'])).toThrow(/color/);
  });
});

// ─── 5. look at target opponent's hand ───────────────────────────────────────

describe('slice 1 — look at target opponent\'s hand', () => {
  it('Telepathic Spies: "Look at target opponent\'s hand." parses with opponentControls', () => {
    const r = parseOracleText("Look at target opponent's hand.");
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects).toHaveLength(1);
    expect(r.effects[0].kind).toBe('LookAtHand');
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].type).toBe('Player');
    expect(r.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('Elite Spellbinder ETB: "Look at target opponent\'s hand." in triggered context', () => {
    const r = parseOracleText("When Spellbinder enters the battlefield, look at target opponent's hand.");
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    expect(r.ability.effects[0].kind).toBe('LookAtHand');
    expect(r.targets[0].type).toBe('Player');
    expect(r.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('"Look at target player\'s hand." still parses without opponentControls', () => {
    const r = parseOracleText("Look at target player's hand.");
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects[0].kind).toBe('LookAtHand');
    expect(r.targets[0].type).toBe('Player');
    // No opponentControls constraint — any player is a legal target
    expect(r.targets[0].constraints?.opponentControls).toBeUndefined();
  });

  it('target legality: opponent is legal target; own player id is not', () => {
    const r = parseOracleText("Look at target opponent's hand.");
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;

    const state = makeState();

    // p1 casts; p2 is the opponent — legal
    expect(() => validateTargetChoices(state, 'p1', r.targets, ['p2'])).not.toThrow();
    // p1 targets themselves — illegal (opponentControls)
    expect(() => validateTargetChoices(state, 'p1', r.targets, ['p1'])).toThrow(/opponent/);
  });

  it('execution: LookAtHand produces no state change (informational effect)', () => {
    const r = parseOracleText("Look at target opponent's hand.");
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;

    const cards = new Map<string, CardInstance>();
    // p2 has a card in hand
    cards.set('hand_card', makeCard('hand_card', 'def_card', 'p2', 'hand'));
    const defs = new Map<string, CardDefinition>();
    defs.set('def_card', makeDef('def_card', { name: 'Hand Card' }));
    const state = makeState({ cards, cardDefinitions: defs });

    // LookAtHand should not throw and should not change any zone
    const result = executeEffects(state, r.effects, 'p1', ['p2'], r.targets);
    expect(result.cards.get('hand_card')?.zone).toBe('hand');
  });
});
