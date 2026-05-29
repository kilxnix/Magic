import { describe, expect, it } from 'vitest';
import {
  applyClientActionRequest,
  buildActionPrompt,
  createClientActionRequest,
  diffGameStates,
  labelForAction,
  stateFingerprint,
} from './authority';
import { initGameState } from './game-state';
import type { CardDefinition, GameState } from './types';
import type { AIAction } from './ai/types';

function def(
  id: string,
  name: string,
  typeLine: string,
  manaCost = '',
  oracleText = '',
): CardDefinition {
  const lowerType = typeLine.toLowerCase();
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: oracleText,
    mana_cost: manaCost,
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: [
      lowerType.includes('creature') ? 'creature' : undefined,
      lowerType.includes('land') ? 'land' : undefined,
      lowerType.includes('artifact') ? 'artifact' : undefined,
      lowerType.includes('enchantment') ? 'enchantment' : undefined,
      lowerType.includes('instant') ? 'instant' : undefined,
      lowerType.includes('sorcery') ? 'sorcery' : undefined,
    ].filter(Boolean) as CardDefinition['card_types'],
  };
}

function stateWithForestInHand(): GameState {
  const commander = def('commander', 'Test Commander', 'Legendary Creature - Human', '{1}{G}');
  const forest = def('forest', 'Forest', 'Basic Land - Forest', '', '{T}: Add {G}.');
  const island = def('island', 'Island', 'Basic Land - Island', '', '{T}: Add {U}.');
  const state = initGameState([
    { playerId: 'p1', name: 'Player One', cards: [commander, forest], commanderId: commander.id },
    { playerId: 'p2', name: 'Player Two', cards: [commander, island], commanderId: commander.id },
  ]);
  const forestInstance = [...state.cards.values()].find(card => card.definitionId === forest.id && card.ownerId === 'p1');
  if (!forestInstance) throw new Error('Forest not found');
  state.cards.set(forestInstance.instanceId, { ...forestInstance, zone: 'hand' });
  return {
    ...state,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'main',
    hasPriorityPassed: [false, false],
  };
}

