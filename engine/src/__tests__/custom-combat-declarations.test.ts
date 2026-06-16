/**
 * Custom multi-attacker / multi-blocker declarations must be accepted by the
 * authority. The legal-action menu only enumerates canonical sets (none /
 * each-single / all / split), so validation has to be semantic — a player
 * attacking with 2 of 3 creatures or gang-blocking with two blockers is legal
 * even though no menu entry matches that exact set.
 */
import { describe, it, expect } from 'vitest';
import { initGameFromDecks } from '../game-init';
import { createCardLookup } from '../cards/deck-loader';
import { getCardsInZone } from '../game-state';
import { applyClientActionRequest, createClientActionRequest } from '../authority';
import { declareAttackers } from '../combat';
import type { GameState } from '../types';
import type { GeneratedDeck } from '../cards/deck-loader';

const cards = [
  {
    id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear',
    oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'],
    power: '2', toughness: '2', keywords: [],
  },
  {
    id: 'cmdr', name: 'Test Commander', type_line: 'Legendary Creature — Human Wizard',
    oracle_text: '', mana_cost: '{2}{G}', cmc: 3, colors: ['G'], color_identity: ['G'],
    power: '3', toughness: '3', keywords: [],
  },
  {
    id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest',
    oracle_text: '({T}: Add {G}.)', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [],
  },
];
const lookup = createCardLookup(cards as never);

function deck(id: string): GeneratedDeck {
  return {
    id, commander: 'Test Commander',
    list: ['Grizzly Bears', 'Grizzly Bears', 'Grizzly Bears', ...Array(96).fill('Forest')],
    colors: ['G'], bracket: 2, theme: 't',
  } as GeneratedDeck;
}

/** Put N bears onto a player's battlefield without summoning sickness. */
function fieldBears(state: GameState, playerId: string, count: number): string[] {
  const ids: string[] = [];
  for (const card of state.cards.values()) {
    if (ids.length >= count) break;
    if (card.ownerId !== playerId || card.definitionId !== 'bear') continue;
    card.zone = 'battlefield';
    card.summoningSick = false;
    card.tapped = false;
    ids.push(card.instanceId);
  }
  return ids;
}

function setup() {
  const state = initGameFromDecks({
    humanDeck: deck('h'),
    aiDecks: [deck('a')],
    aiDifficulty: 3,
    cardLookup: lookup,
    seed: 42,
  });
  const humanId = state.players[0].id;
  const aiId = state.players[1].id;
  return { state, humanId, aiId };
}

describe('custom combat declarations through the authority', () => {
  it('accepts attacking with 2 of 3 eligible creatures (no menu entry matches)', () => {
    const { state, humanId, aiId } = setup();
    const bears = fieldBears(state, humanId, 3);
    expect(bears.length).toBe(3);

    state.phase = 'combat';
    state.step = 'declare_attackers';
    state.activePlayerIndex = 0;
    state.priorityPlayerIndex = 0;
    state.combat = undefined as never;

    const action = {
      kind: 'DeclareAttackers' as const,
      attacks: [
        { cardInstanceId: bears[0], defendingPlayerId: aiId },
        { cardInstanceId: bears[2], defendingPlayerId: aiId },
      ],
    };
    const request = createClientActionRequest(state, humanId, action);
    const result = applyClientActionRequest(state, request);

    expect(result.ok).toBe(true);
    expect(result.state?.combat?.attackers.length).toBe(2);
  });

  it('accepts a gang block: two blockers on one attacker', () => {
    const { state, humanId, aiId } = setup();
    const attackerIds = fieldBears(state, aiId, 1);
    const blockerIds = fieldBears(state, humanId, 2);

    state.phase = 'combat';
    state.step = 'declare_attackers';
    state.activePlayerIndex = 1;
    let next: GameState = declareAttackers(state, aiId, [
      { cardInstanceId: attackerIds[0], defendingPlayerId: humanId },
    ]);
    next = { ...next, step: 'declare_blockers' };

    const action = {
      kind: 'DeclareBlockers' as const,
      blocks: [
        { cardInstanceId: blockerIds[0], blockingAttackerId: attackerIds[0] },
        { cardInstanceId: blockerIds[1], blockingAttackerId: attackerIds[0] },
      ],
    };
    const request = createClientActionRequest(next, humanId, action);
    const result = applyClientActionRequest(next, request);

    expect(result.ok).toBe(true);
    expect(result.state?.combat?.blockers.length).toBe(2);
  });

  it('still rejects an illegal attacker (tapped creature)', () => {
    const { state, humanId, aiId } = setup();
    const bears = fieldBears(state, humanId, 2);
    state.cards.get(bears[1])!.tapped = true;

    state.phase = 'combat';
    state.step = 'declare_attackers';
    state.activePlayerIndex = 0;
    state.priorityPlayerIndex = 0;

    const action = {
      kind: 'DeclareAttackers' as const,
      attacks: [
        { cardInstanceId: bears[0], defendingPlayerId: aiId },
        { cardInstanceId: bears[1], defendingPlayerId: aiId },
      ],
    };
    const request = createClientActionRequest(state, humanId, action);
    const result = applyClientActionRequest(state, request);

    expect(result.ok).toBe(false);
  });
});
