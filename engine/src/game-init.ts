/**
 * Game Initialization
 *
 * Initialize a Commander game from generated decks.
 */

import type { GameState, Player, CardInstance, CardDefinition } from './types';
import { createPlayer, emptyManaPool } from './types';
import type { GeneratedDeck, CardLookup, EngineDeck } from './cards/deck-loader';
import { convertGeneratedDeck, convertLimitedDeck } from './cards/deck-loader';
import type { AIPersonality } from './ai/types';
import { hashSeed, randomInt, shuffled, type RngHost } from './rng';
import { registerBattlefieldAbilities, registerContinuousAbilitiesForPermanent } from './stack';
import { getCardDefinition } from './game-state';

/**
 * Coerce an optional seed into a uint32. When no seed is given we draw a fresh
 * random one ONCE (preserving game-to-game variety); it is then stored on the
 * state and serialized, so the game replays deterministically from that point.
 */
function resolveSeed(seed: number | string | undefined): number {
  if (typeof seed === 'number') return seed >>> 0;
  if (typeof seed === 'string') return hashSeed(seed);
  return (Math.floor(Math.random() * 0x100000000) >>> 0);
}

/**
 * Configuration for initializing a game.
 */
export interface GameInitConfig {
  humanDeck: GeneratedDeck;
  aiDecks: GeneratedDeck[];           // 1-3 AI opponents
  aiDifficulty: number;               // bracket 1-5
  aiPersonalities?: AIPersonality[];  // Per-AI personality (defaults to Balanced)
  cardLookup: CardLookup;             // Function to look up card data
  format?: 'commander' | 'limited';   // Default: commander
  humanGoesFirst?: boolean;           // Default: true
  startingLife?: number;              // Default: 40
  startingHandSize?: number;          // Default: 7
  /** Optional deterministic seed (number or string). Omit for a fresh random
   * game; the chosen seed is stored on the state so the game is reproducible. */
  seed?: number | string;
}

/**
 * Extended player with AI-specific fields.
 */
export interface PlayerWithAI extends Player {
  isAI: boolean;
  personality?: AIPersonality;
  difficulty?: number;
}

/**
 * Extended game state with AI tracking.
 */
export interface GameStateWithAI extends GameState {
  players: PlayerWithAI[];
}

/**
 * Generate a unique instance ID.
 */
let instanceCounter = 0;
function generateInstanceId(prefix: string): string {
  return `${prefix}_${++instanceCounter}_${Date.now().toString(36)}`;
}

/**
 * Reset the instance counter (for testing).
 */
export function resetInstanceCounter(): void {
  instanceCounter = 0;
}

/**
 * Shuffle an array using the state's seeded PRNG (Fisher-Yates). Returns a new
 * array; the host's `rngState` advances so the shuffle is reproducible.
 */
function shuffle<T>(host: RngHost, array: T[]): T[] {
  return shuffled(host, array);
}

/**
 * Create a player with their deck setup.
 */
function setupPlayer(
  id: string,
  name: string,
  deck: EngineDeck,
  state: GameState,
  options: {
    isAI: boolean;
    personality?: AIPersonality;
    difficulty?: number;
    startingLife: number;
    startingHandSize: number;
  },
): PlayerWithAI {
  // Create base player
  const player: PlayerWithAI = {
    ...createPlayer(id, name, options.startingLife),
    isAI: options.isAI,
    personality: options.personality,
    difficulty: options.difficulty,
  };

  const commanderDefs = deck.commanders?.length
    ? deck.commanders
    : deck.commander
    ? [deck.commander]
    : [];

  for (const commanderDef of commanderDefs) {
    state.cardDefinitions.set(commanderDef.id, commanderDef);

    const commanderInstanceId = generateInstanceId('cmd');
    const commanderInstance: CardInstance = {
      instanceId: commanderInstanceId,
      definitionId: commanderDef.id,
      ownerId: id,
      zone: 'command',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: true,
    };
    state.cards.set(commanderInstanceId, commanderInstance);
    player.commanderInstanceIds = [...(player.commanderInstanceIds || []), commanderInstanceId];
    player.commanderCastCounts = {
      ...(player.commanderCastCounts || {}),
      [commanderInstanceId]: 0,
    };
    if (!player.commanderInstanceId) {
      player.commanderInstanceId = commanderInstanceId;
    }
  }

  // Add library card definitions
  for (const cardDef of deck.library) {
    if (!state.cardDefinitions.has(cardDef.id)) {
      state.cardDefinitions.set(cardDef.id, cardDef);
    }
  }

  // Register sideboard definitions without creating game objects. Sideboard
  // cards are outside the game until an explicit "outside the game" effect
  // brings one in.
  if (deck.sideboard.length > 0) {
    for (const cardDef of deck.sideboard) {
      if (!state.cardDefinitions.has(cardDef.id)) {
        state.cardDefinitions.set(cardDef.id, cardDef);
      }
    }
    state.sideboards?.set(id, [...deck.sideboard]);
  }

  // Create library instances (shuffled with the state's seeded PRNG)
  const libraryCards = shuffle(state, deck.library);
  const libraryInstanceIds: string[] = [];

  for (const cardDef of libraryCards) {
    const instanceId = generateInstanceId('card');
    const instance: CardInstance = {
      instanceId,
      definitionId: cardDef.id,
      ownerId: id,
      zone: 'library',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    };
    state.cards.set(instanceId, instance);
    libraryInstanceIds.push(instanceId);
  }

  // Draw opening hand (move top N cards from library to hand)
  for (let i = 0; i < options.startingHandSize && i < libraryInstanceIds.length; i++) {
    const instanceId = libraryInstanceIds[i];
    const card = state.cards.get(instanceId)!;
    card.zone = 'hand';
  }

  return player;
}

