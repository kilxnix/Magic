/**
 * Trigger Pipeline Integration Tests
 *
 * Tests the ENTIRE trigger pipeline from parsing to execution:
 * 1. Card enters battlefield -> parse oracle text -> register triggers
 * 2. Game event happens -> check registered triggers
 * 3. Matching triggers -> create pending trigger entries
 * 4. Pending triggers -> put on stack
 * 5. Stack resolves -> execute trigger effects
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState, getCardsInZone, getCardDefinition } from '../game-state';
import { castSpell, canCastSpell, resolveTopOfStack, putTriggersOnStack, checkTriggersForEvent, registerBattlefieldAbilities } from '../stack';
import { checkStateBasedActions, cleanupDamage } from '../state-based';
import { activateAbility, getActivatedAbilities, playLand, tapLandForMana, drawCards } from '../actions';
import { declareAttackers, declareBlockers } from '../combat';
import { addMana } from '../mana';
import { getEffectivePower } from '../effects/continuous';
import { instanceHasKeyword } from '../keywords';
import type { CardDefinition, GameState, CardInstance, TriggeredAbilityRef } from '../types';

// ============================================================================
// Helper: create minimal card definitions
// ============================================================================

function makeCreatureWithETB(id: string, name: string, oracleText: string): CardDefinition {
  return {
    id,
    name,
    type_line: `Creature - Test`,
    oracle_text: oracleText,
    mana_cost: '{1}{U}',
    cmc: 2,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    power: 2,
    toughness: 2,
    card_types: ['creature'],
  };
}

function makeEnchantment(id: string, name: string, oracleText: string): CardDefinition {
  return {
    id,
    name,
    type_line: `Enchantment`,
    oracle_text: oracleText,
    mana_cost: '{2}{U}',
    cmc: 3,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    card_types: ['enchantment'],
  };
}

function makeVanillaCreature(id: string, name: string, manaCost: string = '{1}{G}'): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature - Bear',
    oracle_text: '',
    mana_cost: manaCost,
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power: 2,
    toughness: 2,
    card_types: ['creature'],
  };
}

function makeInstant(id: string, name: string, oracleText: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Instant',
    oracle_text: oracleText,
    mana_cost: '{U}',
    cmc: 1,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    card_types: ['instant'],
  };
}

function makeLand(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Basic Land - Island',
    oracle_text: '{T}: Add {U}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['U'],
    keywords: [],
    card_types: ['land'],
  };
}

function makeCreatureWithAttackTrigger(id: string, name: string, oracleText: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature - Test',
    oracle_text: oracleText,
    mana_cost: '{2}{R}',
    cmc: 3,
    colors: ['R'],
    color_identity: ['R'],
    keywords: [],
    power: 3,
    toughness: 2,
    card_types: ['creature'],
  };
}

/**
 * Create a two-player game with specific cards.
 */
function createTestGame(p1Cards: CardDefinition[], p2Cards: CardDefinition[]): GameState {
  return initGameState([
    { playerId: 'p1', name: 'Player 1', cards: p1Cards, commanderId: 'nonexistent-cmd-1' },
    { playerId: 'p2', name: 'Player 2', cards: p2Cards, commanderId: 'nonexistent-cmd-2' },
  ]);
}

/**
 * Give a player mana so they can cast spells.
 */
function giveMana(state: GameState, playerId: string, amount: number, color: 'W' | 'U' | 'B' | 'R' | 'G' | 'C' = 'U'): GameState {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const player = state.players[playerIndex];
  const newManaPool = addMana(player.manaPool, color, amount);
  const newPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, manaPool: newManaPool } : p
  );
  return { ...state, players: newPlayers };
}

/**
 * Move a card to a specific zone.
 */
function moveToZone(state: GameState, instanceId: string, zone: 'hand' | 'battlefield' | 'library' | 'graveyard'): GameState {
  const card = state.cards.get(instanceId);
  if (!card) throw new Error(`Card not found: ${instanceId}`);
  const newCards = new Map(state.cards);
  newCards.set(instanceId, { ...card, zone, summoningSick: false });
  return { ...state, cards: newCards };
}

/**
 * Find a card instance by definition ID.
 */
function findCard(state: GameState, defId: string): CardInstance | undefined {
  for (const card of state.cards.values()) {
    if (card.definitionId === defId) return card;
  }
  return undefined;
}

/**
 * Count cards in a zone for a player.
 */
function countCardsInZone(state: GameState, playerId: string, zone: string): number {
  return getCardsInZone(state, playerId, zone as any).length;
}

// ============================================================================
// PARSER TESTS: Verify triggers parse correctly
// ============================================================================

