/**
 * Slice 11 — Intervening-if ETB: "When this creature enters, if you cast it, …"
 *
 * Tests the enteredByCasting condition variant:
 *  - Parser wraps the ETB effect in ConditionalEffect { kind: 'EnteredByCasting' }
 *    when "if you cast it" follows the ETB trigger prefix.
 *  - createETBTriggers propagates enteredViaCast=true in eventContext only when
 *    called from the spell-resolution path (stack.ts resolveTopOfStack).
 *  - At resolution, evaluateCondition returns true when enteredViaCast=true and
 *    false otherwise (blink, reanimate, search-to-battlefield).
 *  - Execution: effect fires when enteredViaCast; no-op when absent.
 *  - Real oracle excerpts that have parseable inner effects are fully covered;
 *    cards whose inner effects are not yet engine-backed remain Unparsed (honest).
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState } from '../game-state';
import {
  resolveTopOfStack,
  putTriggersOnStack,
  registerBattlefieldAbilities,
  createETBTriggers,
  castSpell,
} from '../stack';
import { executeEffects } from '../effects/executor';
import type { GameState, CardDefinition } from '../types';
import { createPlayer } from '../types';
import { populateParsedCache } from '../cards/card-parser-cache';
import { addMana } from '../mana';
import type { ConditionalEffect, Effect } from '../effects/ast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: [
      { ...createPlayer('p1', 'Player 1'), manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 }, hasPriority: true },
      { ...createPlayer('p2', 'Player 2'), manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, hasPriority: false },
    ],
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'main',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    damagePreventionEffects: [],
    gameOutcomePreventionEffects: [],
    spellCastProhibitions: [],
    ...overrides,
  };
}

function addCard(
  state: GameState,
  instanceId: string,
  ownerId: string,
  zone: 'hand' | 'battlefield' | 'library' | 'graveyard',
  defOverrides: Partial<CardDefinition>,
): void {
  const baseDef: CardDefinition = {
    id: defOverrides.id ?? instanceId + '_def',
    name: defOverrides.name ?? 'Test Card',
    type_line: defOverrides.type_line ?? 'Creature - Test',
    oracle_text: defOverrides.oracle_text ?? '',
    mana_cost: defOverrides.mana_cost ?? '{2}{G}',
    cmc: defOverrides.cmc ?? 3,
    colors: defOverrides.colors ?? ['G'],
    color_identity: defOverrides.color_identity ?? ['G'],
    keywords: defOverrides.keywords ?? [],
    card_types: defOverrides.card_types ?? ['creature'],
    power: defOverrides.power ?? 2,
    toughness: defOverrides.toughness ?? 2,
  };
  const fullDef = populateParsedCache(baseDef);
  state.cardDefinitions.set(fullDef.id, fullDef);
  state.cards.set(instanceId, {
    instanceId,
    definitionId: fullDef.id,
    ownerId,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
}

function countCardsInZone(state: GameState, playerId: string, zone: string): number {
  let count = 0;
  for (const card of state.cards.values()) {
    if (card.ownerId === playerId && card.zone === zone) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// 1. Parser: "if you cast it" wraps effect in ConditionalEffect
// ---------------------------------------------------------------------------

describe('Parser — intervening-if "if you cast it" ETB', () => {
  it('wraps ETB draw-a-card in ConditionalEffect{EnteredByCasting} when "if you cast it" present', () => {
    const result = parseOracleText('When this creature enters, if you cast it, draw a card.');
    expect(result.kind).toBe('ETB');
    if (result.kind !== 'ETB') return;
    const effects = result.ability.effects;
    expect(effects).toHaveLength(1);
    const cond = effects[0] as ConditionalEffect;
    expect(cond.kind).toBe('Conditional');
    expect(cond.condition.kind).toBe('EnteredByCasting');
    expect(cond.effect.kind).toBe('Draw');
  });

  it('wraps ETB "you gain 3 life" in ConditionalEffect{EnteredByCasting}', () => {
    const result = parseOracleText('When this creature enters, if you cast it, you gain 3 life.');
    expect(result.kind).toBe('ETB');
    if (result.kind !== 'ETB') return;
    const cond = result.ability.effects[0] as ConditionalEffect;
    expect(cond.kind).toBe('Conditional');
    expect(cond.condition.kind).toBe('EnteredByCasting');
    expect(cond.effect.kind).toBe('GainLife');
  });

  it('handles "if you cast it" with "whenever" prefix form', () => {
    const result = parseOracleText('Whenever this creature enters, if you cast it, draw a card.');
    expect(result.kind).toBe('ETB');
    if (result.kind !== 'ETB') return;
    const cond = result.ability.effects[0] as ConditionalEffect;
    expect(cond.kind).toBe('Conditional');
    expect(cond.condition.kind).toBe('EnteredByCasting');
  });

  it('handles nested "if you cast it" (prefix text before ETB sentence)', () => {
    const result = parseOracleText(
      'Flying\nWhen this creature enters, if you cast it, draw a card.',
    );
    // Flying is a keyword line; the ETB line should parse
    expect(result.kind).toBe('ETB');
    if (result.kind !== 'ETB') return;
    const cond = result.ability.effects[0] as ConditionalEffect;
    expect(cond.kind).toBe('Conditional');
    expect(cond.condition.kind).toBe('EnteredByCasting');
  });

  it('normal ETB without "if you cast it" still parses without ConditionalEffect wrapper', () => {
    const result = parseOracleText('When this creature enters, draw a card.');
    expect(result.kind).toBe('ETB');
    if (result.kind !== 'ETB') return;
    // Direct draw, not wrapped
    expect(result.ability.effects[0].kind).toBe('Draw');
  });

  // Honest-unparsed check: Retriever Phoenix — "learn" is not engine-backed
  it('Retriever Phoenix: "if you cast it, learn." remains Unparsed (learn not yet supported)', () => {
    const oracle = 'Flying, haste\nWhen this creature enters, if you cast it, learn.';
    const result = parseOracleText(oracle);
    // The ETB + if-cast wrapping attempts to parse "learn" — since learn is
    // not a supported effect, the whole ETB result is Unparsed (honest).
    // This confirms we do NOT emit a false-positive parse.
    expect(result.kind).toBe('Unparsed');
  });

  // Honest-unparsed check: Bringer of the Last Gift complex effect
  it('Bringer of the Last Gift: "if you cast it, each player sacrifices all other creatures" remains Unparsed', () => {
    const oracle =
      'Flying\nWhen this creature enters, if you cast it, each player sacrifices all other creatures they control. Then each player returns all creature cards from their graveyard to the battlefield.';
    const result = parseOracleText(oracle);
    // "each player sacrifices all other creatures they control" is not currently
    // matched (only "each player sacrifices a/an <type>" is supported).
    expect(result.kind).toBe('Unparsed');
  });
});

// ---------------------------------------------------------------------------
// 2. createETBTriggers — enteredViaCast propagation
// ---------------------------------------------------------------------------

describe('createETBTriggers — enteredViaCast flag', () => {
  it('sets enteredViaCast=true in pending trigger eventContext when enteredViaCast param is true', () => {
    const state = createTestState();
    addCard(state, 'caster-inst', 'p1', 'battlefield', {
      id: 'caster-def',
      name: 'Caster Creature',
      oracle_text: 'When this creature enters, if you cast it, draw a card.',
    });
    let s = registerBattlefieldAbilities(state, 'caster-inst');
    // Simulate cast entry
    s = createETBTriggers(s, 'caster-inst', true);
    expect(s.pendingTriggers).toHaveLength(1);
    expect(s.pendingTriggers[0].eventContext?.enteredViaCast).toBe(true);
  });

  it('leaves enteredViaCast absent when enteredViaCast param is false/omitted (blink / search path)', () => {
    const state = createTestState();
    addCard(state, 'blinked-inst', 'p1', 'battlefield', {
      id: 'blinked-def',
      name: 'Blinked Creature',
      oracle_text: 'When this creature enters, if you cast it, draw a card.',
    });
    let s = registerBattlefieldAbilities(state, 'blinked-inst');
    // No enteredViaCast (blink / reanimate path)
    s = createETBTriggers(s, 'blinked-inst');
    expect(s.pendingTriggers).toHaveLength(1);
    // eventContext should not have enteredViaCast: true
    expect(s.pendingTriggers[0].eventContext?.enteredViaCast).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// 3. Execution: ConditionalEffect{EnteredByCasting} fires only when cast
// ---------------------------------------------------------------------------

describe('Execution — EnteredByCasting condition', () => {
  it('effect fires when enteredViaCast=true is in eventContext', () => {
    const state = createTestState();
    addCard(state, 'draw-inst', 'p1', 'battlefield', {
      id: 'draw-def',
      name: 'Draw Creature',
      oracle_text: 'When this creature enters, if you cast it, draw a card.',
    });
    let s = registerBattlefieldAbilities(state, 'draw-inst');
    s = createETBTriggers(s, 'draw-inst', true); // cast entry
    expect(s.pendingTriggers).toHaveLength(1);

    const triggerId = s.pendingTriggers[0].id;
    const handBefore = countCardsInZone(s, 'p1', 'hand');
    // Move a card to library so draw has something to take
    addCard(s, 'library-card', 'p1', 'library', { id: 'lib-def', name: 'Library Card' });
    s = putTriggersOnStack(s, { [triggerId]: [] });
    s = resolveTopOfStack(s);

    const handAfter = countCardsInZone(s, 'p1', 'hand');
    expect(handAfter).toBe(handBefore + 1); // drew 1 card
  });

  it('effect does NOT fire when enteredViaCast is absent (non-cast entry)', () => {
    const state = createTestState();
    addCard(state, 'draw-inst2', 'p1', 'battlefield', {
      id: 'draw-def2',
      name: 'Draw Creature 2',
      oracle_text: 'When this creature enters, if you cast it, draw a card.',
    });
    let s = registerBattlefieldAbilities(state, 'draw-inst2');
    s = createETBTriggers(s, 'draw-inst2'); // no enteredViaCast → blink/reanimate path
    expect(s.pendingTriggers).toHaveLength(1);

    const triggerId = s.pendingTriggers[0].id;
    // Ensure library has a card so draw wouldn't silently skip
    addCard(s, 'library-card2', 'p1', 'library', { id: 'lib-def2', name: 'Library Card 2' });
    const handBefore = countCardsInZone(s, 'p1', 'hand');
    s = putTriggersOnStack(s, { [triggerId]: [] });
    s = resolveTopOfStack(s);

    const handAfter = countCardsInZone(s, 'p1', 'hand');
    expect(handAfter).toBe(handBefore); // no draw — condition was false
  });

  it('effect fires when cast via resolveTopOfStack (full spell-cast path)', () => {
    // Build state where p1 casts the creature from hand
    const state = createTestState();
    // Add a card to p1's library so draw has something
    addCard(state, 'lib-card3', 'p1', 'library', { id: 'lib-def3', name: 'Library Card 3' });
    addCard(state, 'cast-creature', 'p1', 'hand', {
      id: 'cast-creature-def',
      name: 'Cast Creature',
      oracle_text: 'When this creature enters, if you cast it, draw a card.',
      mana_cost: '{2}{G}',
      cmc: 3,
    });

    // Give mana using the player mana pool helper
    let s: GameState = { ...state };
    const p1Idx = s.players.findIndex(p => p.id === 'p1');
    s = {
      ...s,
      players: s.players.map((p, i) =>
        i === p1Idx ? { ...p, manaPool: { ...p.manaPool, G: 2, C: 1 } } : p,
      ),
    };
    s = castSpell(s, 'p1', 'cast-creature', []);

    expect(s.stack).toHaveLength(1);
    const handBefore = countCardsInZone(s, 'p1', 'hand');

    // Resolve the spell — creature enters via cast path
    s = resolveTopOfStack(s);

    // Should have triggered pending triggers (ETB)
    expect(s.pendingTriggers).toHaveLength(1);
    expect(s.pendingTriggers[0].eventContext?.enteredViaCast).toBe(true);

    // Put triggers on stack and resolve
    const triggerId = s.pendingTriggers[0].id;
    s = putTriggersOnStack(s, { [triggerId]: [] });
    s = resolveTopOfStack(s);

    const handAfter = countCardsInZone(s, 'p1', 'hand');
    expect(handAfter).toBe(handBefore + 1); // drew 1 card
  });
});

// ---------------------------------------------------------------------------
// 4. executeEffects — direct ConditionalEffect{EnteredByCasting} unit test
// ---------------------------------------------------------------------------

describe('executeEffects — ConditionalEffect{EnteredByCasting} direct execution', () => {
  it('condition evaluates true when enteredViaCast=true in eventContext', () => {
    const state = createTestState();
    addCard(state, 'lib-e1', 'p1', 'library', { id: 'lib-e1-def', name: 'Lib E1' });
    const handBefore = countCardsInZone(state, 'p1', 'hand');

    const conditionalDraw: ConditionalEffect = {
      kind: 'Conditional',
      condition: { kind: 'EnteredByCasting' },
      effect: { kind: 'Draw', player: { kind: 'Controller' }, count: 1 },
    };

    const newState = executeEffects(
      state,
      [conditionalDraw as unknown as Effect],
      'p1',
      [],
      [],
      0,
      { eventContext: { enteredViaCast: true } },
    );

    expect(countCardsInZone(newState, 'p1', 'hand')).toBe(handBefore + 1);
  });

  it('condition evaluates false when enteredViaCast absent', () => {
    const state = createTestState();
    addCard(state, 'lib-e2', 'p1', 'library', { id: 'lib-e2-def', name: 'Lib E2' });
    const handBefore = countCardsInZone(state, 'p1', 'hand');

    const conditionalDraw: ConditionalEffect = {
      kind: 'Conditional',
      condition: { kind: 'EnteredByCasting' },
      effect: { kind: 'Draw', player: { kind: 'Controller' }, count: 1 },
    };

    const newState = executeEffects(
      state,
      [conditionalDraw as unknown as Effect],
      'p1',
      [],
      [],
      0,
      { eventContext: {} }, // no enteredViaCast
    );

    expect(countCardsInZone(newState, 'p1', 'hand')).toBe(handBefore); // no draw
  });
});
