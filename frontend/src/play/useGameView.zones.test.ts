// frontend/src/play/useGameView.zones.test.ts
import { describe, expect, it } from 'vitest';
import { buildGameView } from './useGameView';
import type { GameViewInput, SimpleGameState } from './gameView.types';

function baseState(): SimpleGameState {
  const player = {
    id: 'p1', name: 'You', life: 40, poisonCounters: 0, commanderDamage: {},
    playerCounters: {}, handCount: 0, libraryCount: 99,
  };
  const card = (id: string, name: string) => ({
    instanceId: id, name, manaCost: '', typeLine: 'Sorcery', oracleText: '',
    keywords: [], tapped: false, zone: 'graveyard' as const, ownerId: 'p1',
    cardTypes: ['sorcery'], isCommander: false, counters: {}, damage: 0, isToken: false,
  });
  return {
    turnNumber: 1, phase: 'precombat_main', step: 'precombat_main',
    activePlayerId: 'p1', priorityPlayerId: 'p1', humanPlayer: player, humanCommander: 'Cmd',
    humanHand: [], humanBattlefield: [], humanGraveyard: [card('g1', 'Cultivate')],
    humanCommandZone: [], humanExile: [card('x1', 'Path to Exile')],
    stack: [], gameOver: false, winnerId: null,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, diceRolls: [], lastDiceRoll: null,
    aiPlayers: [], aiHands: {}, aiBattlefields: {}, aiGraveyards: {}, aiCommandZones: {},
    aiExiles: {}, aiCommanderNames: {},
    aiPlayer: player, aiCommander: '', aiHand: [], aiBattlefield: [],
    aiGraveyard: [], aiCommandZone: [], aiExile: [],
  } as unknown as SimpleGameState;
}

describe('buildGameView zone contents', () => {
  it('maps your graveyard and exile contents to ZoneCardView lists', () => {
    const input: GameViewInput = {
      gameState: baseState(), legalActions: [], isHumanTurn: true, winner: null, guided: false,
    };
    const view = buildGameView(input);
    expect(view.you.graveyard.map(c => c.name)).toEqual(['Cultivate']);
    expect(view.you.exile.map(c => c.name)).toEqual(['Path to Exile']);
    expect(view.you.graveyardCount).toBe(1);
  });
});