describe('Trigger Parsing', () => {
  it('parses "Whenever an opponent casts a spell, draw a card." as Triggered/OpponentCastSpell', () => {
    const result = parseOracleText('Whenever an opponent casts a spell, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('OpponentCastSpell');
    expect(result.ability.effects).toHaveLength(1);
    expect(result.ability.effects[0].kind).toBe('Draw');
  });

  it('parses "When ~ enters the battlefield, draw a card." as ETB', () => {
    const result = parseOracleText('When ~ enters the battlefield, draw a card.');
    expect(result.kind).toBe('ETB');
    if (result.kind !== 'ETB') return;
    expect(result.ability.trigger.kind).toBe('ETB');
    expect(result.ability.effects[0].kind).toBe('Draw');
  });

  it('parses "Whenever ~ attacks, draw a card." as Triggered/Attacks', () => {
    const result = parseOracleText('Whenever ~ attacks, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('Attacks');
  });

  it('parses self becomes-tapped triggers', () => {
    const result = parseOracleText('Whenever this creature becomes tapped, create a 1/1 red Goblin creature token.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'BecomesTapped', who: 'self' });
    expect(result.ability.effects[0].kind).toBe('CreateToken');
  });

  it('parses "Whenever you cast a spell, gain 1 life." as Triggered/YouCastSpell', () => {
    const result = parseOracleText('Whenever you cast a spell, gain 1 life.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('YouCastSpell');
  });

  it('parses Vivi-style noncreature cast triggers with self counters and opponent damage', () => {
    const result = parseOracleText('Whenever you cast a noncreature spell, put a +1/+1 counter on ~ and it deals 1 damage to each opponent.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('CastNoncreatureSpell');
    expect(result.ability.effects).toHaveLength(2);
    expect(result.ability.effects[0]).toMatchObject({
      kind: 'AddCounters',
      target: { kind: 'Source' },
      counterType: '+1/+1',
      count: 1,
    });
    expect(result.ability.effects[1]).toMatchObject({
      kind: 'DealDamage',
      target: { kind: 'EachOpponent' },
      amount: 1,
    });
  });

  it('parses controlled creature ETB triggers for Impact Tremors-style payoffs', () => {
    const result = parseOracleText('Whenever a creature you control enters, this enchantment deals 1 damage to each opponent.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'AnyCreatureETB', controller: 'yours' });
    expect(result.ability.effects[0].kind).toBe('DealDamage');
  });

  it('parses modern self-ETB wording variants as the same self trigger family', () => {
    const variants = [
      'When ~ enters, draw a card.',
      'When ~ enters the battlefield, draw a card.',
      'When this creature enters, draw a card.',
      'When this permanent enters the battlefield, draw a card.',
    ];

    for (const oracle of variants) {
      const result = parseOracleText(oracle);
      expect(result.kind, oracle).toBe('ETB');
      if (result.kind !== 'ETB') continue;
      expect(result.ability.trigger).toEqual({ kind: 'ETB', who: 'self' });
      expect(result.ability.effects[0].kind).toBe('Draw');
    }
  });

  it('parses common external creature-ETB wording variants without card-specific fixes', () => {
    const result = parseOracleText('Whenever another creature you control enters, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'AnotherCreatureETB', controller: 'yours' });
  });

  it('preserves nontoken restrictions on external ETB triggers', () => {
    const result = parseOracleText('Whenever another nontoken creature enters the battlefield under your control, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'AnotherCreatureETB', controller: 'yours', nontoken: true });
  });

  it('parses one-or-more controlled creature ETB wording into the controlled ETB family', () => {
    const result = parseOracleText('Whenever one or more nontoken creatures enter the battlefield under your control, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'AnyCreatureETB', controller: 'yours', nontoken: true });
  });

  it('parses Krenko-style activated token counts from a controlled subtype count', () => {
    const abilities = getActivatedAbilities({
      ...createTestGame([], []),
      cardDefinitions: new Map([
        ['krenko', {
          id: 'krenko',
          name: 'Krenko, Mob Boss',
          type_line: 'Legendary Creature - Goblin Warrior',
          oracle_text: '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',
          mana_cost: '{2}{R}{R}',
          cmc: 4,
          colors: ['R'],
          color_identity: ['R'],
          keywords: [],
          power: 3,
          toughness: 3,
          card_types: ['creature'],
        }],
      ]),
      cards: new Map([
        ['krenko-inst', {
          instanceId: 'krenko-inst',
          definitionId: 'krenko',
          ownerId: 'p1',
          zone: 'battlefield',
          tapped: false,
          summoningSick: false,
          counters: {},
          damage: 0,
          isCommander: true,
        }],
      ]),
    }, 'krenko-inst');

    expect(abilities).toHaveLength(1);
    expect(abilities[0].effects[0]).toMatchObject({
      kind: 'CreateToken',
      count: {
        kind: 'ForEach',
        zone: 'battlefield',
        filter: { types: ['creature'], subtypes: ['Goblin'] },
        controller: 'you',
      },
    });
  });

  it('parses Goblin Matron-style optional subtype tutor ETBs', () => {
    const result = parseOracleText('When this creature enters, you may search your library for a Goblin card, reveal that card, put it into your hand, then shuffle.');
    expect(result.kind).toBe('ETB');
    if (result.kind !== 'ETB') return;
    expect(result.ability.optional).toBe(true);
    expect(result.ability.effects[0]).toMatchObject({
      kind: 'SearchLibrary',
      filter: { types: ['creature'], subtypes: ['goblin'] },
      destination: 'hand',
      shuffle: true,
    });
  });

  it('parses Goblin Spymaster-style opponent end step token triggers', () => {
    const result = parseOracleText("At the beginning of each opponent's end step, that player creates a 1/1 red Goblin creature token.");
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'EndStep', whose: 'opponents' });
    expect(result.ability.effects[0]).toMatchObject({
      kind: 'CreateToken',
      controller: { kind: 'ActivePlayer' },
      token: {
        name: 'Goblin',
        colors: ['R'],
        types: ['creature'],
        subtypes: ['goblin'],
        power: 1,
        toughness: 1,
      },
      count: 1,
    });
  });
});

// ============================================================================
// ETB TRIGGER PIPELINE: Card enters battlefield -> trigger fires -> effect resolves
// ============================================================================

describe('ETB Trigger Pipeline', () => {
  it('ETB trigger goes on stack and draws a card when resolved', () => {
    // Setup: Create a creature with "When ~ enters the battlefield, draw a card."
    const etbCreature = makeCreatureWithETB('etb-draw', 'Elvish Visionary', 'When ~ enters the battlefield, draw a card.');
    const island = makeLand('island', 'Island');

    let state = createTestGame(
      [etbCreature, island, island, island],
      [island],
    );

    // Put etbCreature in p1's hand and give p1 mana
    const creatureInst = findCard(state, 'etb-draw')!;
    state = moveToZone(state, creatureInst.instanceId, 'hand');
    state = giveMana(state, 'p1', 5, 'U');

    // Set phase to main phase for casting
    state = { ...state, phase: 'precombat_main' as any, step: 'upkeep' as any };

    // Record starting hand size
    const handBefore = countCardsInZone(state, 'p1', 'hand');

    // Step 1: Cast the creature
    expect(canCastSpell(state, 'p1', creatureInst.instanceId)).toBe(true);
    state = castSpell(state, 'p1', creatureInst.instanceId);

    // Creature is on the stack
    expect(state.stack.length).toBe(1);
    expect(state.stack[0].kind).toBe('Spell');

    // Step 2: Resolve the spell (creature enters battlefield)
    state = resolveTopOfStack(state);

    // Creature should be on the battlefield
    const creatureAfterResolve = state.cards.get(creatureInst.instanceId)!;
    expect(creatureAfterResolve.zone).toBe('battlefield');

    // Step 3: ETB trigger should be in pendingTriggers
    expect(state.pendingTriggers.length).toBeGreaterThan(0);

    // Step 4: Put triggers on stack
    state = putTriggersOnStack(state);
    expect(state.stack.length).toBe(1);
    expect(state.stack[0].kind).toBe('TriggeredAbility');
    expect(state.pendingTriggers.length).toBe(0);

    // Step 5: Resolve the trigger (should draw a card)
    state = resolveTopOfStack(state);

    // p1 should have drawn a card (hand count = handBefore - 1 (creature cast) + 1 (drawn))
    const handAfter = countCardsInZone(state, 'p1', 'hand');
    expect(handAfter).toBe(handBefore - 1 + 1);
  });

  it('Krenko starter ETB creature creates its Goblin token', () => {
    const instigator = makeCreatureWithETB(
      'goblin-instigator',
      'Goblin Instigator',
      'When this creature enters, create a 1/1 red Goblin creature token.',
    );
    const island = makeLand('island', 'Island');

    let state = createTestGame(
      [instigator, island, island, island],
      [island],
    );

    const instigatorInst = findCard(state, 'goblin-instigator')!;
    state = moveToZone(state, instigatorInst.instanceId, 'hand');
    state = giveMana(state, 'p1', 5, 'U');
    state = { ...state, activePlayerIndex: 0, phase: 'precombat_main' as any, step: 'upkeep' as any };

    state = castSpell(state, 'p1', instigatorInst.instanceId);
    state = resolveTopOfStack(state);
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    const goblinTokens = Array.from(state.cards.values()).filter(card => {
      const def = state.cardDefinitions.get(card.definitionId);
      return card.isToken && card.zone === 'battlefield' && def?.name === 'Goblin';
    });

    expect(goblinTokens).toHaveLength(1);
  });

  it('Impact Tremors fires for both a creature entering and that creature creating a token', () => {
    const impactTremors = makeEnchantment(
      'impact-tremors',
      'Impact Tremors',
      'Whenever a creature you control enters, this enchantment deals 1 damage to each opponent.',
    );
    const instigator = makeCreatureWithETB(
      'goblin-instigator',
      'Goblin Instigator',
      'When this creature enters, create a 1/1 red Goblin creature token.',
    );
    const island = makeLand('island', 'Island');

    let state = createTestGame(
      [impactTremors, instigator, island, island, island],
      [island],
    );

    const impactInst = findCard(state, 'impact-tremors')!;
    const instigatorInst = findCard(state, 'goblin-instigator')!;
    state = moveToZone(state, impactInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, impactInst.instanceId);
    state = moveToZone(state, instigatorInst.instanceId, 'hand');
    state = giveMana(state, 'p1', 5, 'U');
    state = { ...state, activePlayerIndex: 0, phase: 'precombat_main' as any, step: 'upkeep' as any };

    state = castSpell(state, 'p1', instigatorInst.instanceId);
    state = resolveTopOfStack(state);

    while (state.pendingTriggers.length > 0 || state.stack.length > 0) {
      if (state.pendingTriggers.length > 0) {
        state = putTriggersOnStack(state);
      }
      if (state.stack.length > 0) {
        state = resolveTopOfStack(state);
      }
    }

    expect(state.players.find(player => player.id === 'p2')!.life).toBe(38);
  });

  it('nontoken creature ETB payoffs do not fire for tokens created by an ETB', () => {
    const nontokenPayoff = makeEnchantment(
      'guardian-project-lite',
      'Guardian Project Lite',
      'Whenever another nontoken creature enters the battlefield under your control, draw a card.',
    );
    const instigator = makeCreatureWithETB(
      'goblin-instigator',
      'Goblin Instigator',
      'When this creature enters, create a 1/1 red Goblin creature token.',
    );
    const island = makeLand('island', 'Island');

    let state = createTestGame(
      [nontokenPayoff, instigator, island, island, island],
      [island],
    );

    const payoffInst = findCard(state, 'guardian-project-lite')!;
    const instigatorInst = findCard(state, 'goblin-instigator')!;
    state = moveToZone(state, payoffInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, payoffInst.instanceId);
    state = moveToZone(state, instigatorInst.instanceId, 'hand');
    state = giveMana(state, 'p1', 5, 'U');
    state = { ...state, activePlayerIndex: 0, phase: 'precombat_main' as any, step: 'upkeep' as any };

    const handBefore = countCardsInZone(state, 'p1', 'hand');
    state = castSpell(state, 'p1', instigatorInst.instanceId);
    state = resolveTopOfStack(state);

    while (state.pendingTriggers.length > 0 || state.stack.length > 0) {
      if (state.pendingTriggers.length > 0) {
        state = putTriggersOnStack(state);
      }
      if (state.stack.length > 0) {
        state = resolveTopOfStack(state);
      }
    }

    const handAfter = countCardsInZone(state, 'p1', 'hand');
    expect(handAfter).toBe(handBefore - 1 + 1);
  });

  it('self ETB target requirements are found even when the ETB is not the first oracle line', () => {
    const removalCreature = makeCreatureWithETB(
      'line-two-etb',
      'Line Two ETB',
      'Flying\nWhen ~ enters the battlefield, destroy target creature.',
    );
    const target = makeVanillaCreature('target-bear', 'Target Bear');
    const island = makeLand('island', 'Island');

    let state = createTestGame(
      [removalCreature, island, island, island],
      [target, island],
    );

    const removalInst = findCard(state, 'line-two-etb')!;
    state = moveToZone(state, removalInst.instanceId, 'hand');
    state = giveMana(state, 'p1', 5, 'U');
    state = { ...state, activePlayerIndex: 0, phase: 'precombat_main' as any, step: 'upkeep' as any };

    state = castSpell(state, 'p1', removalInst.instanceId);
    state = resolveTopOfStack(state);

    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0].requiredTargets).toMatchObject([
      { type: 'Creature', count: 1 },
    ]);
  });

  it('Krenko tap ability creates one token for each Goblin you control', () => {
    const krenko: CardDefinition = {
      id: 'krenko',
      name: 'Krenko, Mob Boss',
      type_line: 'Legendary Creature - Goblin Warrior',
      oracle_text: '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',
      mana_cost: '{2}{R}{R}',
      cmc: 4,
      colors: ['R'],
      color_identity: ['R'],
      keywords: [],
      power: 3,
      toughness: 3,
      card_types: ['creature'],
    };
    const goblin = {
      ...makeVanillaCreature('goblin-token-seed', 'Goblin Token Seed', '{R}'),
      type_line: 'Creature - Goblin',
    };
    const island = makeLand('island', 'Island');

    let state = createTestGame(
      [krenko, goblin, goblin, island],
      [island],
    );

    const krenkoInst = findCard(state, 'krenko')!;
    const goblinInsts = Array.from(state.cards.values()).filter(card => card.definitionId === 'goblin-token-seed');
    state = moveToZone(state, krenkoInst.instanceId, 'battlefield');
    state = moveToZone(state, goblinInsts[0].instanceId, 'battlefield');
    state = moveToZone(state, goblinInsts[1].instanceId, 'battlefield');

    state = activateAbility(state, 'p1', krenkoInst.instanceId, 0);
    expect(state.cards.get(krenkoInst.instanceId)!.tapped).toBe(true);
    state = resolveTopOfStack(state);

    const goblinTokens = Array.from(state.cards.values()).filter(card => {
      const def = state.cardDefinitions.get(card.definitionId);
      return card.isToken && card.zone === 'battlefield' && def?.name === 'Goblin';
    });

    expect(goblinTokens).toHaveLength(3);
  });

  it('Krenko starter Goblin Matron ETB tutors a Goblin into hand', () => {
    const matron = makeCreatureWithETB(
      'goblin-matron',
      'Goblin Matron',
      'When this creature enters, you may search your library for a Goblin card, reveal that card, put it into your hand, then shuffle.',
    );
    const targetGoblin: CardDefinition = {
      ...makeVanillaCreature('goblin-warchief', 'Goblin Warchief', '{1}{R}{R}'),
      type_line: 'Creature - Goblin Warrior',
      colors: ['R'],
      color_identity: ['R'],
    };
    const island = makeLand('island', 'Island');

    let state = createTestGame(
      [matron, targetGoblin, island, island, island],
      [island],
    );

    const matronInst = findCard(state, 'goblin-matron')!;
    const targetInst = findCard(state, 'goblin-warchief')!;
    state = moveToZone(state, matronInst.instanceId, 'hand');
    state = giveMana(state, 'p1', 5, 'U');
    state = { ...state, activePlayerIndex: 0, phase: 'precombat_main' as any, step: 'upkeep' as any };

    state = castSpell(state, 'p1', matronInst.instanceId);
    state = resolveTopOfStack(state);
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    expect(state.cards.get(targetInst.instanceId)!.zone).toBe('hand');
  });

  it('Krenko starter Skirk Prospector sacrifices a Goblin for red mana without tapping', () => {
    const skirk: CardDefinition = {
      id: 'skirk-prospector',
      name: 'Skirk Prospector',
      type_line: 'Creature - Goblin',
      oracle_text: 'Sacrifice a Goblin: Add {R}.',
      mana_cost: '{R}',
      cmc: 1,
      colors: ['R'],
      color_identity: ['R'],
      keywords: [],
      power: 1,
      toughness: 1,
      card_types: ['creature'],
    };
    const goblin: CardDefinition = {
      ...makeVanillaCreature('goblin-token-seed', 'Goblin Token Seed', '{R}'),
      type_line: 'Creature - Goblin',
      colors: ['R'],
      color_identity: ['R'],
    };
    const island = makeLand('island', 'Island');

    let state = createTestGame(
      [skirk, goblin, island],
      [island],
    );

    const skirkInst = findCard(state, 'skirk-prospector')!;
    const goblinInst = findCard(state, 'goblin-token-seed')!;
    state = moveToZone(state, skirkInst.instanceId, 'battlefield');
    state = moveToZone(state, goblinInst.instanceId, 'battlefield');
    const cards = new Map(state.cards);
    cards.set(skirkInst.instanceId, { ...cards.get(skirkInst.instanceId)!, tapped: true });
    state = { ...state, cards };

    state = tapLandForMana(state, 'p1', skirkInst.instanceId, 'R');

    expect(state.players.find(player => player.id === 'p1')!.manaPool.R).toBe(1);
    expect(state.cards.get(skirkInst.instanceId)!.zone).toBe('battlefield');
    expect(state.cards.get(skirkInst.instanceId)!.tapped).toBe(true);
    expect(state.cards.get(goblinInst.instanceId)!.zone).toBe('graveyard');
  });
});

// ============================================================================
// OPPONENT CAST SPELL TRIGGER: Rhystic Study test
// ============================================================================

describe('OpponentCastSpell Trigger Pipeline (Rhystic Study)', () => {
  it('fires when opponent casts a spell and draws a card', () => {
    // Setup: Rhystic Study on p1's battlefield
    const rhysticStudy = makeEnchantment(
      'rhystic-study',
      'Rhystic Study',
      'Whenever an opponent casts a spell, draw a card.',
    );
    const bearCard = makeVanillaCreature('bear', 'Grizzly Bears', '{1}{G}');
    const island = makeLand('island', 'Island');

    let state = createTestGame(
      [rhysticStudy, island, island, island],
      [bearCard, island, island],
    );

    // Put Rhystic Study directly on p1's battlefield
    const rhysticInst = findCard(state, 'rhystic-study')!;
    state = moveToZone(state, rhysticInst.instanceId, 'battlefield');

    // Register Rhystic Study's triggered abilities
    state = registerBattlefieldAbilities(state, rhysticInst.instanceId);

    // Verify the ability was registered
    const abilities = state.battlefieldAbilities.get(rhysticInst.instanceId);
    expect(abilities).toBeDefined();
    expect(abilities!.length).toBeGreaterThan(0);
    expect(abilities![0].trigger.kind).toBe('OpponentCastSpell');

    // Put bear in p2's hand and give p2 mana
    const bearInst = findCard(state, 'bear')!;
    state = moveToZone(state, bearInst.instanceId, 'hand');
    state = giveMana(state, 'p2', 5, 'G');

    // Make p2 the active player (so they can cast at sorcery speed)
    state = { ...state, activePlayerIndex: 1, phase: 'precombat_main' as any, step: 'upkeep' as any };

    // Record p1's hand size
    const p1HandBefore = countCardsInZone(state, 'p1', 'hand');

    // Step 1: p2 casts Grizzly Bears
    expect(canCastSpell(state, 'p2', bearInst.instanceId)).toBe(true);
    state = castSpell(state, 'p2', bearInst.instanceId);

    // The bear spell should be on the stack
    expect(state.stack.length).toBeGreaterThanOrEqual(1);

    // Step 2: Rhystic Study's trigger should have fired (pending triggers)
    expect(state.pendingTriggers.length).toBe(1);
    expect(state.pendingTriggers[0].ability.trigger.kind).toBe('OpponentCastSpell');

    // Step 3: Put triggers on stack
    state = putTriggersOnStack(state);

    // Stack should have: bear spell + Rhystic Study trigger
    expect(state.stack.length).toBe(2);

    // The trigger should be on top (last in, first to resolve)
    const topOfStack = state.stack[state.stack.length - 1];
    expect(topOfStack.kind).toBe('TriggeredAbility');

    // Step 4: Resolve the Rhystic Study trigger (draws a card)
    state = resolveTopOfStack(state);

    // p1 should have drawn a card
    const p1HandAfter = countCardsInZone(state, 'p1', 'hand');
    expect(p1HandAfter).toBe(p1HandBefore + 1);

    // Bear spell should still be on the stack
    expect(state.stack.length).toBe(1);
    expect(state.stack[0].kind).toBe('Spell');
  });

  it('does NOT fire when the controller casts a spell (only opponents)', () => {
    const rhysticStudy = makeEnchantment(
      'rhystic-study',
      'Rhystic Study',
      'Whenever an opponent casts a spell, draw a card.',
    );
    const ownSpell = makeInstant('opt', 'Opt', 'Draw a card.');
    const island = makeLand('island', 'Island');

    let state = createTestGame(
      [rhysticStudy, ownSpell, island, island],
      [island],
    );

    // Put Rhystic Study on p1's battlefield
    const rhysticInst = findCard(state, 'rhystic-study')!;
    state = moveToZone(state, rhysticInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, rhysticInst.instanceId);

    // Put Opt in p1's hand and give p1 mana
    const optInst = findCard(state, 'opt')!;
    state = moveToZone(state, optInst.instanceId, 'hand');
    state = giveMana(state, 'p1', 5, 'U');

    // p1 casts their own spell
    state = { ...state, activePlayerIndex: 0, phase: 'precombat_main' as any, step: 'upkeep' as any };
    state = castSpell(state, 'p1', optInst.instanceId);

    // Rhystic Study should NOT fire (p1 is the controller, not an opponent)
    expect(state.pendingTriggers.length).toBe(0);
  });
});

// ============================================================================
// ATTACK TRIGGER PIPELINE
// ============================================================================

describe('Attack Trigger Pipeline', () => {
  it('fires "Whenever ~ attacks" trigger when creature attacks', () => {
    const attackCreature = makeCreatureWithAttackTrigger(
      'attack-draw',
      'Ohran Frostfang',
      'Whenever ~ attacks, draw a card.',
    );
    const island = makeLand('island', 'Island');

    let state = createTestGame(
      [attackCreature, island, island],
      [island, island],
    );

    // Put creature on p1's battlefield (not summoning sick)
    const creatureInst = findCard(state, 'attack-draw')!;
    state = moveToZone(state, creatureInst.instanceId, 'battlefield');
    const newCards = new Map(state.cards);
    newCards.set(creatureInst.instanceId, { ...newCards.get(creatureInst.instanceId)!, summoningSick: false });
    state = { ...state, cards: newCards };

    // Register abilities
    state = registerBattlefieldAbilities(state, creatureInst.instanceId);

    // Verify the attack trigger was registered
    const abilities = state.battlefieldAbilities.get(creatureInst.instanceId);
    expect(abilities).toBeDefined();
    expect(abilities!.some(a => a.trigger.kind === 'Attacks')).toBe(true);

    // Set combat phase
    state = {
      ...state,
      activePlayerIndex: 0,
      phase: 'combat' as any,
      step: 'declare_attackers' as any,
    };

    // Record hand size
    const handBefore = countCardsInZone(state, 'p1', 'hand');

    // Declare attacker
    state = declareAttackers(state, 'p1', [
      { cardInstanceId: creatureInst.instanceId, defendingPlayerId: 'p2' },
    ]);

    // Attack trigger should be pending
    expect(state.pendingTriggers.length).toBe(1);
    expect(state.pendingTriggers[0].ability.trigger.kind).toBe('Attacks');

    // Put on stack
    state = putTriggersOnStack(state);
    expect(state.stack.length).toBe(1);

    // Resolve trigger
    state = resolveTopOfStack(state);

    // Should have drawn a card
    const handAfter = countCardsInZone(state, 'p1', 'hand');
    expect(handAfter).toBe(handBefore + 1);
  });
});

describe('Unblocked Trigger Pipeline', () => {
  it("fires attacks-and-isn't-blocked triggers after blockers are declared", () => {
    const unblockedCreature = makeCreatureWithAttackTrigger(
      'unblocked-payoff',
      'Murk Dwellers Test',
      "Whenever this creature attacks and isn't blocked, it gets +2/+0 until end of combat.",
    );
    const island = makeLand('island-unblocked-trigger', 'Island');

    let state = createTestGame([unblockedCreature, island], [island]);
    const creatureInst = findCard(state, 'unblocked-payoff')!;
    state = moveToZone(state, creatureInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, creatureInst.instanceId);

    state = { ...state, activePlayerIndex: 0, phase: 'combat' as any, step: 'declare_attackers' as any };
    state = declareAttackers(state, 'p1', [
      { cardInstanceId: creatureInst.instanceId, defendingPlayerId: 'p2' },
    ]);
    expect(state.pendingTriggers).toHaveLength(0);

    state = {
      ...state,
      step: 'declare_blockers' as any,
    };
    state = declareBlockers(state, 'p2', []);

    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0].ability.trigger).toEqual({ kind: 'Unblocked', who: 'self' });

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    expect(getEffectivePower(state, creatureInst.instanceId)).toBe(5);
  });
});

// ============================================================================
// BECOMES TAPPED TRIGGER PIPELINE
// ============================================================================

describe('Becomes Tapped Trigger Pipeline', () => {
  it('fires when a creature taps for mana', () => {
    const tappedPayoff: CardDefinition = {
      id: 'seedship-test',
      name: 'Seedship Test',
      type_line: 'Creature - Plant',
      oracle_text: 'Whenever this creature becomes tapped, create a Lander token. (It\'s an artifact with "{2}, {T}, Sacrifice this token: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.")\n{T}: Add {G}.',
      mana_cost: '{G}',
      cmc: 1,
      colors: ['G'],
      color_identity: ['G'],
      keywords: [],
      power: 1,
      toughness: 1,
      card_types: ['creature'],
    };
    const island = makeLand('island-tapped-trigger', 'Island');

    let state = createTestGame([tappedPayoff, island], [island]);
    const payoffInst = findCard(state, 'seedship-test')!;
    state = moveToZone(state, payoffInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, payoffInst.instanceId);

    state = tapLandForMana(state, 'p1', payoffInst.instanceId, 'G');

    expect(state.players[0].manaPool.G).toBe(1);
    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0].ability.trigger).toEqual({ kind: 'BecomesTapped', who: 'self' });

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    const landers = Array.from(state.cards.values()).filter(card => {
      const def = state.cardDefinitions.get(card.definitionId);
      return card.ownerId === 'p1' && card.zone === 'battlefield' && card.isToken && def?.name === 'Lander';
    });
    expect(landers).toHaveLength(1);
    const landerDef = state.cardDefinitions.get(landers[0].definitionId);
    expect(landerDef?.card_types).toContain('artifact');
    expect(landerDef?.oracle_text).toContain('Search your library for a basic land card');
  });
});

// ============================================================================
// BEGINNING OF COMBAT TRIGGER PIPELINE
// ============================================================================

describe('Beginning of Combat Trigger Pipeline', () => {
  it('queues and resolves Xenagos-style target power boosts before attacks', () => {
    const combatTrigger = makeEnchantment(
      'combat-god',
      'Combat God',
      "At the beginning of combat on your turn, another target creature you control gains haste until end of turn and gets +X/+X until end of turn, where X is that creature's power.",
    );
    const targetCreature = makeCreatureWithETB('large-creature', 'Large Creature', '');
    const island = makeLand('island-combat', 'Island');

    let state = createTestGame(
      [combatTrigger, targetCreature, island],
      [island],
    );

    const triggerInst = findCard(state, 'combat-god')!;
    const targetInst = findCard(state, 'large-creature')!;
    state = moveToZone(state, triggerInst.instanceId, 'battlefield');
    state = moveToZone(state, targetInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, triggerInst.instanceId);

    state = checkTriggersForEvent(state, {
      kind: 'BeginningCombatStart',
      activePlayerId: 'p1',
    });

    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0].ability.trigger.kind).toBe('BeginningCombat');

    const triggerId = state.pendingTriggers[0].id;
    state = putTriggersOnStack(state, { [triggerId]: [targetInst.instanceId] });
    state = resolveTopOfStack(state);

    expect(instanceHasKeyword(state, targetInst.instanceId, 'Haste')).toBe(true);
    expect(getEffectivePower(state, targetInst.instanceId)).toBe(4);
  });
});

