import { GameState, CardInstance, CardDefinition, Player, Zone, createPlayer, TriggeredAbilityRef } from './types';

export interface DeckInput {
  playerId: string;
  name: string;
  cards: CardDefinition[];
  commanderId: string;
  sideboardCards?: CardDefinition[];
}

let instanceCounter = 0;
function nextInstanceId(): string {
  return `inst_${++instanceCounter}`;
}

let sideboardInstanceCounter = 0;
function nextSideboardInstanceId(): string {
  return `sideboard_inst_${++sideboardInstanceCounter}_${Date.now().toString(36)}`;
}

export function initGameState(decks: DeckInput[]): GameState {
  instanceCounter = 0;

  const players: Player[] = decks.map(d => createPlayer(d.playerId, d.name));
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();
  const sideboards = new Map<string, CardDefinition[]>();

  // Track commander instance IDs to set on players
  const commanderByPlayer = new Map<string, string>();

  for (const deck of decks) {
    for (const def of deck.cards) {
      cardDefinitions.set(def.id, def);

      const isCommander = def.id === deck.commanderId;
      const instanceId = nextInstanceId();

      const instance: CardInstance = {
        instanceId,
        definitionId: def.id,
        ownerId: deck.playerId,
        zone: isCommander ? 'command' : 'library', // Commander starts in command zone
        tapped: false,
        summoningSick: true,
        counters: {},
        damage: 0,
        isCommander,
      };
      cards.set(instance.instanceId, instance);

      if (isCommander) {
        commanderByPlayer.set(deck.playerId, instanceId);
      }
    }

    if (deck.sideboardCards && deck.sideboardCards.length > 0) {
      for (const def of deck.sideboardCards) {
        cardDefinitions.set(def.id, def);
      }
      sideboards.set(deck.playerId, [...deck.sideboardCards]);
    }
  }

  // Set commander instance IDs on players
  const updatedPlayers = players.map(p => ({
    ...p,
    commanderInstanceId: commanderByPlayer.get(p.id) ?? null,
    commanderInstanceIds: commanderByPlayer.get(p.id) ? [commanderByPlayer.get(p.id)!] : [],
    commanderCastCounts: commanderByPlayer.get(p.id) ? { [commanderByPlayer.get(p.id)!]: 0 } : {},
  }));

  return {
    players: updatedPlayers,
    cards,
    cardDefinitions,
    sideboards,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'beginning',
    step: 'untap',
    turnNumber: 1,
    spellsCastThisTurn: 0,
    hasPriorityPassed: new Array(decks.length).fill(false),
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    delayedTriggers: [],
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

export function getSideboard(state: GameState, playerId: string): CardDefinition[] {
  return state.sideboards?.get(playerId) || [];
}

export type SideboardEntryZone = Extract<Zone, 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile'>;

export interface SideboardEntryOptions {
  libraryPosition?: 'top' | 'bottom';
}

export function moveSideboardCardIntoGame(
  state: GameState,
  playerId: string,
  cardName: string,
  destinationZone: SideboardEntryZone,
  options: SideboardEntryOptions = {},
): GameState {
  const sideboards = new Map(state.sideboards || []);
  const sideboard = [...(sideboards.get(playerId) || [])];
  const sideboardIndex = sideboard.findIndex(card => card.name === cardName);
  if (sideboardIndex < 0) {
    throw new Error(`Sideboard card not found for ${playerId}: ${cardName}`);
  }

  const [cardDef] = sideboard.splice(sideboardIndex, 1);
  sideboards.set(playerId, sideboard);

  const instance = {
    instanceId: nextSideboardInstanceId(),
    definitionId: cardDef.id,
    ownerId: playerId,
    zone: destinationZone,
    tapped: false,
    summoningSick: destinationZone === 'battlefield',
    counters: {},
    damage: 0,
    isCommander: false,
    fromSideboard: true,
  };

  const cardDefinitions = new Map(state.cardDefinitions);
  cardDefinitions.set(cardDef.id, cardDef);

  let cards = new Map(state.cards);
  if (destinationZone === 'library' && options.libraryPosition !== 'bottom') {
    const ordered = new Map<string, CardInstance>();
    for (const [id, card] of cards.entries()) {
      if (card.ownerId === playerId && card.zone === 'library') continue;
      ordered.set(id, card);
    }
    ordered.set(instance.instanceId, instance);
    for (const [id, card] of cards.entries()) {
      if (card.ownerId === playerId && card.zone === 'library') ordered.set(id, card);
    }
    cards = ordered;
  } else {
    cards.set(instance.instanceId, instance);
  }

  return { ...state, cards, cardDefinitions, sideboards };
}

export function returnSideboardCardsToSideboard(state: GameState): GameState {
  const cards = new Map(state.cards);
  const sideboards = new Map(state.sideboards || []);

  for (const [instanceId, card] of state.cards.entries()) {
    if (!card.fromSideboard) continue;
    const def = state.cardDefinitions.get(card.definitionId);
    if (def) {
      const sideboard = [...(sideboards.get(card.ownerId) || [])];
      sideboard.push(def);
      sideboards.set(card.ownerId, sideboard);
    }
    cards.delete(instanceId);
  }

  return { ...state, cards, sideboards };
}

export function getCardDefinition(state: GameState, card: CardInstance): CardDefinition {
  const def = state.cardDefinitions.get(card.definitionId);
  if (!def) throw new Error(`Card definition not found: ${card.definitionId}`);
  return applyFaceToCardDefinition(def, card.activeFaceName);
}

function normalizeFaceName(name: string): string {
  return name.trim().toLowerCase();
}

export function applyFaceToCardDefinition(def: CardDefinition, faceName?: string): CardDefinition {
  if (!faceName || !def.faces?.length) return def;
  const normalized = normalizeFaceName(faceName);
  const face = def.faces.find(candidate => normalizeFaceName(candidate.name) === normalized);
  if (!face) return def;
  return {
    ...def,
    id: face.id,
    name: face.name,
    type_line: face.type_line,
    oracle_text: face.oracle_text,
    mana_cost: face.mana_cost,
    cmc: face.cmc,
    colors: face.colors,
    keywords: face.keywords,
    card_types: face.card_types,
    power: face.power,
    toughness: face.toughness,
    isEquipment: undefined,
    equipCost: undefined,
    equipmentBonus: undefined,
    manaProduction: undefined,
    searchAbility: undefined,
    unlessTax: undefined,
  };
}

export function pruneDetachedEffects(state: GameState): GameState {
  const battlefieldAbilities = new Map<string, TriggeredAbilityRef[]>();
  for (const [instanceId, abilities] of state.battlefieldAbilities || new Map()) {
    const source = state.cards.get(instanceId);
    if (source?.zone === 'battlefield') {
      battlefieldAbilities.set(instanceId, abilities);
    }
  }

  const continuousEffects = (state.continuousEffects || []).filter(effect => {
    const source = state.cards.get(effect.sourceInstanceId);
    return source?.zone === 'battlefield';
  });

  return {
    ...state,
    battlefieldAbilities,
    continuousEffects,
  };
}
