/**
 * punisher-that-player: self-source punisher damage to the event player.
 *
 * Family: "…, this enchantment/artifact/creature deals N damage to that player."
 *   - "At the beginning of each player's upkeep, ~ deals 1 damage to that player." (Copper Tablet)
 *   - "Whenever a player casts a spell, ~ deals 1 damage to that player." (Manabarbs)
 *   - "Whenever an opponent casts a spell with mana value 3 or less, …" (Scalding Viper)
 *   - "At the beginning of each opponent's upkeep, …" (Lavaborn Muse base form)
 *   - "At the beginning of your upkeep, this creature deals 1 damage to you." (Juzám Djinn)
 *   - "Whenever a player taps a land for mana, …" (Manabarbs/Scald subfamily)
 *
 * Verifies BOTH that the parser produces the new trigger heads / EventPlayer
 * target AND that the engine pipeline executes them: event -> pending trigger
 * (with eventContext.eventPlayerId) -> stack -> resolution -> damage to the
 * right player.
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState } from '../game-state';
import {
  castSpell,
  resolveTopOfStack,
  putTriggersOnStack,
  checkTriggersForEvent,
  registerBattlefieldAbilities,
} from '../stack';
import { tapLandForMana } from '../actions';
import { addMana } from '../mana';
import type { CardDefinition, GameState, CardInstance } from '../types';

function makePermanent(
  id: string,
  name: string,
  oracleText: string,
  typeLine: 'Enchantment' | 'Artifact' | 'Creature - Test',
): CardDefinition {
  const isCreature = typeLine.startsWith('Creature');
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: oracleText,
    mana_cost: '{2}{R}',
    cmc: 3,
    colors: ['R'],
    color_identity: ['R'],
    keywords: [],
    card_types: [isCreature ? 'creature' : typeLine.toLowerCase()],
    ...(isCreature ? { power: 3, toughness: 3 } : {}),
  };
}

function makeInstant(id: string, name: string, cmc: number): CardDefinition {
  return {
    id,
    name,
    type_line: 'Instant',
    oracle_text: 'Draw a card.',
    mana_cost: `{${cmc}}`,
    cmc,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    card_types: ['instant'],
  };
}

function makeLand(id: string, name: string, typeLine = 'Basic Land - Island'): CardDefinition {
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: '{T}: Add {U}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['U'],
    keywords: [],
    card_types: ['land'],
  };
}

function createTestGame(p1Cards: CardDefinition[], p2Cards: CardDefinition[]): GameState {
  return initGameState([
    { playerId: 'p1', name: 'Player 1', cards: p1Cards, commanderId: 'nonexistent-cmd-1' },
    { playerId: 'p2', name: 'Player 2', cards: p2Cards, commanderId: 'nonexistent-cmd-2' },
  ]);
}

function moveToZone(state: GameState, instanceId: string, zone: 'battlefield' | 'hand'): GameState {
  const card = state.cards.get(instanceId);
  if (!card) throw new Error(`Card not found: ${instanceId}`);
  const newCards = new Map(state.cards);
  newCards.set(instanceId, { ...card, zone, summoningSick: false });
  return { ...state, cards: newCards };
}

function findCard(state: GameState, defId: string): CardInstance | undefined {
  for (const card of state.cards.values()) {
    if (card.definitionId === defId) return card;
  }
  return undefined;
}

function life(state: GameState, playerId: string): number {
  return state.players.find(p => p.id === playerId)!.life;
}

function giveMana(state: GameState, playerId: string, amount: number): GameState {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const player = state.players[playerIndex];
  const newPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, manaPool: addMana(player.manaPool, 'U', amount) } : p
  );
  return { ...state, players: newPlayers };
}

/** Register a punisher permanent on p1's battlefield, return the prepared state. */
function setupPunisher(oracle: string, typeLine: 'Enchantment' | 'Artifact' | 'Creature - Test', extraP2?: CardDefinition[]): GameState {
  const def = makePermanent('punisher', 'Punisher Card', oracle, typeLine);
  let state = createTestGame([def, makeLand('l1', 'Island')], extraP2 ?? [makeLand('l2', 'Island')]);
  const inst = findCard(state, 'punisher')!;
  state = moveToZone(state, inst.instanceId, 'battlefield');
  state = registerBattlefieldAbilities(state, inst.instanceId);
  return state;
}

