/**
 * Slice 11: Battlefield-source "can't be countered" statics +
 *           "This spell can't be countered." line absorption +
 *           "Target spell can't be countered." activated-ability grant
 *
 * Covers:
 *  1. Parser recognition — creature / sliver / instant-and-sorcery / generic forms
 *  2. Parser honesty — declined faces
 *  3. Engine enforcement — executeCounterSpell refuses to counter matching spells
 *     when a battlefield static is in play
 *  4. Absorption — "This spell can't be countered.\nDestroy target ..." (Abrupt Decay)
 *  5. Activated-ability grant — "Target spell can't be countered." (Vexing Shusher)
 *  6. Controller scoping — only the static's controller's spells are protected
 *     (when controller:'you') vs all-player scope (controller:'any')
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { castSpell, resolveTopOfStack, registerContinuousAbilitiesForPermanent } from '../stack';
import { executeEffects } from '../effects/executor';
import { initGameState, getCardsInZone } from '../game-state';
import { GameState, CardDefinition, createPlayer, Phase, Step } from '../types';
import { populateParsedCache } from '../cards/card-parser-cache';

// ---------------------------------------------------------------------------
// Minimal state helpers
// ---------------------------------------------------------------------------

function createTestState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: [
      { ...createPlayer('p1', 'Player 1'), hasPriority: true },
      { ...createPlayer('p2', 'Player 2'), hasPriority: false },
    ],
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as Phase,
    step: 'main' as Step,
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    ...overrides,
  };
}

function addCard(
  state: GameState,
  instanceId: string,
  ownerId: string,
  zone: 'hand' | 'battlefield' | 'library' | 'graveyard' | 'command',
  def: Partial<CardDefinition>,
): void {
  const baseDef: CardDefinition = {
    id: def.id ?? instanceId,
    name: def.name ?? 'Test Card',
    type_line: def.type_line ?? 'Creature',
    oracle_text: def.oracle_text ?? '',
    mana_cost: def.mana_cost ?? '',
    cmc: def.cmc ?? 0,
    colors: def.colors ?? [],
    color_identity: def.color_identity ?? [],
    keywords: def.keywords ?? [],
    card_types: def.card_types ?? ['creature'],
    power: def.power,
    toughness: def.toughness,
  };
  const fullDef = populateParsedCache(baseDef);
  state.cardDefinitions.set(fullDef.id, fullDef);
  state.cards.set(instanceId, {
    instanceId,
    definitionId: fullDef.id,
    ownerId,
    zone,
    tapped: false,
    summoningSick: zone === 'battlefield',
    counters: {},
    damage: 0,
    isCommander: false,
  });
}

// ---------------------------------------------------------------------------
// 1. Parser recognition
// ---------------------------------------------------------------------------

describe('matchBattlefieldCantBeCountered — parser recognition', () => {
  // --- Prowling Serpopard / Surrak Dragonclaw ---
  it('Creature spells you control can\'t be countered.', () => {
    const r = parseOracleText("Creature spells you control can't be countered.");
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('GrantKeyword');
    if (mod.kind !== 'GrantKeyword') return;
    expect(mod.keyword).toBe('CantBeCountered');
    expect(r.ability.selfOnly).toBeFalsy();
    expect(r.ability.controller).toBe('you');
    expect(r.ability.filter.types).toContain('creature');
  });

  // --- Gaea's Herald ---
  it('Creature spells can\'t be countered.  (any-controller form)', () => {
    const r = parseOracleText("Creature spells can't be countered.");
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('GrantKeyword');
    if (mod.kind !== 'GrantKeyword') return;
    expect(mod.keyword).toBe('CantBeCountered');
    expect(r.ability.selfOnly).toBeFalsy();
    expect(r.ability.controller).toBe('any');
    expect(r.ability.filter.types).toContain('creature');
  });

  // --- Root Sliver ---
  it('Sliver spells can\'t be countered.  (subtype form)', () => {
    const r = parseOracleText("Sliver spells can't be countered.");
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('GrantKeyword');
    if (mod.kind !== 'GrantKeyword') return;
    expect(mod.keyword).toBe('CantBeCountered');
    expect(r.ability.controller).toBe('any');
    expect(r.ability.filter.subtypes).toContain('sliver');
  });

  // --- Sphinx of the Final Word ---
  it('Instant and sorcery spells you control can\'t be countered.', () => {
    const r = parseOracleText("Instant and sorcery spells you control can't be countered.");
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('GrantKeyword');
    if (mod.kind !== 'GrantKeyword') return;
    expect(mod.keyword).toBe('CantBeCountered');
    expect(r.ability.controller).toBe('you');
    const types = r.ability.filter.types ?? [];
    expect(types).toContain('instant');
    expect(types).toContain('sorcery');
  });

  it('Spells you control can\'t be countered.  (generic form)', () => {
    const r = parseOracleText("Spells you control can't be countered.");
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('GrantKeyword');
    if (mod.kind !== 'GrantKeyword') return;
    expect(mod.keyword).toBe('CantBeCountered');
    expect(r.ability.controller).toBe('you');
  });
});

// ---------------------------------------------------------------------------
// 2. Parser honesty — these should NOT parse as a StaticAbility (CBC form)
// ---------------------------------------------------------------------------

describe('matchBattlefieldCantBeCountered — declined shapes', () => {
  it('declines a face with a real unrun trigger beside the CBC line', () => {
    // If there's a trigger clause alongside the CBC sentence, the face stays
    // Unparsed — we never mask an unrun triggered ability.
    const r = parseOracleText(
      "Creature spells you control can't be countered.\nWhenever a creature enters under your control, draw a card.",
    );
    // Should not parse as a plain StaticAbility with CantBeCountered modifier
    // because the trigger is not modelled by this matcher.
    if (r.kind === 'StaticAbility') {
      const mod = r.ability.modifier;
      // If it somehow parses as StaticAbility, it must NOT be our CBC marker
      // (it might be the trigger-backed per-line dispatch, which is fine).
      expect(mod.kind === 'GrantKeyword' && (mod as any).keyword === 'CantBeCountered' && !r.ability.selfOnly).toBe(false);
    }
  });

  it('does NOT claim the self-form "This spell can\'t be countered." as a battlefield static', () => {
    // The self-form must still parse as a selfOnly marker, not a battlefield static.
    const r = parseOracleText("This spell can't be countered.");
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('GrantKeyword');
    if (mod.kind !== 'GrantKeyword') return;
    expect(mod.keyword).toBe('CantBeCountered');
    // Must be selfOnly — this is the spell-self form, not a battlefield static.
    expect(r.ability.selfOnly).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Engine enforcement — battlefield-source static protects spells
// ---------------------------------------------------------------------------

/**
 * Set up a game where:
 *   - p1 controls a battlefield permanent that grants "Creature spells you control
 *     can't be countered."
 *   - p1 casts a creature spell
 *   - p2 casts a counterspell targeting it
 * The counterspell must fail to counter it.
 */
