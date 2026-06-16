/**
 * Slice 11: Per-player upkeep symmetrical trigger effect clauses.
 *
 * Tests for three new matchers:
 *
 *   1. matchThatPlayerGainsControl — "that player gains control of this enchantment"
 *      (Risky Move family). GainControl with target=Source, newController=EventPlayer.
 *
 *   2. matchThatPlayerAddsMana — "that player adds {G}{G}{G}"
 *      (Shizuko, Caller of Autumn). AddMana to EventPlayer.
 *
 *   3. matchEachPlayerLosesHalfLife — "each player loses half their life, rounded up"
 *      (Havoc Festival). LoseLife EachPlayer with HalfLifeRoundedUp amount.
 *
 * Each matcher is tested for:
 *   - Parse: parseOracleText returns Triggered with the correct effect shape.
 *   - Standalone clause parse: Spell with the same effect shape.
 *   - Execution: executeEffects with eventContext produces the correct state change.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect } from '../effects/ast';
import type { GameState, CardDefinition } from '../types';
import { createPlayer } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseState(): GameState {
  return {
    players: [createPlayer('p1', 'Player 1'), createPlayer('p2', 'Player 2')],
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'beginning',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  } as GameState;
}

function makeCardDef(
  id: string,
  name: string,
  typeLine: string,
  cmc: number,
  colors: Array<'W' | 'U' | 'B' | 'R' | 'G'> = [],
): CardDefinition {
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: '',
    mana_cost: '{1}',
    cmc,
    colors,
    color_identity: colors,
    keywords: [],
    card_types: typeLine.toLowerCase().split(/[\s—–-]/).filter(t =>
      ['creature', 'instant', 'sorcery', 'enchantment', 'artifact', 'land', 'planeswalker'].includes(t)
    ),
  };
}

function addBattlefieldCard(
  state: GameState,
  instanceId: string,
  def: CardDefinition,
  ownerId: string,
): GameState {
  const newCards = new Map(state.cards);
  const defs = new Map(state.cardDefinitions);
  defs.set(def.id, def);
  newCards.set(instanceId, {
    instanceId,
    definitionId: def.id,
    ownerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  return { ...state, cards: newCards, cardDefinitions: defs };
}

function setPlayerLife(state: GameState, playerId: string, life: number): GameState {
  return {
    ...state,
    players: state.players.map(p => p.id === playerId ? { ...p, life } : p),
  };
}

function getPlayerMana(state: GameState, playerId: string) {
  return state.players.find(p => p.id === playerId)?.manaPool ?? null;
}

// ---------------------------------------------------------------------------
// 1. matchThatPlayerGainsControl (Risky Move)
// ---------------------------------------------------------------------------

describe('Slice 11 — matchThatPlayerGainsControl (Risky Move)', () => {
  it('parses "At the beginning of each player\'s upkeep, that player gains control of this enchantment." as Triggered', () => {
    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, that player gains control of this enchantment.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'each' });
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('GainControl');
    if (eff.kind !== 'GainControl') return;
    expect(eff.target).toEqual({ kind: 'Source' });
    expect(eff.newController).toEqual({ kind: 'EventPlayer' });
  });

  it('parses standalone "that player gains control of this enchantment." as Spell', () => {
    const parsed = parseOracleText('That player gains control of this enchantment.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('GainControl');
    if (eff.kind !== 'GainControl') return;
    expect(eff.target).toEqual({ kind: 'Source' });
    expect(eff.newController).toEqual({ kind: 'EventPlayer' });
  });

  it('parses "that player gains control of this permanent." (generic form)', () => {
    const parsed = parseOracleText('That player gains control of this permanent.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects[0].kind).toBe('GainControl');
  });

  it('executes: EventPlayer (p2) gains control of source enchantment (owned by p1)', () => {
    let state = baseState();
    const enchDef = makeCardDef('enc-def', 'Risky Move', 'Enchantment', 3);
    // The enchantment is currently controlled by p1 (casterId)
    state = addBattlefieldCard(state, 'enc-inst', enchDef, 'p1');

    const effects: Effect[] = [{
      kind: 'GainControl',
      target: { kind: 'Source' },
      newController: { kind: 'EventPlayer' },
    }];

    // casterId = p1 (enchantment owner), eventPlayerId = p2 (whose upkeep it is)
    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      sourceInstanceId: 'enc-inst',
      eventContext: { eventPlayerId: 'p2' },
    });

    // After execution, p2 should control the enchantment
    const encCard = result.cards.get('enc-inst');
    expect(encCard?.ownerId).toBe('p2');
  });

  it('is a no-op when there is no source instance id', () => {
    let state = baseState();
    const enchDef = makeCardDef('enc-def2', 'Enchantment', 'Enchantment', 2);
    state = addBattlefieldCard(state, 'enc-2', enchDef, 'p1');

    const effects: Effect[] = [{
      kind: 'GainControl',
      target: { kind: 'Source' },
      newController: { kind: 'EventPlayer' },
    }];

    // No sourceInstanceId provided — should be a no-op, not a crash
    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });
    // Card ownership unchanged
    expect(result.cards.get('enc-2')?.ownerId).toBe('p1');
  });
});

// ---------------------------------------------------------------------------
// 2. matchThatPlayerAddsMana (Shizuko, Caller of Autumn)
// ---------------------------------------------------------------------------

describe('Slice 11 — matchThatPlayerAddsMana (Shizuko, Caller of Autumn)', () => {
  it('parses "At the beginning of each player\'s upkeep, that player adds {G}{G}{G}." as Triggered', () => {
    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, that player adds {G}{G}{G}.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'each' });
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('AddMana');
    if (eff.kind !== 'AddMana') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.mana).toEqual({ G: 3 });
  });

  it('parses standalone "that player adds {G}{G}{G}." as Spell', () => {
    const parsed = parseOracleText('That player adds {G}{G}{G}.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('AddMana');
    if (eff.kind !== 'AddMana') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.mana).toEqual({ G: 3 });
  });

  it('parses "that player adds {W}{U}." (mixed colors)', () => {
    const parsed = parseOracleText('That player adds {W}{U}.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('AddMana');
    if (eff.kind !== 'AddMana') return;
    expect(eff.mana).toEqual({ W: 1, U: 1 });
  });

  it('executes: EventPlayer (p2) gets {G}{G}{G} added to their mana pool', () => {
    const state = baseState();

    const effects: Effect[] = [{
      kind: 'AddMana',
      player: { kind: 'EventPlayer' },
      mana: { G: 3 },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    const mana = getPlayerMana(result, 'p2');
    expect(mana?.G).toBe(3);
    // p1's pool unchanged
    expect(getPlayerMana(result, 'p1')?.G).toBe(0);
  });

  it('executes: caster (p1) gets mana when casterId matches eventPlayerId', () => {
    const state = baseState();

    const effects: Effect[] = [{
      kind: 'AddMana',
      player: { kind: 'EventPlayer' },
      mana: { G: 2 },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p1' },
    });

    expect(getPlayerMana(result, 'p1')?.G).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. matchEachPlayerLosesHalfLife (Havoc Festival)
// ---------------------------------------------------------------------------

describe('Slice 11 — matchEachPlayerLosesHalfLife (Havoc Festival)', () => {
  it('parses "each player loses half their life, rounded up." as Spell', () => {
    const parsed = parseOracleText('Each player loses half their life, rounded up.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('LoseLife');
    if (eff.kind !== 'LoseLife') return;
    expect(eff.player).toEqual({ kind: 'EachPlayer' });
    expect(eff.amount).toEqual({ kind: 'HalfLifeRoundedUp' });
  });

  it('parses "each player loses half their life rounded up." (no comma)', () => {
    const parsed = parseOracleText('Each player loses half their life rounded up.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('LoseLife');
    if (eff.kind !== 'LoseLife') return;
    expect(eff.amount).toEqual({ kind: 'HalfLifeRoundedUp' });
  });

  it('parses "At the beginning of each player\'s upkeep, that player loses half their life, rounded up." as Triggered', () => {
    // Havoc Festival's actual trigger body: "that player loses half their life, rounded up."
    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, that player loses half their life, rounded up.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'each' });
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('LoseLife');
    if (eff.kind !== 'LoseLife') return;
    // "that player" form maps to EventPlayer
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.amount).toEqual({ kind: 'HalfLifeRoundedUp' });
  });

  it('executes: EventPlayer (p2 at 30 life) loses half (15) via that-player form', () => {
    let state = baseState();
    state = setPlayerLife(state, 'p1', 40);
    state = setPlayerLife(state, 'p2', 30);

    const effects: Effect[] = [{
      kind: 'LoseLife',
      player: { kind: 'EventPlayer' },
      amount: { kind: 'HalfLifeRoundedUp' },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    const p2 = result.players.find(p => p.id === 'p2');
    // ceil(30/2)=15 → 30-15=15
    expect(p2?.life).toBe(15);
    // p1 unaffected
    expect(result.players.find(p => p.id === 'p1')?.life).toBe(40);
  });

  it('executes: p1 at 40 life loses 20; p2 at 30 life loses 15', () => {
    let state = baseState();
    state = setPlayerLife(state, 'p1', 40);
    state = setPlayerLife(state, 'p2', 30);

    const effects: Effect[] = [{
      kind: 'LoseLife',
      player: { kind: 'EachPlayer' },
      amount: { kind: 'HalfLifeRoundedUp' },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {});

    const p1 = result.players.find(p => p.id === 'p1');
    const p2 = result.players.find(p => p.id === 'p2');
    // 40/2 = 20 → 40 - 20 = 20
    expect(p1?.life).toBe(20);
    // 30/2 = 15 → 30 - 15 = 15
    expect(p2?.life).toBe(15);
  });

  it('executes: rounds up for odd life totals (p1=7 loses 4, p2=11 loses 6)', () => {
    let state = baseState();
    state = setPlayerLife(state, 'p1', 7);
    state = setPlayerLife(state, 'p2', 11);

    const effects: Effect[] = [{
      kind: 'LoseLife',
      player: { kind: 'EachPlayer' },
      amount: { kind: 'HalfLifeRoundedUp' },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {});

    const p1 = result.players.find(p => p.id === 'p1');
    const p2 = result.players.find(p => p.id === 'p2');
    // ceil(7/2)=4 → 7-4=3
    expect(p1?.life).toBe(3);
    // ceil(11/2)=6 → 11-6=5
    expect(p2?.life).toBe(5);
  });

  it('executes: even life totals (p1=20 loses 10)', () => {
    let state = baseState();
    state = setPlayerLife(state, 'p1', 20);
    state = setPlayerLife(state, 'p2', 20);

    const effects: Effect[] = [{
      kind: 'LoseLife',
      player: { kind: 'EachPlayer' },
      amount: { kind: 'HalfLifeRoundedUp' },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {});

    expect(result.players.find(p => p.id === 'p1')?.life).toBe(10);
    expect(result.players.find(p => p.id === 'p2')?.life).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// 4. Integration: actual card oracle text parsing
// ---------------------------------------------------------------------------

describe('Slice 11 — Integration: full oracle text parsing', () => {
  it('Shizuko, Caller of Autumn trigger parses successfully', () => {
    // Real Shizuko text (simplified — the mana-persistence rider is after the mana symbol)
    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, that player adds {G}{G}{G}.",
    );
    expect(parsed.kind).toBe('Triggered');
    expect(parsed.kind).not.toBe('Unparsed');
  });

  it('Risky Move trigger parses successfully', () => {
    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, that player gains control of this enchantment.",
    );
    expect(parsed.kind).toBe('Triggered');
    expect(parsed.kind).not.toBe('Unparsed');
  });

  it('"each player loses half their life, rounded up." parses as LoseLife, not Unparsed', () => {
    const parsed = parseOracleText('Each player loses half their life, rounded up.');
    expect(parsed.kind).not.toBe('Unparsed');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects[0].kind).toBe('LoseLife');
  });
});