/**
 * Initialize a game from generated decks.
 *
 * @param config - Game initialization configuration
 * @returns Initialized game state ready to play
 * @throws Error if deck conversion fails or invalid config
 */
export function initGameFromDecks(config: GameInitConfig): GameStateWithAI {
  const {
    humanDeck,
    aiDecks,
    aiDifficulty,
    aiPersonalities = [],
    cardLookup,
    format = 'commander',
    humanGoesFirst = true,
    startingLife = 40,
    startingHandSize = 7,
    seed,
  } = config;

  // Validate AI count
  if (aiDecks.length < 1 || aiDecks.length > 3) {
    throw new Error(`Invalid AI count: expected 1-3, got ${aiDecks.length}`);
  }

  // Validate difficulty
  if (aiDifficulty < 1 || aiDifficulty > 5) {
    throw new Error(`Invalid difficulty: expected 1-5, got ${aiDifficulty}`);
  }

  // Convert decks
  const convertDeck = format === 'limited' ? convertLimitedDeck : convertGeneratedDeck;
  const humanEngineDeck = convertDeck(humanDeck, cardLookup);
  const aiEngineDecks = aiDecks.map(deck => convertDeck(deck, cardLookup));

  // Initialize empty game state
  const state: GameStateWithAI = {
    players: [],
    cards: new Map(),
    cardDefinitions: new Map(),
    sideboards: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'beginning',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    rngState: resolveSeed(seed),
    idCounter: 0,
  };

  // Setup human player first
  const humanPlayer = setupPlayer(
    'human',
    humanDeck.commander, // Use commander name as player name
    humanEngineDeck,
    state,
    {
      isAI: false,
      startingLife,
      startingHandSize,
    },
  );
  state.players.push(humanPlayer);

  // Setup AI players
  for (let i = 0; i < aiDecks.length; i++) {
    const aiId = `ai${i + 1}`;
    const personality = aiPersonalities[i] || 'Balanced';

    const aiPlayer = setupPlayer(
      aiId,
      `${aiDecks[i].commander} (AI)`,
      aiEngineDecks[i],
      state,
      {
        isAI: true,
        personality,
        difficulty: aiDifficulty,
        startingLife,
        startingHandSize,
      },
    );
    state.players.push(aiPlayer);
  }

  // Initialize priority tracking
  state.hasPriorityPassed = state.players.map(() => false);

  // Set starting player
  if (humanGoesFirst) {
    state.activePlayerIndex = 0;
    state.priorityPlayerIndex = 0;
    state.players[0].hasPriority = true;
  } else {
    // Random starting player (seeded so the choice replays)
    state.activePlayerIndex = randomInt(state, state.players.length);
    state.priorityPlayerIndex = state.activePlayerIndex;
    state.players[state.activePlayerIndex].hasPriority = true;
  }

  return state;
}

/**
 * Pre-game actions (CR 103.6): after a player keeps their opening hand, cards
 * that say they may begin the game on the battlefield (the Leyline cycle —
 * every such commander-legal card uses this exact sentence) are put onto the
 * battlefield before the first turn. "You may" is always taken: these cards
 * are strictly beneficial for their controller.
 *
 * Per the official Leyline rulings, permanents that begin the game on the
 * battlefield were never "cast" and do not trigger enters-the-battlefield
 * abilities — so this places them directly and registers their battlefield /
 * continuous abilities without running ETB triggers.
 */
const PREGAME_BATTLEFIELD_SENTENCE =
  'If this card is in your opening hand, you may begin the game with it on the battlefield.';

export function applyPregameActions(
  state: GameState,
  playerId: string,
): { state: GameState; placedCardNames: string[] } {
  let nextState = state;
  const placedCardNames: string[] = [];
  const handCards = [...nextState.cards.values()]
    .filter(card => card.ownerId === playerId && card.zone === 'hand');

  for (const card of handCards) {
    const def = getCardDefinition(nextState, card);
    if (!def.oracle_text || !def.oracle_text.includes(PREGAME_BATTLEFIELD_SENTENCE)) continue;
    card.zone = 'battlefield';
    card.tapped = false;
    card.summoningSick = false; // not a creature in any printed case, but harmless
    nextState = registerBattlefieldAbilities(nextState, card.instanceId);
    nextState = registerContinuousAbilitiesForPermanent(nextState, card.instanceId);
    placedCardNames.push(def.name);
  }

  return { state: nextState, placedCardNames };
}

/**
 * Get the human player from a game state.
 */
export function getHumanPlayer(state: GameStateWithAI): PlayerWithAI | undefined {
  return state.players.find(p => !p.isAI);
}

/**
 * Get all AI players from a game state.
 */
export function getAIPlayers(state: GameStateWithAI): PlayerWithAI[] {
  return state.players.filter(p => p.isAI);
}

/**
 * Check if a player is AI controlled (using GameStateWithAI).
 */
export function isAIControlled(state: GameStateWithAI, playerId: string): boolean {
  const player = state.players.find(p => p.id === playerId);
  return player?.isAI ?? false;
}