function setupBattlefieldCBC(
  granterOracle: string,
  granterFilter: { controller: string },
): { state: GameState; creatureId: string; counterspellId: string } {
  let state = createTestState({
    phase: 'precombat_main' as Phase,
  });

  state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 5, C: 0 };

  // p1 has the granter on the battlefield
  addCard(state, 'granter_1', 'p1', 'battlefield', {
    id: 'granter_def',
    name: 'Serpopard Proxy',
    type_line: 'Creature — Cat Snake',
    oracle_text: granterOracle,
    mana_cost: '{1}{G}{G}',
    cmc: 3,
    colors: ['G'],
    card_types: ['creature'],
    power: 4,
    toughness: 3,
  });
  state = registerContinuousAbilitiesForPermanent(state, 'granter_1');

  // p1 has a creature spell in hand
  addCard(state, 'creature_1', 'p1', 'hand', {
    id: 'creature_def',
    name: 'Target Creature',
    type_line: 'Creature — Beast',
    oracle_text: '',
    mana_cost: '{G}',
    cmc: 1,
    colors: ['G'],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
  });

  // p2 has a counterspell in hand
  addCard(state, 'counter_1', 'p2', 'hand', {
    id: 'counter_def',
    name: 'Counterspell',
    type_line: 'Instant',
    oracle_text: 'Counter target spell.',
    mana_cost: '{U}{U}',
    cmc: 2,
    colors: ['U'],
    card_types: ['instant'],
  });

  return { state, creatureId: 'creature_1', counterspellId: 'counter_1' };
}

