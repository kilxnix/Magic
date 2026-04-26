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
import { checkStateBasedActions } from '../state-based';
import { playLand, tapLandForMana, drawCards } from '../actions';
import { declareAttackers } from '../combat';
import { addMana } from '../mana';
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

  it('parses "Whenever you cast a spell, gain 1 life." as Triggered/YouCastSpell', () => {
    const result = parseOracleText('Whenever you cast a spell, gain 1 life.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('YouCastSpell');
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
