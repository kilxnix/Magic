/**
 * trg-combat-damage-bodies: Slice 8/12 coverage tests for combat-damage-to-player
 * trigger BODIES that previously failed (the trigger prefix already parsed but
 * the body clause returned Unparsed).
 *
 * New matchers covered:
 *   (a) matchRollDNCreateThatManyTokens
 *       "roll a d20. [you] create that many <tokens>" — Ancient Gold Dragon family.
 *       Emits RollD20Effect with N linear outcomes, each creating N tokens.
 *
 *   (c) matchThatPlayerRevealHandCoercion
 *       "that player reveals N cards [at random] from their hand. you choose one.
 *        that player discards that card." — Hollow Specter family (EventPlayer coercion).
 *       Emits RevealHandChooseCard{player: EventPlayer, disposition: 'discard'}.
 *
 * Deferred (no existing executor path):
 *   (b) Dazzling Sphinx "exile top until instant/sorcery, you may cast it" —
 *       RevealUntilMatch explicitly declines "you may cast it"; no CastFromExile path.
 *       Remains Unparsed per the honesty bar.
 *
 * Gates: all tests parse AND verify execution where possible.
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState, getCardsInZone } from '../game-state';
import {
  resolveTopOfStack,
  putTriggersOnStack,
  registerBattlefieldAbilities,
} from '../stack';
import { declareAttackers, resolveCombatDamage } from '../combat';
import type { CardDefinition, GameState, CardInstance } from '../types';
import { executeEffect } from '../effects/executor';
import type { Effect } from '../effects/ast';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCreature(id: string, name: string, oracleText: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature - Test',
    oracle_text: oracleText,
    mana_cost: '{2}{G}',
    cmc: 3,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power: 3,
    toughness: 3,
    card_types: ['creature'],
  };
}

function makeLand(id: string): CardDefinition {
  return {
    id,
    name: 'Forest',
    type_line: 'Basic Land - Forest',
    oracle_text: '{T}: Add {G}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
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

function moveToZone(
  state: GameState,
  instanceId: string,
  zone: 'hand' | 'battlefield' | 'library' | 'graveyard',
): GameState {
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

function countTokensInZone(state: GameState, playerId: string): number {
  let count = 0;
  for (const card of state.cards.values()) {
    if (card.ownerId === playerId && card.zone === 'battlefield' && (card as any).isToken) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// (a) matchRollDNCreateThatManyTokens — parse tests
// ---------------------------------------------------------------------------

describe('matchRollDNCreateThatManyTokens — parse', () => {
  it('parses Ancient Gold Dragon (d20) — full combat trigger', () => {
    const result = parseOracleText(
      'Flying\nWhenever this creature deals combat damage to a player, roll a d20. You create that many 1/1 blue and red Faerie Dragon creature tokens with flying.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('CombatDamageToPlayer');
    expect(result.ability.effects).toHaveLength(1);
    const roll = result.ability.effects[0];
    expect(roll.kind).toBe('RollD20');
    if (roll.kind !== 'RollD20') return;
    // d20 → 20 outcomes (one per face)
    expect(roll.outcomes).toHaveLength(20);
    // Linear: face 1 → create 1 token
    expect(roll.outcomes[0]).toMatchObject({ min: 1, max: 1 });
    expect(roll.outcomes[0].effects[0].kind).toBe('CreateToken');
    const eff1 = roll.outcomes[0].effects[0];
    if (eff1.kind !== 'CreateToken') return;
    expect(eff1.count).toBe(1);
    // face 20 → create 20 tokens
    expect(roll.outcomes[19]).toMatchObject({ min: 20, max: 20 });
    const eff20 = roll.outcomes[19].effects[0];
    if (eff20.kind !== 'CreateToken') return;
    expect(eff20.count).toBe(20);
  });

  it('parses "roll a d20. create that many X tokens" without "you" subject', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, roll a d20. Create that many 1/1 red Goblin creature tokens.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const roll = result.ability.effects[0];
    expect(roll.kind).toBe('RollD20');
    if (roll.kind !== 'RollD20') return;
    expect(roll.outcomes).toHaveLength(20);
    // Face 5 creates 5 tokens
    expect(roll.outcomes[4].effects[0].kind).toBe('CreateToken');
    const eff5 = roll.outcomes[4].effects[0];
    if (eff5.kind !== 'CreateToken') return;
    expect(eff5.count).toBe(5);
  });

  it('parses d6 variant — 6 outcomes', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, roll a d6. You create that many 1/1 white Spirit creature tokens with flying.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const roll = result.ability.effects[0];
    expect(roll.kind).toBe('RollD20');
    if (roll.kind !== 'RollD20') return;
    expect(roll.outcomes).toHaveLength(6);
    // Face 6 → create 6 tokens
    const eff6 = roll.outcomes[5].effects[0];
    if (eff6.kind !== 'CreateToken') return;
    expect(eff6.count).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// (a) matchRollDNCreateThatManyTokens — execution test
// ---------------------------------------------------------------------------

describe('matchRollDNCreateThatManyTokens — execution', () => {
  it('fires combat-damage trigger, rolls dice, creates the right number of tokens', () => {
    const dragon = makeCreature(
      'ancient-gold-dragon',
      'Ancient Gold Dragon',
      'Flying\nWhenever this creature deals combat damage to a player, roll a d20. You create that many 1/1 blue and red Faerie Dragon creature tokens with flying.',
    );
    const land = makeLand('forest-1');

    let state = createTestGame([dragon, land, land], [land]);
    const dragonInst = findCard(state, 'ancient-gold-dragon')!;
    state = moveToZone(state, dragonInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, dragonInst.instanceId);
    state = {
      ...state,
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'combat' as any,
      step: 'declare_attackers' as any,
    };

    const tokensBefore = countTokensInZone(state, 'p1');
    const p2LifeBefore = state.players[1].life;

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: dragonInst.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = resolveCombatDamage(state);

    // Player 2 took 3 damage from the 3/3 dragon.
    expect(state.players[1].life).toBe(p2LifeBefore - 3);

    // The combat-damage trigger should be pending.
    expect(state.pendingTriggers.some(t => t.ability.trigger.kind === 'CombatDamageToPlayer')).toBe(true);

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    // Dice were rolled (recorded in diceRolls).
    expect(state.diceRolls).toBeDefined();
    expect(state.diceRolls!.length).toBeGreaterThan(0);

    // Tokens were created (quantity = dice roll result; RNG seeded so deterministic).
    const tokensAfter = countTokensInZone(state, 'p1');
    expect(tokensAfter).toBeGreaterThan(tokensBefore);
    // The roll result must match the number of tokens created.
    const rollResult = state.diceRolls![state.diceRolls!.length - 1].result;
    expect(tokensAfter - tokensBefore).toBe(rollResult);
  });
});

// ---------------------------------------------------------------------------
// (c) matchThatPlayerRevealHandCoercion — parse tests
// ---------------------------------------------------------------------------

describe('matchThatPlayerRevealHandCoercion — parse', () => {
  it('parses Hollow Specter-style: "you may pay {X}. that player reveals X cards at random..."', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, you may pay {X}. If you do, that player reveals X cards at random from their hand. You choose one of them. That player discards that card.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('CombatDamageToPlayer');

    // OptionalPay wrapping the coercion body
    const optPay = result.ability.effects.find(e => e.kind === 'OptionalPay');
    expect(optPay).toBeDefined();
    if (!optPay || optPay.kind !== 'OptionalPay') return;
    expect(optPay.xCost).toBe(true);

    // Inner effect: RevealHandChooseCard with EventPlayer
    const inner = optPay.effects.find(e => e.kind === 'RevealHandChooseCard');
    expect(inner).toBeDefined();
    if (!inner || inner.kind !== 'RevealHandChooseCard') return;
    expect(inner.player).toEqual({ kind: 'EventPlayer' });
    expect(inner.disposition).toBe('discard');
  });

  it('parses bare "that player reveals their hand. you choose a card. that player discards it."', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, that player reveals their hand. You choose a card. That player discards it.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const coerce = result.ability.effects.find(e => e.kind === 'RevealHandChooseCard');
    expect(coerce).toBeDefined();
    if (!coerce || coerce.kind !== 'RevealHandChooseCard') return;
    expect(coerce.player).toEqual({ kind: 'EventPlayer' });
    expect(coerce.disposition).toBe('discard');
  });

  it('parses "that player reveals 3 cards at random from their hand. you choose one of them. that player discards that card."', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, that player reveals 3 cards at random from their hand. You choose one of them. That player discards that card.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const coerce = result.ability.effects.find(e => e.kind === 'RevealHandChooseCard');
    expect(coerce).toBeDefined();
    if (!coerce || coerce.kind !== 'RevealHandChooseCard') return;
    expect(coerce.player).toEqual({ kind: 'EventPlayer' });
    expect(coerce.disposition).toBe('discard');
  });
});

// ---------------------------------------------------------------------------
// (c) matchThatPlayerRevealHandCoercion — execution test
// ---------------------------------------------------------------------------

describe('matchThatPlayerRevealHandCoercion — execution', () => {
  it('fires combat-damage trigger and discards a card from the damaged player\'s hand', () => {
    const specter = makeCreature(
      'hollow-specter',
      'Hollow Specter',
      // Simplified wording (no optional pay) so the inner effect is direct
      'Whenever ~ deals combat damage to a player, that player reveals their hand. You choose a card. That player discards it.',
    );
    const land = makeLand('forest-2');

    // Add a card to p2's hand so there is something to discard
    const handCard: CardDefinition = {
      id: 'lightning-bolt-test',
      name: 'Lightning Bolt',
      type_line: 'Instant',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      mana_cost: '{R}',
      cmc: 1,
      colors: ['R'],
      color_identity: ['R'],
      keywords: [],
      card_types: ['instant'],
    };

    let state = createTestGame([specter, land, land], [land, handCard]);
    const specterInst = findCard(state, 'hollow-specter')!;
    const boltInst = findCard(state, 'lightning-bolt-test')!;

    state = moveToZone(state, specterInst.instanceId, 'battlefield');
    // Ensure p2's hand card is in hand
    state = moveToZone(state, boltInst.instanceId, 'hand');
    state = registerBattlefieldAbilities(state, specterInst.instanceId);
    state = {
      ...state,
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'combat' as any,
      step: 'declare_attackers' as any,
    };

    const p2HandBefore = getCardsInZone(state, 'p2', 'hand').length;
    const p2GraveyardBefore = getCardsInZone(state, 'p2', 'graveyard').length;

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: specterInst.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = resolveCombatDamage(state);

    // The combat-damage trigger should fire.
    expect(state.pendingTriggers.some(t => t.ability.trigger.kind === 'CombatDamageToPlayer')).toBe(true);

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    // A card was discarded from p2's hand.
    const p2HandAfter = getCardsInZone(state, 'p2', 'hand').length;
    const p2GraveyardAfter = getCardsInZone(state, 'p2', 'graveyard').length;
    expect(p2HandAfter).toBe(p2HandBefore - 1);
    expect(p2GraveyardAfter).toBe(p2GraveyardBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// Honesty gate: Dazzling Sphinx remains Unparsed (no cast-from-exile executor path)
// ---------------------------------------------------------------------------

describe('Dazzling Sphinx body — honest skip', () => {
  it('remains Unparsed because exile-until-match-and-cast has no executor path', () => {
    // Oracle: "...that player exiles cards from the top of their library until
    // they exile an instant or sorcery card. You may cast that card without
    // paying its mana cost." — declined per honesty bar.
    const result = parseOracleText(
      'Whenever Dazzling Sphinx deals combat damage to a player, that player exiles cards from the top of their library until they exile an instant or sorcery card. You may cast that card without paying its mana cost.',
    );
    // This should remain Unparsed since the executor has no "exile-until-match + free cast" path.
    expect(result.kind).toBe('Unparsed');
  });
});