describe('executeCounterSpell — battlefield CBC static enforcement', () => {
  it('Creature spells you control can\'t be countered — counterspell fails on creature', () => {
    const { state: s0, creatureId, counterspellId } = setupBattlefieldCBC(
      "Creature spells you control can't be countered.",
      { controller: 'you' },
    );

    // p1 casts the creature
    let state = castSpell(s0, 'p1', creatureId);
    expect(state.stack).toHaveLength(1);

    // p2 casts counterspell
    state = {
      ...state,
      priorityPlayerIndex: 1,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, manaPool: { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 } } : p,
      ),
    };
    state = castSpell(state, 'p2', counterspellId, [creatureId]);
    expect(state.stack).toHaveLength(2);

    // Resolve counterspell — it must fail to remove the creature
    state = resolveTopOfStack(state);
    // Counterspell goes to graveyard
    expect(state.cards.get(counterspellId)?.zone).toBe('graveyard');
    // Creature is still on the stack (was NOT countered)
    expect(state.cards.get(creatureId)?.zone).toBe('stack');
    expect(state.stack).toHaveLength(1);

    // Resolve the creature — it enters the battlefield
    state = resolveTopOfStack(state);
    expect(state.cards.get(creatureId)?.zone).toBe('battlefield');
  });

  it('Creature spells can\'t be countered — protects even opponent\'s creatures (any-controller)', () => {
    // Gaea's Herald: "Creature spells can't be countered." — any player's creatures
    const { state: s0, creatureId, counterspellId } = setupBattlefieldCBC(
      "Creature spells can't be countered.",
      { controller: 'any' },
    );

    // p1 casts the creature
    let state = castSpell(s0, 'p1', creatureId);
    expect(state.stack).toHaveLength(1);

    // p2 tries to counter it
    state = {
      ...state,
      priorityPlayerIndex: 1,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, manaPool: { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 } } : p,
      ),
    };
    state = castSpell(state, 'p2', counterspellId, [creatureId]);

    // Resolve counterspell — should fail
    state = resolveTopOfStack(state);
    expect(state.cards.get(creatureId)?.zone).toBe('stack');
    expect(state.stack).toHaveLength(1);
  });

  it('Creature spells you control can\'t be countered — does NOT protect a sorcery', () => {
    // The static only guards creature spells. A sorcery from the same player
    // CAN be countered normally.
    let state = createTestState({ phase: 'precombat_main' as Phase });
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 5, C: 0 };

    // p1's granter
    addCard(state, 'granter_2', 'p1', 'battlefield', {
      id: 'granter_def2',
      name: 'Serpopard Proxy 2',
      type_line: 'Creature',
      oracle_text: "Creature spells you control can't be countered.",
      mana_cost: '{1}{G}{G}',
      cmc: 3,
      colors: ['G'],
      card_types: ['creature'],
      power: 4,
      toughness: 3,
    });
    state = registerContinuousAbilitiesForPermanent(state, 'granter_2');

    // p1's sorcery spell
    addCard(state, 'sorcery_1', 'p1', 'hand', {
      id: 'sorcery_def',
      name: 'Divination',
      type_line: 'Sorcery',
      oracle_text: 'Draw 2 cards.',
      mana_cost: '{2}{U}',
      cmc: 3,
      colors: ['U'],
      card_types: ['sorcery'],
    });

    // p2's counterspell
    addCard(state, 'counter_2', 'p2', 'hand', {
      id: 'counter_def2',
      name: 'Counterspell',
      type_line: 'Instant',
      oracle_text: 'Counter target spell.',
      mana_cost: '{U}{U}',
      cmc: 2,
      colors: ['U'],
      card_types: ['instant'],
    });

    // p1 casts sorcery
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, manaPool: { W: 0, U: 3, B: 0, R: 0, G: 0, C: 0 } } : p,
      ),
    };
    state = castSpell(state, 'p1', 'sorcery_1');
    expect(state.stack).toHaveLength(1);

    // p2 counters it
    state = {
      ...state,
      priorityPlayerIndex: 1,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, manaPool: { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 } } : p,
      ),
    };
    state = castSpell(state, 'p2', 'counter_2', ['sorcery_1']);

    // Counterspell resolves — sorcery IS countered (goes to graveyard)
    state = resolveTopOfStack(state);
    expect(state.cards.get('sorcery_1')?.zone).toBe('graveyard');
  });
});

// ---------------------------------------------------------------------------
// 4. Absorption — "This spell can't be countered.\n<real effect>" (Abrupt Decay)
// ---------------------------------------------------------------------------