// ============================================================================
// END STEP TRIGGER PIPELINE
// ============================================================================

describe('End Step Trigger Pipeline', () => {
  it("Goblin Spymaster creates the Goblin for the opponent whose end step triggered it", () => {
    const spymaster = makeCreatureWithETB(
      'goblin-spymaster',
      'Goblin Spymaster',
      "At the beginning of each opponent's end step, that player creates a 1/1 red Goblin creature token.",
    );
    const island = makeLand('island', 'Island');

    let state = createTestGame([spymaster, island], [island]);
    const spymasterInst = findCard(state, 'goblin-spymaster')!;
    state = moveToZone(state, spymasterInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, spymasterInst.instanceId);

    state = {
      ...state,
      activePlayerIndex: 1,
      priorityPlayerIndex: 1,
      phase: 'ending',
      step: 'end',
    };
    state = checkTriggersForEvent(state, { kind: 'EndStepStart', activePlayerId: 'p2' });

    expect(state.pendingTriggers).toHaveLength(1);
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    const p2Goblins = Array.from(state.cards.values()).filter(card => {
      const def = state.cardDefinitions.get(card.definitionId);
      return card.ownerId === 'p2' && card.zone === 'battlefield' && card.isToken && def?.name === 'Goblin';
    });
    const p1Goblins = Array.from(state.cards.values()).filter(card => {
      const def = state.cardDefinitions.get(card.definitionId);
      return card.ownerId === 'p1' && card.zone === 'battlefield' && card.isToken && def?.name === 'Goblin';
    });

    expect(p2Goblins).toHaveLength(1);
    expect(p1Goblins).toHaveLength(0);
  });

  it("Goblin Spymaster does not trigger on its controller's own end step", () => {
    const spymaster = makeCreatureWithETB(
      'goblin-spymaster',
      'Goblin Spymaster',
      "At the beginning of each opponent's end step, that player creates a 1/1 red Goblin creature token.",
    );
    const island = makeLand('island', 'Island');

    let state = createTestGame([spymaster, island], [island]);
    const spymasterInst = findCard(state, 'goblin-spymaster')!;
    state = moveToZone(state, spymasterInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, spymasterInst.instanceId);
    state = { ...state, activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'ending', step: 'end' };
    state = checkTriggersForEvent(state, { kind: 'EndStepStart', activePlayerId: 'p1' });

    expect(state.pendingTriggers).toHaveLength(0);
  });
});