// ---------------------------------------------------------------------------
// PARSING
// ---------------------------------------------------------------------------

describe('punisher-that-player parsing', () => {
  it('parses Copper Tablet: each player\'s upkeep + self-source damage to that player', () => {
    const r = parseOracleText("At the beginning of each player's upkeep, this artifact deals 1 damage to that player.");
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'each' });
    expect(r.ability.effects[0]).toMatchObject({
      kind: 'DealDamage',
      source: { kind: 'ThisPermanent' },
      target: { kind: 'EventPlayer' },
      amount: 1,
    });
  });

  it('parses Manabarbs: any player casts a spell + damage to that player', () => {
    const r = parseOracleText('Whenever a player casts a spell, this enchantment deals 1 damage to that player.');
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger).toEqual({ kind: 'AnyPlayerCastSpell' });
    expect(r.ability.effects[0]).toMatchObject({
      kind: 'DealDamage',
      target: { kind: 'EventPlayer' },
      amount: 1,
    });
  });

  it('parses Scalding Viper: opponent cast with mana value cap', () => {
    const r = parseOracleText('Whenever an opponent casts a spell with mana value 3 or less, this creature deals 1 damage to that player.');
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger).toEqual({ kind: 'OpponentCastSpell', maxManaValue: 3 });
    expect(r.ability.effects[0]).toMatchObject({
      kind: 'DealDamage',
      target: { kind: 'EventPlayer' },
      amount: 1,
    });
  });

  it('parses Lavaborn Muse base form: each opponent\'s upkeep', () => {
    const r = parseOracleText("At the beginning of each opponent's upkeep, this creature deals 2 damage to that player.");
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'opponents' });
    expect(r.ability.effects[0]).toMatchObject({
      kind: 'DealDamage',
      target: { kind: 'EventPlayer' },
      amount: 2,
    });
  });

  it('parses Juzám Djinn: your upkeep + damage to you (Controller)', () => {
    const r = parseOracleText('At the beginning of your upkeep, this creature deals 1 damage to you.');
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'yours' });
    expect(r.ability.effects[0]).toMatchObject({
      kind: 'DealDamage',
      target: { kind: 'Controller' },
      amount: 1,
    });
  });

  it('parses the taps-land trigger heads (plain, subtype, nonbasic)', () => {
    const plain = parseOracleText('Whenever a player taps a land for mana, this enchantment deals 1 damage to that player.');
    expect(plain.kind).toBe('Triggered');
    if (plain.kind === 'Triggered') {
      expect(plain.ability.trigger).toEqual({ kind: 'PlayerTapsLandForMana' });
      expect(plain.ability.effects[0]).toMatchObject({ kind: 'DealDamage', target: { kind: 'EventPlayer' }, amount: 1 });
    }

    // Scald wording (self-name becomes ~ during registration; here the literal form).
    const island = parseOracleText('Whenever a player taps an Island for mana, ~ deals 1 damage to that player.');
    expect(island.kind).toBe('Triggered');
    if (island.kind === 'Triggered') {
      expect(island.ability.trigger).toEqual({ kind: 'PlayerTapsLandForMana', subtype: 'island' });
    }

    // Burning Earth wording.
    const nonbasic = parseOracleText('Whenever a player taps a nonbasic land for mana, ~ deals 1 damage to that player.');
    expect(nonbasic.kind).toBe('Triggered');
    if (nonbasic.kind === 'Triggered') {
      expect(nonbasic.ability.trigger).toEqual({ kind: 'PlayerTapsLandForMana', nonbasic: true });
    }
  });

  it('accepts the remaining self-reference subjects (this Aura / this land)', () => {
    const aura = parseOracleText('Whenever a player casts a spell, this Aura deals 1 damage to that player.');
    expect(aura.kind).toBe('Triggered');
    if (aura.kind === 'Triggered') {
      expect(aura.ability.effects[0]).toMatchObject({
        kind: 'DealDamage',
        source: { kind: 'ThisPermanent' },
        target: { kind: 'EventPlayer' },
      });
    }

    const land = parseOracleText("At the beginning of each player's upkeep, this land deals 1 damage to that player.");
    expect(land.kind).toBe('Triggered');
    if (land.kind === 'Triggered') {
      expect(land.ability.effects[0]).toMatchObject({
        kind: 'DealDamage',
        source: { kind: 'ThisPermanent' },
        target: { kind: 'EventPlayer' },
      });
    }
  });
});