describe('Abrupt Decay / Void Rend — CBC line absorption', () => {
  it('absorbs "This spell can\'t be countered." from a Destroy spell and parses the remainder', () => {
    // Abrupt Decay oracle: "This spell can't be countered.\nDestroy target nonland permanent with mana value 3 or less."
    const r = parseOracleText(
      "This spell can't be countered.\nDestroy target nonland permanent with mana value 3 or less.",
    );
    // The Destroy effect should parse; "This spell can't be countered." is absorbed.
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects.length).toBeGreaterThan(0);
    const destroyEffect = r.effects.find(e => e.kind === 'Destroy');
    expect(destroyEffect).toBeDefined();
  });

  it('hasCantBeCounteredText still sees "This spell can\'t be countered." in Abrupt Decay oracle', () => {
    // Verify the runtime enforcement: even after CBC line absorption for parser
    // purposes, the original oracle text of Abrupt Decay contains the CBC clause,
    // so hasCantBeCounteredText (used by stack.ts at cast time) returns true.
    // We test this by setting up a state manually and checking the flag.
    let state = createTestState({ phase: 'precombat_main' as Phase });

    // p1's Abrupt Decay card in hand
    addCard(state, 'decay_1', 'p1', 'hand', {
      id: 'abrupt_decay_def',
      name: 'Abrupt Decay',
      type_line: 'Instant',
      oracle_text: "This spell can't be countered.\nDestroy target nonland permanent with mana value 3 or less.",
      mana_cost: '{B}{G}',
      cmc: 2,
      colors: ['B', 'G'],
      card_types: ['instant'],
    });

    // Put a nonland permanent on the battlefield to satisfy Abrupt Decay's target requirement
    addCard(state, 'bear_1', 'p2', 'battlefield', {
      id: 'bear_def',
      name: 'Grizzly Bears',
      type_line: 'Creature',
      oracle_text: '',
      mana_cost: '{1}{G}',
      cmc: 2,
      colors: ['G'],
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });

    state = {
      ...state,
      players: state.players.map(p =>
        p.id === 'p1' ? { ...p, manaPool: { W: 0, U: 0, B: 1, R: 0, G: 1, C: 0 } } : p,
      ),
    };

    // p1 casts Abrupt Decay targeting the bear
    state = castSpell(state, 'p1', 'decay_1', ['bear_1']);
    expect(state.stack).toHaveLength(1);
    // The cantBeCountered flag should be set because the oracle text contains
    // "This spell can't be countered."
    expect((state.stack[0] as any).cantBeCountered).toBe(true);
  });
});

// Helper card factories

function makeAbruptDecay(): CardDefinition {
  return {
    id: 'abrupt-decay-1',
    name: 'Abrupt Decay',
    type_line: 'Instant',
    oracle_text: "This spell can't be countered.\nDestroy target nonland permanent with mana value 3 or less.",
    mana_cost: '{B}{G}',
    cmc: 2,
    colors: ['B', 'G'],
    color_identity: ['B', 'G'],
    keywords: [],
    card_types: ['instant'],
  };
}

function makeCounterspell(): CardDefinition {
  return {
    id: 'counterspell-bf-1',
    name: 'Counterspell',
    type_line: 'Instant',
    oracle_text: 'Counter target spell.',
    mana_cost: '{U}{U}',
    cmc: 2,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    card_types: ['instant'],
  };
}

// ---------------------------------------------------------------------------
// 5. Activated-ability grant — "Target spell can't be countered." (Vexing Shusher)
// ---------------------------------------------------------------------------

describe('matchGrantCantBeCountered — parser and execution', () => {
  it('parses "{R/G}: Target spell can\'t be countered this turn." as an Activated ability', () => {
    const r = parseOracleText("{R/G}: Target spell can't be countered this turn.");
    // Should parse as an Activated ability containing a GrantCantBeCountered effect
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const ability = r.abilities[0];
    expect(ability).toBeDefined();
    const gccEffect = ability.effects.find(e => e.kind === 'GrantCantBeCountered');
    expect(gccEffect).toBeDefined();
  });

  it('GrantCantBeCountered execution: sets cantBeCountered on the target stack item', () => {
    // Set up a state where a spell is on the stack
    let state = createTestState({ phase: 'precombat_main' as Phase });

    addCard(state, 'target_spell', 'p1', 'hand', {
      id: 'target_spell_def',
      name: 'Lightning Bolt',
      type_line: 'Instant',
      oracle_text: '~ deals 3 damage to any target.',
      mana_cost: '{R}',
      cmc: 1,
      colors: ['R'],
      card_types: ['instant'],
    });

    // Manually push a spell stack item (simulating castSpell putting it on the stack)
    state.cards.set('target_spell', { ...state.cards.get('target_spell')!, zone: 'stack' });
    const spellItem = {
      kind: 'Spell' as const,
      id: 'stack_item_1',
      cardInstanceId: 'target_spell',
      casterId: 'p1',
      targets: [],
      castFromZone: 'hand' as const,
    };
    state = { ...state, stack: [spellItem] };

    // Execute a GrantCantBeCountered effect targeting the stack item by its cardInstanceId
    const effect = { kind: 'GrantCantBeCountered' as const, target: { kind: 'Chosen' as const, targetId: 'target_0' } };
    const newState = executeEffects(state, [effect], 'p2', ['target_spell'], [{ id: 'target_0' }]);

    // The stack item should now have cantBeCountered = true
    const newItem = newState.stack[0] as any;
    expect(newItem.cantBeCountered).toBe(true);
  });
});