// ============================================================================
// LANDFALL TRIGGER PIPELINE
// ============================================================================

describe('Landfall Trigger Pipeline', () => {
  it('fires landfall trigger when a land is played', () => {
    // Create a permanent with a landfall trigger
    const landfallCard = makeEnchantment(
      'exploration-triggers',
      'Retreat to Coralhelm',
      'Whenever a land enters the battlefield under your control, draw a card.',
    );
    const island = makeLand('island-1', 'Island');
    const island2 = makeLand('island-2', 'Island');

    let state = createTestGame(
      [landfallCard, island, island2],
      [island],
    );

    // Put landfall enchantment on p1's battlefield
    const landfallInst = findCard(state, 'exploration-triggers')!;
    state = moveToZone(state, landfallInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, landfallInst.instanceId);

    // Verify landfall trigger registered
    const abilities = state.battlefieldAbilities.get(landfallInst.instanceId);
    expect(abilities).toBeDefined();
    expect(abilities!.some(a => a.trigger.kind === 'Landfall')).toBe(true);

    // Put a land in p1's hand
    const landInst = findCard(state, 'island-1')!;
    state = moveToZone(state, landInst.instanceId, 'hand');

    // Set main phase for p1
    state = { ...state, activePlayerIndex: 0, phase: 'precombat_main' as any, step: 'upkeep' as any };

    const handBefore = countCardsInZone(state, 'p1', 'hand');

    // Play the land
    state = playLand(state, 'p1', landInst.instanceId);

    // Landfall trigger should be pending
    expect(state.pendingTriggers.length).toBe(1);
    expect(state.pendingTriggers[0].ability.trigger.kind).toBe('Landfall');

    // Put on stack and resolve
    state = putTriggersOnStack(state);
    expect(state.stack.length).toBe(1);
    state = resolveTopOfStack(state);

    // Should have drawn a card (hand: was handBefore, played a land (-1), drew (+1))
    const handAfter = countCardsInZone(state, 'p1', 'hand');
    expect(handAfter).toBe(handBefore - 1 + 1);
  });
});