// ---------------------------------------------------------------------------
// EXECUTION — the engine fires the trigger and damages the event player
// ---------------------------------------------------------------------------

describe('punisher-that-player execution', () => {
  it('Copper Tablet: damages whichever player\'s upkeep begins', () => {
    let state = setupPunisher(
      "At the beginning of each player's upkeep, this artifact deals 1 damage to that player.",
      'Artifact',
    );

    // p2's upkeep -> p2 takes 1.
    const p2Before = life(state, 'p2');
    state = { ...state, phase: 'beginning', step: 'upkeep', activePlayerIndex: 1, priorityPlayerIndex: 1 };
    state = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'p2' });
    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0].eventContext?.eventPlayerId).toBe('p2');
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    expect(life(state, 'p2')).toBe(p2Before - 1);

    // p1's own upkeep -> the controller takes 1 too ("each player's").
    const p1Before = life(state, 'p1');
    state = { ...state, phase: 'beginning', step: 'upkeep', activePlayerIndex: 0, priorityPlayerIndex: 0 };
    state = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'p1' });
    expect(state.pendingTriggers).toHaveLength(1);
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    expect(life(state, 'p1')).toBe(p1Before - 1);
  });

  it('Manabarbs: a real castSpell by the opponent damages the caster', () => {
    const spell = makeInstant('cheap-instant', 'Cheap Instant', 1);
    let state = setupPunisher(
      'Whenever a player casts a spell, this enchantment deals 1 damage to that player.',
      'Enchantment',
      [spell, makeLand('l2', 'Island')],
    );

    const spellInst = findCard(state, 'cheap-instant')!;
    state = moveToZone(state, spellInst.instanceId, 'hand');
    state = giveMana(state, 'p2', 3);
    state = { ...state, phase: 'precombat_main', step: 'upkeep' };

    const p2Before = life(state, 'p2');
    state = castSpell(state, 'p2', spellInst.instanceId);

    // The cast event queued the punisher trigger with the caster as event player.
    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0].ability.trigger.kind).toBe('AnyPlayerCastSpell');
    expect(state.pendingTriggers[0].eventContext?.eventPlayerId).toBe('p2');

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state); // trigger resolves above the spell
    expect(life(state, 'p2')).toBe(p2Before - 1);
  });

  it('Manabarbs also punishes its own controller\'s casts', () => {
    let state = setupPunisher(
      'Whenever a player casts a spell, this enchantment deals 1 damage to that player.',
      'Enchantment',
    );
    const spell = makeInstant('own-instant', 'Own Instant', 1);
    const defs = new Map(state.cardDefinitions);
    defs.set(spell.id, spell);
    const cards = new Map(state.cards);
    cards.set('own-spell-inst', {
      instanceId: 'own-spell-inst', definitionId: spell.id, ownerId: 'p1', zone: 'hand',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    });
    state = { ...state, cardDefinitions: defs, cards };

    state = checkTriggersForEvent(state, { kind: 'SpellCast', casterId: 'p1', cardInstanceId: 'own-spell-inst' });
    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0].eventContext?.eventPlayerId).toBe('p1');

    const p1Before = life(state, 'p1');
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    expect(life(state, 'p1')).toBe(p1Before - 1);
  });

  it('Scalding Viper: mana value cap and opponent-only restriction are honored', () => {
    let state = setupPunisher(
      'Whenever an opponent casts a spell with mana value 3 or less, this creature deals 1 damage to that player.',
      'Creature - Test',
    );
    const cheap = makeInstant('mv1', 'Cheap', 1);
    const pricey = makeInstant('mv4', 'Pricey', 4);
    const defs = new Map(state.cardDefinitions);
    defs.set(cheap.id, cheap);
    defs.set(pricey.id, pricey);
    const cards = new Map(state.cards);
    const mkInst = (instanceId: string, definitionId: string, ownerId: string): CardInstance => ({
      instanceId, definitionId, ownerId, zone: 'hand',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    });
    cards.set('mv1-inst', mkInst('mv1-inst', cheap.id, 'p2'));
    cards.set('mv4-inst', mkInst('mv4-inst', pricey.id, 'p2'));
    cards.set('mv1-own', mkInst('mv1-own', cheap.id, 'p1'));
    state = { ...state, cardDefinitions: defs, cards };

    // Opponent casts mana value 4 -> no trigger.
    let next = checkTriggersForEvent(state, { kind: 'SpellCast', casterId: 'p2', cardInstanceId: 'mv4-inst' });
    expect(next.pendingTriggers).toHaveLength(0);

    // Controller casts mana value 1 -> no trigger (opponents only).
    next = checkTriggersForEvent(state, { kind: 'SpellCast', casterId: 'p1', cardInstanceId: 'mv1-own' });
    expect(next.pendingTriggers).toHaveLength(0);

    // Opponent casts mana value 1 -> fires and damages the caster.
    next = checkTriggersForEvent(state, { kind: 'SpellCast', casterId: 'p2', cardInstanceId: 'mv1-inst' });
    expect(next.pendingTriggers).toHaveLength(1);
    const p2Before = life(next, 'p2');
    next = putTriggersOnStack(next);
    next = resolveTopOfStack(next);
    expect(life(next, 'p2')).toBe(p2Before - 1);
  });

  it('Lavaborn Muse base form: fires only on opponents\' upkeeps', () => {
    let state = setupPunisher(
      "At the beginning of each opponent's upkeep, this creature deals 2 damage to that player.",
      'Creature - Test',
    );

    // Controller's own upkeep -> no trigger.
    let next = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'p1' });
    expect(next.pendingTriggers).toHaveLength(0);

    // Opponent's upkeep -> 2 damage to that opponent.
    state = { ...state, phase: 'beginning', step: 'upkeep', activePlayerIndex: 1, priorityPlayerIndex: 1 };
    state = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'p2' });
    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0].eventContext?.eventPlayerId).toBe('p2');
    const p2Before = life(state, 'p2');
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    expect(life(state, 'p2')).toBe(p2Before - 2);
  });

  it('Juzám Djinn: damages its own controller on their upkeep', () => {
    let state = setupPunisher(
      'At the beginning of your upkeep, this creature deals 1 damage to you.',
      'Creature - Test',
    );

    // Opponent's upkeep -> nothing.
    const onOppUpkeep = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'p2' });
    expect(onOppUpkeep.pendingTriggers).toHaveLength(0);

    // Controller's upkeep -> controller takes 1.
    const p1Before = life(state, 'p1');
    state = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'p1' });
    expect(state.pendingTriggers).toHaveLength(1);
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    expect(life(state, 'p1')).toBe(p1Before - 1);
  });

  it('taps-land punisher: real tapLandForMana damages the tapping player', () => {
    let state = setupPunisher(
      'Whenever a player taps a land for mana, this enchantment deals 1 damage to that player.',
      'Enchantment',
    );

    // Put p2's Island onto the battlefield and tap it for mana.
    const island = findCard(state, 'l2')!;
    state = moveToZone(state, island.instanceId, 'battlefield');
    const p2Before = life(state, 'p2');
    state = tapLandForMana(state, 'p2', island.instanceId, 'U');

    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0].ability.trigger.kind).toBe('PlayerTapsLandForMana');
    expect(state.pendingTriggers[0].eventContext?.eventPlayerId).toBe('p2');
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    expect(life(state, 'p2')).toBe(p2Before - 1);
  });

  it('taps-land punisher: ignores taps that are not for mana', () => {
    let state = setupPunisher(
      'Whenever a player taps a land for mana, this enchantment deals 1 damage to that player.',
      'Enchantment',
    );
    const island = findCard(state, 'l2')!;
    state = moveToZone(state, island.instanceId, 'battlefield');

    // A PermanentTapped event WITHOUT the forMana flag (cost payment, attacking
    // tap, ...) must not fire the punisher.
    const next = checkTriggersForEvent(state, {
      kind: 'PermanentTapped',
      instanceId: island.instanceId,
      controllerId: 'p2',
    });
    expect(next.pendingTriggers).toHaveLength(0);
  });
});