describe('authority action boundary', () => {
  it('builds typed prompts from canonical legal actions', () => {
    const state = stateWithForestInHand();
    const prompt = buildActionPrompt(state, 'p1');

    expect(prompt?.type).toBe('main-action');
    expect(prompt?.title).toBe('Choose an action');
    expect(prompt?.guidance).toContain('Main phase actions are available');
    expect(prompt?.playerId).toBe('p1');
    expect(prompt?.priority.priorityPlayerId).toBe('p1');
    expect(prompt?.priority.stackSize).toBe(0);
    expect(prompt?.legalChoiceSummary).toEqual(expect.arrayContaining([
      { kind: 'PlayLand', label: 'Land', count: 1 },
      { kind: 'PassPriority', label: 'Pass', count: 1 },
    ]));
    expect(prompt?.legalChoices.some(choice => choice.kind === 'PlayLand' && choice.label === 'Play Forest')).toBe(true);
    expect(prompt?.legalChoices.some(choice => choice.kind === 'PassPriority')).toBe(true);
  });

  it('includes selected target names in command labels', () => {
    const state = stateWithForestInHand();
    const source = [...state.cards.values()].find(card => card.ownerId === 'p1' && card.definitionId === 'commander');
    const target = [...state.cards.values()].find(card => card.ownerId === 'p2' && card.definitionId === 'island');
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    state.cards.set(target!.instanceId, { ...target!, zone: 'battlefield' });

    expect(labelForAction(state, {
      kind: 'CastSpell',
      cardInstanceId: source!.instanceId,
      targets: [target!.instanceId],
    })).toBe('Cast Test Commander targeting Island');
  });

  it('validates a client action request, applies it, and emits visible diffs', () => {
    const state = stateWithForestInHand();
    const prompt = buildActionPrompt(state, 'p1');
    const playLand = prompt?.legalChoices.find(choice => choice.kind === 'PlayLand')?.action;
    expect(playLand).toBeDefined();

    const request = createClientActionRequest(state, 'p1', playLand as AIAction, {
      id: 'req-play-forest',
      createdAt: 1,
    });
    const response = applyClientActionRequest(state, request);

    expect(response.ok).toBe(true);
    expect(response.state?.cards.get((playLand as Extract<AIAction, { kind: 'PlayLand' }>).cardInstanceId)?.zone)
      .toBe('battlefield');
    expect(response.events).toEqual(expect.arrayContaining([
      { kind: 'LandPlayed', playerId: 'p1', cardId: (playLand as Extract<AIAction, { kind: 'PlayLand' }>).cardInstanceId },
    ]));
    expect(response.update?.oldStateId).toBe(stateFingerprint(state));
    expect(response.update?.rulesEvents).toContainEqual({
      kind: 'ActionAccepted',
      requestId: 'req-play-forest',
      playerId: 'p1',
      actionKind: 'PlayLand',
      label: 'Play Forest',
    });
    expect(response.update?.rulesEvents).toEqual(expect.arrayContaining([
      { kind: 'RulesEvent', event: { kind: 'LandPlayed', playerId: 'p1', cardId: (playLand as Extract<AIAction, { kind: 'PlayLand' }>).cardInstanceId } },
    ]));
    expect(response.update?.visibleDiffs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'CardZoneChanged',
        cardName: 'Forest',
        from: 'hand',
        to: 'battlefield',
      }),
    ]));
    expect(response.update?.prompt?.playerId).toBe('p1');
  });

  it('rejects stale and illegal action requests without mutating state', () => {
    const state = stateWithForestInHand();
    const prompt = buildActionPrompt(state, 'p1');
    const pass = prompt?.legalChoices.find(choice => choice.kind === 'PassPriority')?.action;
    expect(pass).toBeDefined();

    const stale = applyClientActionRequest(state, {
      ...createClientActionRequest(state, 'p1', pass as AIAction, { id: 'req-stale', createdAt: 1 }),
      expectedStateId: 'old-state',
    });
    expect(stale.ok).toBe(false);
    expect(stale.reason).toBe('stale_state');
    expect(stale.state).toBeUndefined();
    expect(stale.events).toBeUndefined();
    expect(stale.update?.visibleDiffs).toEqual([]);

    const illegal = applyClientActionRequest(
      state,
      createClientActionRequest(state, 'p2', pass as AIAction, { id: 'req-illegal', createdAt: 2 }),
    );
    expect(illegal.ok).toBe(false);
    expect(illegal.reason).toBe('illegal_action');
    expect(illegal.state).toBeUndefined();
    expect(illegal.events).toBeUndefined();
    expect(illegal.update?.rulesEvents).toEqual([
      {
        kind: 'ActionRejected',
        requestId: 'req-illegal',
        playerId: 'p2',
        actionKind: 'PassPriority',
        reason: 'illegal_action',
        message: 'That action is not legal in the current game state.',
      },
    ]);
  });

  it('emits granular diffs for combat, commander, and visible card state changes', () => {
    const before = stateWithForestInHand();
    const card = [...before.cards.values()].find(candidate => candidate.ownerId === 'p1' && candidate.zone === 'hand');
    expect(card).toBeDefined();
    const commanderId = before.players[0].commanderInstanceId || 'commander-p1';
    const afterCards = new Map(before.cards);
    afterCards.set(card!.instanceId, {
      ...card!,
      damage: 3,
      summoningSick: false,
      phasedOut: true,
    });
    const after: GameState = {
      ...before,
      cards: afterCards,
      players: before.players.map(player => player.id === 'p2'
        ? {
            ...player,
            life: 19,
            hasLost: true,
            commanderDamage: { [commanderId]: 21 },
            commanderTax: 2,
            commanderCastCount: 2,
            commanderCastCounts: { [commanderId]: 2 },
          }
        : player),
      combat: {
        attackers: [{ cardInstanceId: card!.instanceId, defendingPlayerId: 'p2' }],
        blockers: [],
        blockersDeclared: false,
        blockersDeclaredBy: [],
        damageAssignment: new Map([[card!.instanceId, 3]]),
      },
    };

    expect(diffGameStates(before, after)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'CombatChanged' }),
      expect.objectContaining({ kind: 'CardDamageChanged', cardId: card!.instanceId, from: 0, to: 3 }),
      expect.objectContaining({ kind: 'CardSummoningSicknessChanged', cardId: card!.instanceId }),
      expect.objectContaining({ kind: 'CardPhasedOutChanged', cardId: card!.instanceId, to: true }),
      expect.objectContaining({ kind: 'LifeChanged', playerId: 'p2', from: 40, to: 19 }),
      expect.objectContaining({ kind: 'PlayerLostChanged', playerId: 'p2', from: false, to: true }),
      expect.objectContaining({ kind: 'CommanderDamageChanged', playerId: 'p2', commanderId, from: 0, to: 21 }),
      expect.objectContaining({ kind: 'CommanderTaxChanged', playerId: 'p2', from: 0, to: 2 }),
      expect.objectContaining({ kind: 'CommanderCastCountChanged', playerId: 'p2', from: 0, to: 2 }),
    ]));
  });
});