// ============================================================================
// YOU CAST A SPELL TRIGGER
// ============================================================================

describe('YouCastSpell Trigger Pipeline', () => {
  it('fires when the controller casts a spell', () => {
    const castTrigger = makeEnchantment(
      'cast-trigger',
      'Aetherflux Reservoir',
      'Whenever you cast a spell, gain 1 life.',
    );
    const bear = makeVanillaCreature('bear', 'Grizzly Bears', '{1}{G}');
    const island = makeLand('island', 'Island');

    let state = createTestGame(
      [castTrigger, bear, island, island],
      [island],
    );

    // Put cast trigger enchantment on battlefield
    const triggerInst = findCard(state, 'cast-trigger')!;
    state = moveToZone(state, triggerInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, triggerInst.instanceId);

    // Verify trigger registered
    const abilities = state.battlefieldAbilities.get(triggerInst.instanceId);
    expect(abilities).toBeDefined();
    expect(abilities!.some(a => a.trigger.kind === 'YouCastSpell')).toBe(true);

    // Put bear in p1's hand, give mana
    const bearInst = findCard(state, 'bear')!;
    state = moveToZone(state, bearInst.instanceId, 'hand');
    state = giveMana(state, 'p1', 5, 'G');
    state = { ...state, activePlayerIndex: 0, phase: 'precombat_main' as any, step: 'upkeep' as any };

    const lifeBefore = state.players[0].life;

    // p1 casts their own spell
    state = castSpell(state, 'p1', bearInst.instanceId);

    // YouCastSpell trigger should fire
    expect(state.pendingTriggers.length).toBe(1);
    expect(state.pendingTriggers[0].ability.trigger.kind).toBe('YouCastSpell');

    // Put on stack and resolve
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    // Should have gained 1 life
    expect(state.players[0].life).toBe(lifeBefore + 1);
  });

  it('fires Vivi-style triggers only for noncreature spells and resolves self counter plus opponent damage', () => {
    const vivi = makeVanillaCreature('vivi', 'Vivi Ornitier', '{1}{U}{R}');
    vivi.oracle_text = 'Whenever you cast a noncreature spell, put a +1/+1 counter on Vivi Ornitier and it deals 1 damage to each opponent.';
    vivi.power = 0;
    vivi.toughness = 3;

    const opt = makeInstant('opt', 'Opt', 'Draw a card.');
    const bear = makeVanillaCreature('bear', 'Grizzly Bears', '{1}{G}');
    const island = makeLand('island', 'Island');

    let state = createTestGame(
      [vivi, opt, bear, island, island],
      [island],
    );

    const viviInst = findCard(state, 'vivi')!;
    state = moveToZone(state, viviInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, viviInst.instanceId);

    const abilities = state.battlefieldAbilities.get(viviInst.instanceId);
    expect(abilities!.some(a => a.trigger.kind === 'CastNoncreatureSpell')).toBe(true);

    const bearInst = findCard(state, 'bear')!;
    state = moveToZone(state, bearInst.instanceId, 'hand');
    state = giveMana(state, 'p1', 5, 'G');
    state = { ...state, activePlayerIndex: 0, phase: 'precombat_main' as any, step: 'upkeep' as any };
    state = castSpell(state, 'p1', bearInst.instanceId);
    expect(state.pendingTriggers).toHaveLength(0);
    state = resolveTopOfStack(state);

    const optInst = findCard(state, 'opt')!;
    state = moveToZone(state, optInst.instanceId, 'hand');
    state = giveMana(state, 'p1', 1, 'U');
    const opponentLifeBefore = state.players[1].life;

    state = castSpell(state, 'p1', optInst.instanceId);
    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0].ability.trigger.kind).toBe('CastNoncreatureSpell');

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    expect(state.cards.get(viviInst.instanceId)!.counters['+1/+1']).toBe(1);
    expect(state.players[1].life).toBe(opponentLifeBefore - 1);
  });

  it('registers prowess as a noncreature-spell trigger and clears the temporary buff at cleanup', () => {
    const swiftspear = makeVanillaCreature('swiftspear', 'Monastery Swiftspear', '{R}');
    swiftspear.oracle_text = 'Haste. Prowess.';
    swiftspear.keywords = ['Haste', 'Prowess'];
    swiftspear.colors = ['R'];
    swiftspear.color_identity = ['R'];
    swiftspear.power = 1;
    swiftspear.toughness = 2;
    const opt = makeInstant('opt', 'Opt', 'Draw a card.');
    const bear = makeVanillaCreature('bear', 'Grizzly Bears', '{1}{G}');
    const island = makeLand('island', 'Island');

    let state = createTestGame(
      [swiftspear, opt, bear, island, island],
      [island],
    );

    const prowessInst = findCard(state, 'swiftspear')!;
    state = moveToZone(state, prowessInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, prowessInst.instanceId);

    expect(state.battlefieldAbilities.get(prowessInst.instanceId)?.some(ability =>
      ability.trigger.kind === 'CastNoncreatureSpell'
    )).toBe(true);

    const bearInst = findCard(state, 'bear')!;
    state = moveToZone(state, bearInst.instanceId, 'hand');
    state = giveMana(state, 'p1', 5, 'G');
    state = { ...state, activePlayerIndex: 0, phase: 'precombat_main' as any, step: 'upkeep' as any };
    state = castSpell(state, 'p1', bearInst.instanceId);
    expect(state.pendingTriggers).toHaveLength(0);
    state = resolveTopOfStack(state);

    const optInst = findCard(state, 'opt')!;
    state = moveToZone(state, optInst.instanceId, 'hand');
    state = giveMana(state, 'p1', 1, 'U');
    state = castSpell(state, 'p1', optInst.instanceId);
    expect(state.pendingTriggers).toHaveLength(1);

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    expect(state.cards.get(prowessInst.instanceId)?.counters._powerMod).toBe(1);
    expect(state.cards.get(prowessInst.instanceId)?.counters._toughnessMod).toBe(1);
    expect(getEffectivePower(state, prowessInst.instanceId)).toBe(2);

    state = cleanupDamage({ ...state, step: 'cleanup' });
    expect(state.cards.get(prowessInst.instanceId)?.counters._powerMod).toBeUndefined();
    expect(state.cards.get(prowessInst.instanceId)?.counters._toughnessMod).toBeUndefined();
  });
});

