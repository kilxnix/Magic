import { describe, expect, it } from 'vitest';
import { groupBattlefieldCards, summarizeStateUpdate } from '../src/components/GameBoard';
import type { SimpleCard } from '../src/hooks/useShelectorGame';
import type { EngineStateUpdate } from 'commander-engine';

function card(overrides: Partial<SimpleCard>): SimpleCard {
  return {
    instanceId: 'card',
    name: 'Goblin',
    manaCost: '',
    typeLine: 'Token Creature - Goblin',
    oracleText: '',
    power: 1,
    toughness: 1,
    tapped: false,
    zone: 'battlefield',
    ownerId: 'p1',
    cardTypes: ['creature'],
    isCommander: false,
    counters: {},
    damage: 0,
    isToken: true,
    ...overrides,
  };
}

describe('groupBattlefieldCards', () => {
  it('stacks matching tokens by name, type line, stats, tap state, and counters', () => {
    const groups = groupBattlefieldCards([
      card({ instanceId: 'goblin-1' }),
      card({ instanceId: 'goblin-2' }),
      card({ instanceId: 'goblin-3', tapped: true }),
      card({ instanceId: 'beast-1', name: 'Beast', typeLine: 'Token Creature - Beast', power: 3, toughness: 3 }),
      card({ instanceId: 'beast-2', name: 'Beast', typeLine: 'Token Creature - Beast', power: 3, toughness: 3 }),
    ], true);

    expect(groups.creatures.map(group => group.cards.map(item => item.instanceId))).toEqual([
      ['goblin-1', 'goblin-2'],
      ['goblin-3'],
      ['beast-1', 'beast-2'],
    ]);
  });

  it('does not stack attached tokens because their board context differs', () => {
    const groups = groupBattlefieldCards([
      card({ instanceId: 'goblin-1', attachedTo: 'bear' }),
      card({ instanceId: 'goblin-2' }),
    ], true);

    expect(groups.creatures).toHaveLength(2);
    expect(groups.creatures.every(group => group.cards.length === 1)).toBe(true);
  });
});

describe('summarizeStateUpdate', () => {
  function update(overrides: Partial<EngineStateUpdate>): EngineStateUpdate {
    return {
      oldStateId: 'old',
      newStateId: 'new',
      activePlayerId: 'p1',
      priorityPlayerId: 'p1',
      phase: 'precombat_main',
      step: 'main',
      turnNumber: 1,
      priority: {
        activePlayerId: 'p1',
        priorityPlayerId: 'p1',
        passedPriorityPlayerIds: [],
        stackSize: 0,
      },
      visibleDiffs: [],
      rulesEvents: [],
      ...overrides,
    };
  }

  it('shows authoritative rejection messages instead of a vague no-op update', () => {
    const text = summarizeStateUpdate(update({
      rulesEvents: [{
        kind: 'ActionRejected',
        requestId: 'req',
        playerId: 'p1',
        actionKind: 'PlayLand',
        reason: 'internal_error',
        message: 'Action resolved without changing authoritative state.',
      }],
    }));

    expect(text).toContain('Rejected PlayLand');
    expect(text).toContain('Action resolved without changing authoritative state.');
    expect(text).not.toContain('no visible board change');
  });

  it('describes prompt acceptance without saying the board did not change', () => {
    const text = summarizeStateUpdate(update({
      rulesEvents: [{
        kind: 'PromptResponseAccepted',
        requestId: 'prompt',
        playerId: 'p1',
        promptKind: 'ChooseReplacement',
        selectedReplacementOptionId: 'enter_tapped',
      }],
    }));

    expect(text).toContain('ChooseReplacement choice accepted');
    expect(text).not.toContain('no visible board change');
  });

  it('labels prompt-only refreshes without implying a board action happened', () => {
    const text = summarizeStateUpdate(update({
      prompt: {
        id: 'prompt',
        type: 'declare-blockers',
        playerId: 'p1',
        title: 'Choose blockers',
        guidance: 'Choose blockers now, or declare no blockers before combat damage.',
        phase: 'combat',
        step: 'declare_blockers',
        stackSize: 0,
        priority: {
          activePlayerId: 'p2',
          priorityPlayerId: 'p2',
          passedPriorityPlayerIds: [],
          stackSize: 0,
        },
        legalChoices: [],
        legalChoiceSummary: [],
        canCancel: true,
        canSubmit: false,
      },
    }));

    expect(text).toContain('Prompt updated');
    expect(text).toContain('Choose blockers');
    expect(text).not.toContain('Engine update');
    expect(text).not.toContain('no visible board change');
  });
});
