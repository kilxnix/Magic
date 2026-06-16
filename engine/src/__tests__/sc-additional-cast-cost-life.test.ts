import { describe, expect, it } from 'vitest';
import { getCardsInZone, initGameState } from '../game-state';
import { canCastSpell, castSpell, getAdditionalLifeCostForCast, resolveTopOfStack } from '../stack';
import type { CardDefinition, GameState } from '../types';

function card(
  id: string,
  name: string,
  typeLine: string,
  manaCost: string,
  cardTypes: CardDefinition['card_types'],
  oracleText = '',
): CardDefinition {
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: oracleText,
    mana_cost: manaCost,
    cmc: (manaCost.match(/\{[^}]+\}/g) || []).length,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: cardTypes,
  };
}

function readyMain(state: GameState, blackMana: number): GameState {
  return {
    ...state,
    phase: 'precombat_main',
    step: 'main',
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    players: state.players.map((player, index) =>
      index === 0
        ? { ...player, manaPool: { W: 0, U: 0, B: blackMana, R: 0, G: 0, C: 0 } }
        : player
    ),
  };
}

function handInstance(state: GameState, name: string) {
  return getCardsInZone(state, 'p1', 'hand').find(instance =>
    state.cardDefinitions.get(instance.definitionId)?.name === name
  )!;
}

function moveToHand(state: GameState, name: string): GameState {
  const entry = [...state.cards.entries()].find(([, instance]) =>
    state.cardDefinitions.get(instance.definitionId)?.name === name
  )!;
  const [id, instance] = entry;
  const cards = new Map(state.cards);
  cards.set(id, { ...instance, zone: 'hand' });
  return { ...state, cards };
}

describe('additional-cast-cost: fixed pay N life', () => {
  it('deducts a fixed "pay 2 life" additional cost when the spell is cast', () => {
    const spell = card(
      'sign-in-blood',
      'Sign in Blood',
      'Sorcery',
      '{B}{B}',
      ['sorcery'],
      'As an additional cost to cast this spell, pay 2 life.\nYou draw two cards.',
    );

    let state = initGameState([
      { playerId: 'p1', name: 'Alice', commanderId: 'none', cards: [spell] },
      { playerId: 'p2', name: 'Bob', commanderId: 'none', cards: [] },
    ]);
    state = moveToHand(state, 'Sign in Blood');
    state = readyMain(state, 2);

    const def = state.cardDefinitions.get(handInstance(state, 'Sign in Blood').definitionId)!;
    expect(getAdditionalLifeCostForCast(def)).toBe(2);

    const lifeBefore = state.players[0].life;
    state = castSpell(state, 'p1', handInstance(state, 'Sign in Blood').instanceId, []);

    // Life actually paid at cast time.
    expect(state.players[0].life).toBe(lifeBefore - 2);
    // Mana actually paid (pool emptied).
    expect(state.players[0].manaPool.B).toBe(0);
    // Spell is on the stack.
    expect(state.stack[state.stack.length - 1]).toMatchObject({ kind: 'Spell' });

    state = resolveTopOfStack(state);
    // Spell left the stack (resolved to graveyard).
    expect(state.stack.length).toBe(0);
  });

  it('parses a word-number "pay three life" additional cost', () => {
    const def = card(
      'word-cost',
      'Word Cost',
      'Instant',
      '{R}',
      ['instant'],
      'As an additional cost to cast this spell, pay three life.\nDeal 3 damage to any target.',
    );
    expect(getAdditionalLifeCostForCast(def)).toBe(3);
  });

  it('blocks casting when the player cannot pay the fixed life cost', () => {
    const spell = card(
      'big-life',
      'Big Life',
      'Sorcery',
      '{B}',
      ['sorcery'],
      'As an additional cost to cast this spell, pay 5 life.\nDraw a card.',
    );

    let state = initGameState([
      { playerId: 'p1', name: 'Alice', commanderId: 'none', cards: [spell] },
      { playerId: 'p2', name: 'Bob', commanderId: 'none', cards: [] },
    ]);
    state = moveToHand(state, 'Big Life');
    state = readyMain(state, 1);
    state = {
      ...state,
      players: state.players.map((player, index) =>
        index === 0 ? { ...player, life: 4 } : player
      ),
    };

    const instanceId = handInstance(state, 'Big Life').instanceId;
    expect(canCastSpell(state, 'p1', instanceId)).toBe(false);
    expect(() => castSpell(state, 'p1', instanceId, [])).toThrow();
  });

  it('does not invent a life cost when no additional cost text is present', () => {
    const def = card(
      'plain',
      'Plain Spell',
      'Sorcery',
      '{1}{B}',
      ['sorcery'],
      'Draw two cards.',
    );
    expect(getAdditionalLifeCostForCast(def)).toBe(0);
  });
});