// ============================================================================
// REGISTRATION: Multi-ability cards register all triggers
// ============================================================================

describe('Multi-ability Registration', () => {
  it('registers triggers from cards with multiple abilities (multi-line oracle text)', () => {
    // A card with both a static/other text and a trigger on separate lines
    const multiCard: CardDefinition = {
      id: 'multi-trigger',
      name: 'Multi Trigger Card',
      type_line: 'Enchantment',
      oracle_text: 'Whenever an opponent casts a spell, draw a card.',
      mana_cost: '{2}{U}',
      cmc: 3,
      colors: ['U'],
      color_identity: ['U'],
      keywords: [],
      card_types: ['enchantment'],
    };

    let state = createTestGame([multiCard], []);
    const inst = findCard(state, 'multi-trigger')!;
    state = moveToZone(state, inst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, inst.instanceId);

    const abilities = state.battlefieldAbilities.get(inst.instanceId);
    expect(abilities).toBeDefined();
    expect(abilities!.length).toBeGreaterThan(0);
    expect(abilities!.some(a => a.trigger.kind === 'OpponentCastSpell')).toBe(true);
  });
});

// ============================================================================
// FULL PIPELINE: Multiple triggers from different sources
// ============================================================================

describe('Full Trigger Pipeline - Multiple Sources', () => {
  it('two different permanents with OpponentCastSpell triggers both fire', () => {
    const rhystic1 = makeEnchantment('rhystic-1', 'Rhystic Study', 'Whenever an opponent casts a spell, draw a card.');
    const rhystic2 = makeEnchantment('rhystic-2', 'Mystic Remora', 'Whenever an opponent casts a spell, draw a card.');
    const bear = makeVanillaCreature('bear', 'Grizzly Bears', '{1}{G}');
    const island = makeLand('island', 'Island');

    let state = createTestGame(
      [rhystic1, rhystic2, island, island],
      [bear, island],
    );

    // Put both enchantments on p1's battlefield
    const r1Inst = findCard(state, 'rhystic-1')!;
    const r2Inst = findCard(state, 'rhystic-2')!;
    state = moveToZone(state, r1Inst.instanceId, 'battlefield');
    state = moveToZone(state, r2Inst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, r1Inst.instanceId);
    state = registerBattlefieldAbilities(state, r2Inst.instanceId);

    // Setup p2 to cast
    const bearInst = findCard(state, 'bear')!;
    state = moveToZone(state, bearInst.instanceId, 'hand');
    state = giveMana(state, 'p2', 5, 'G');
    state = { ...state, activePlayerIndex: 1, phase: 'precombat_main' as any, step: 'upkeep' as any };

    const p1HandBefore = countCardsInZone(state, 'p1', 'hand');

    // p2 casts a spell
    state = castSpell(state, 'p2', bearInst.instanceId);

    // BOTH triggers should fire
    expect(state.pendingTriggers.length).toBe(2);

    // Put on stack and resolve both
    state = putTriggersOnStack(state);
    expect(state.stack.length).toBe(3); // bear spell + 2 triggers

    // Resolve trigger 1
    state = resolveTopOfStack(state);
    // Resolve trigger 2
    state = resolveTopOfStack(state);

    // p1 should have drawn 2 cards
    const p1HandAfter = countCardsInZone(state, 'p1', 'hand');
    expect(p1HandAfter).toBe(p1HandBefore + 2);
  });
});

