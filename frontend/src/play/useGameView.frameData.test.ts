import { describe, expect, it } from 'vitest';
import { buildGameView } from './useGameView';
import type { GameViewInput, SimpleGameState } from './gameView.types';

function stateWithCreature(): SimpleGameState {
  const player = {
    id: 'p1', name: 'You', life: 40, poisonCounters: 0, commanderDamage: {},
    playerCounters: {}, handCount: 0, libraryCount: 99,
  };
  const bear = {
    instanceId: 'c1', name: 'Grizzly Bears', manaCost: '{1}{G}', typeLine: 'Creature — Bear',
    oracleText: '', keywords: [], power: 2, toughness: 2, tapped: false,
    zone: 'battlefield' as const, ownerId: 'p1', cardTypes: ['creature'],
    isCommander: false, counters: {}, damage: 0, isToken: false,
  };
  return {
    turnNumber: 1, phase: 'precombat_main', step: 'precombat_main',
    activePlayerId: 'p1', priorityPlayerId: 'p1', humanPlayer: player, humanCommander: 'Cmd',
    humanHand: [], humanBattlefield: [bear], humanGraveyard: [],
    humanCommandZone: [], humanExile: [],
    stack: [], gameOver: false, winnerId: null,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, diceRolls: [], lastDiceRoll: null,
    aiPlayers: [], aiHands: {}, aiBattlefields: {}, aiGraveyards: {}, aiCommandZones: {},
    aiExiles: {}, aiCommanderNames: {},
    aiPlayer: player, aiCommander: '', aiHand: [], aiBattlefield: [],
    aiGraveyard: [], aiCommandZone: [], aiExile: [],
  } as unknown as SimpleGameState;
}

describe('buildGameView forwards frame data to permanents', () => {
  it('includes manaCost and derived colorIdentity on battlefield creatures', () => {
    const input: GameViewInput = {
      gameState: stateWithCreature(), legalActions: [], isHumanTurn: true, winner: null, guided: false,
    };
    const view = buildGameView(input);
    const bear = view.you.creatures[0];
    expect(bear.manaCost).toBe('{1}{G}');
    expect(bear.colorIdentity).toEqual(['G']);
    expect(bear.isCommander).toBeFalsy(); // non-commander → absent
  });
});
