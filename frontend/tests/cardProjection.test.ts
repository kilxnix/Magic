import { describe, expect, it } from 'vitest';
import {
  createPlayer,
  registerContinuousEffect,
  type CardDefinition,
  type CardInstance,
  type GameState,
} from 'commander-engine';
import { toSimpleCard } from '../src/hooks/useShelectorGame';

function def(id: string, name: string, typeLine: string, colors: string[], power: number, toughness: number): CardDefinition {
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: '',
    mana_cost: '',
    cmc: 0,
    colors,
    color_identity: colors,
    keywords: [],
    card_types: ['creature'],
    power,
    toughness,
  };
}

function inst(instanceId: string, definitionId: string): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId: 'p1',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  };
}

describe('toSimpleCard', () => {
  it('projects effective battlefield power and toughness for dynamic Sisay-style modifiers', () => {
    const sisay = def('sisay', 'Sisay, Weatherlight Captain', 'Legendary Creature - Human Soldier', ['W'], 2, 2);
    const mahadi = def('mahadi', 'Mahadi, Emporium Master', 'Legendary Creature - Devil', ['B', 'R'], 3, 3);
    let state: GameState = {
      players: [createPlayer('p1', 'Player 1')],
      cards: new Map([
        ['sisay1', inst('sisay1', sisay.id)],
        ['mahadi1', inst('mahadi1', mahadi.id)],
      ]),
      cardDefinitions: new Map([
        [sisay.id, sisay],
        [mahadi.id, mahadi],
      ]),
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'precombat_main',
      step: 'main',
      turnNumber: 1,
      hasPriorityPassed: [false],
      stack: [],
      combat: null,
      battlefieldAbilities: new Map(),
      pendingTriggers: [],
    };

    state = registerContinuousEffect(state, 'sisay1', 'p1', {
      kind: 'StaticAbility',
      modifier: {
        kind: 'ModifyPTByUniqueColorsAmongOtherLegendaryPermanentsYouControl',
        powerPerColor: 1,
        toughnessPerColor: 1,
      },
      filter: {},
      controller: 'any',
      selfOnly: true,
      excludeSelf: false,
    });

    const projected = toSimpleCard(state.cards.get('sisay1')!, sisay, state);

    expect(projected.power).toBe(4);
    expect(projected.toughness).toBe(4);
  });
});
