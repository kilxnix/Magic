import { describe, expect, it } from 'vitest';
import { groupBattlefieldCards } from '../src/components/GameBoard';
import type { SimpleCard } from '../src/hooks/useShelectorGame';

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