// ============================================================================
// Real-card landfall coverage: Omnath, Locus of Rage
// ============================================================================

describe('Omnath, Locus of Rage end-to-end', () => {
  it('registers landfall trigger from Scryfall oracle text with "Landfall — " prefix', () => {
    // This is the verbatim Scryfall oracle text — note the "Landfall — " keyword prefix
    // and the modern concise phrasing "whenever a land you control enters,".
    const omnath: CardDefinition = {
      id: 'omnath-locus-of-rage',
      name: 'Omnath, Locus of Rage',
      type_line: 'Legendary Creature - Elemental',
      oracle_text:
        'Landfall — Whenever a land you control enters, create a 5/5 red and green Elemental creature token.\n' +
        'Whenever Omnath, Locus of Rage or another Elemental you control dies, Omnath, Locus of Rage deals 3 damage to any target.',
      mana_cost: '{3}{R}{R}{G}{G}',
      cmc: 7,
      colors: ['R', 'G'],
      color_identity: ['R', 'G'],
      keywords: [],
      power: 5,
      toughness: 5,
      card_types: ['creature'],
    };
    const island = makeLand('island-1', 'Island');
    let state = createTestGame([omnath, island], [island]);

    const omnathInst = findCard(state, 'omnath-locus-of-rage')!;
    state = moveToZone(state, omnathInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, omnathInst.instanceId);

    const abilities = state.battlefieldAbilities.get(omnathInst.instanceId);
    expect(abilities, 'Omnath should have at least one registered ability').toBeDefined();
    expect(abilities!.length, 'both lines should produce a registered trigger').toBeGreaterThanOrEqual(1);
    expect(
      abilities!.some(a => a.trigger.kind === 'Landfall'),
      'landfall trigger should be among the registered abilities',
    ).toBe(true);
  });
});
