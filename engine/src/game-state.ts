import { GameState, CardInstance, CardDefinition, Player, Zone, createPlayer } from './types';

export interface DeckInput {
  playerId: string;
  name: string;
  cards: CardDefinition[];
  commanderId: string;
}

let instanceCounter = 0;
function nextInstanceId(): string {
  return `inst_${++instanceCounter}`;
}

export function initGameState(decks: DeckInput[]): GameState {
  instanceCounter = 0;

  const players: Player[] = decks.map(d => createPlayer(d.playerId, d.name));
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  for (const deck of decks) {
    for (const def of deck.cards) {
      cardDefinitions.set(def.id, def);

      const instance: CardInstance = {
        instanceId: nextInstanceId(),
        definitionId: def.id,
        ownerId: deck.playerId,
        zone: 'library',
        tapped: false,
        summoningSick: true,
        counters: {},
        damage: 0,
        isCommander: def.id === deck.commanderId,
      };
      cards.set(instance.instanceId, instance);
    }
  }

  return {
    players,
    cards,
    cardDefinitions,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'beginning',
    step: 'untap',
    turnNumber: 1,
    hasPriorityPassed: new Array(decks.length).fill(false),
    stack: [],
  };
}

export function getPlayer(state: GameState, playerId: string): Player {
  const player = state.players.find(p => p.id === playerId);
  if (!player) throw new Error(`Player not found: ${playerId}`);
  return player;
}

export function getActivePlayer(state: GameState): Player {
  return state.players[state.activePlayerIndex];
}

export function getCardsInZone(state: GameState, playerId: string, zone: Zone): CardInstance[] {
  const result: CardInstance[] = [];
  for (const card of state.cards.values()) {
    if (card.ownerId === playerId && card.zone === zone) {
      result.push(card);
    }
  }
  return result;
}

export function getCardDefinition(state: GameState, card: CardInstance): CardDefinition {
  const def = state.cardDefinitions.get(card.definitionId);
  if (!def) throw new Error(`Card definition not found: ${card.definitionId}`);
  return def;
}
