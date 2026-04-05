/**
 * useShelectorGame — manages a game between the human player and the Shelector AI.
 *
 * Uses the real commander-engine for game state, legal actions, mana payment,
 * combat, stack resolution, and AI decision-making.
 * The Shelector /decide API is called in the background purely for narration.
 */

import { useState, useCallback, useRef } from 'react';
import {
  initGameFromDecks,
  getCardsInZone,
  getCardDefinition,
  getPlayer,
  getLegalActions,
  applyAction,
  makeDecision,
  createAIConfig,
  advanceStep,
  performUntapStep,
  drawCards,
  passPriority,
  resolveTopOfStack,
  resolveCombatDamage,
  checkStateBasedActions,
  putTriggersOnStack,
  checkTriggersForEvent,
  parseManaString,
  canPayCost,
  type GameState,
  type GameStateWithAI,
  type CardInstance,
  type CardDefinition,
  type AIAction,
  type ScryfallCard,
  type GeneratedDeck,
  type Zone,
  isTriggeredAbilityStackItem,
  evaluateActions,
  type ManaColor,
  type ManaCost,
  type ManaPool,
  type TriggeredAbilityStackItem,
} from 'commander-engine';

// ========== Simplified Game Types (consumed by GameBoard.tsx) ==========

export interface SimpleCard {
  instanceId: string;
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  power?: number;
  toughness?: number;
  tapped: boolean;
  zone: 'hand' | 'battlefield' | 'graveyard' | 'library' | 'command' | 'exile';
  ownerId: string;
  cardTypes: string[];
  isCommander: boolean;
  counters: Record<string, number>;
  isToken: boolean;
  attachedTo?: string;           // Instance ID of what this is attached to
  attachments?: SimpleCard[];    // Equipment/auras attached to this card
}

export interface SimplePlayer {
  id: string;
  name: string;
  life: number;
  handCount: number;
  libraryCount: number;
}

export interface SimpleGameState {
  turnNumber: number;
  phase: string;
  step: string;
  activePlayerId: string;
  priorityPlayerId: string;
  humanPlayer: SimplePlayer;
  humanCommander: string;
  humanHand: SimpleCard[];
  humanBattlefield: SimpleCard[];
  humanGraveyard: SimpleCard[];
  humanCommandZone: SimpleCard[];
  stack: { id: string; name: string; casterId: string }[];
  gameOver: boolean;
  winnerId: string | null;
  manaPool: { W: number; U: number; B: number; R: number; G: number; C: number };

  // Multiplayer AI support: arrays/records keyed by AI player ID
  aiPlayers: SimplePlayer[];
  aiBattlefields: Record<string, SimpleCard[]>;
  aiGraveyards: Record<string, SimpleCard[]>;
  aiCommandZones: Record<string, SimpleCard[]>;
  aiCommanderNames: Record<string, string>;

  // Backward-compatible single-AI aliases (first AI)
  aiPlayer: SimplePlayer;
  aiCommander: string;
  aiBattlefield: SimpleCard[];
  aiGraveyard: SimpleCard[];
  aiCommandZone: SimpleCard[];
}

export interface SimpleLegalAction {
  kind: string;
  cardInstanceId?: string;
  cardName?: string;
  label: string;
  /** The raw engine action stored for applying back to the engine */
  _engineAction: AIAction;
}

export interface GameLogEntry {
  turnNumber: number;
  player: 'human' | 'ai';
  playerId?: string;     // specific player ID (e.g. 'ai1', 'ai2', 'human')
  action: string;
  phase: string;
  manaAvailable: number;
  manaSpent: number;
  boardCreatureCount: { human: number; ai: number };
  lifeTotals: { human: number; ai: number };
  cardsInHand: { human: number; ai: number };
  timestamp: number;
}

export interface ChatMessage {
  role: 'shelector' | 'system' | 'player';
  text: string;
  timestamp: number;
}

export interface OpponentInfo {
  commander: string;
  colors: string[];
  strategy: string;
  personality: string;
  deckSize: number;
}

export interface SpawnOptions {
  mode: 'random' | 'counter' | 'pool';
  bracket: number;
  avoid_colors: string[];
  human_commander?: string;
  human_colors?: string[];
}

// ========== Types for deck import data ==========

export interface CardDataFromAPI {
  name: string;
  type_line: string;
  mana_cost: string;
  cmc: number;
  oracle_text: string;
  power: string | null;
  toughness: string | null;
  colors: string[];
  color_identity: string[];
  keywords: string[];
}

export interface ImportedCards {
  commander: string;
  cards: string[];
  lands: string[];
  cardData?: Record<string, CardDataFromAPI>;
}

// ========== Helpers ==========

const BASIC_LANDS: Record<string, ScryfallCard> = {
  Plains: {
    id: 'basic-plains', name: 'Plains', type_line: 'Basic Land \u2014 Plains',
    oracle_text: '({T}: Add {W}.)', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['W'], keywords: [],
  },
  Island: {
    id: 'basic-island', name: 'Island', type_line: 'Basic Land \u2014 Island',
    oracle_text: '({T}: Add {U}.)', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['U'], keywords: [],
  },
  Swamp: {
    id: 'basic-swamp', name: 'Swamp', type_line: 'Basic Land \u2014 Swamp',
    oracle_text: '({T}: Add {B}.)', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['B'], keywords: [],
  },
  Mountain: {
    id: 'basic-mountain', name: 'Mountain', type_line: 'Basic Land \u2014 Mountain',
    oracle_text: '({T}: Add {R}.)', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['R'], keywords: [],
  },
  Forest: {
    id: 'basic-forest', name: 'Forest', type_line: 'Basic Land \u2014 Forest',
    oracle_text: '({T}: Add {G}.)', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['G'], keywords: [],
  },
};

/** Convert API card data to ScryfallCard for the engine lookup */
function apiCardToScryfall(name: string, data: CardDataFromAPI): ScryfallCard {
  return {
    id: `api-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
    name: data.name || name,
    type_line: data.type_line || '',
    oracle_text: data.oracle_text || '',
    mana_cost: data.mana_cost || '',
    cmc: data.cmc ?? 0,
    colors: data.colors || [],
    color_identity: data.color_identity || [],
    keywords: data.keywords || [],
    power: data.power ?? undefined,
    toughness: data.toughness ?? undefined,
  };
}

/** Convert engine CardInstance + CardDefinition into a SimpleCard for the UI */
function toSimpleCard(inst: CardInstance, def: CardDefinition): SimpleCard {
  return {
    instanceId: inst.instanceId,
    name: def.name,
    manaCost: def.mana_cost,
    typeLine: def.type_line,
    oracleText: def.oracle_text,
    power: def.power,
    toughness: def.toughness,
    tapped: inst.tapped,
    zone: inst.zone as SimpleCard['zone'],
    ownerId: inst.ownerId,
    cardTypes: def.card_types as string[],
    isCommander: inst.isCommander,
    counters: inst.counters,
    isToken: inst.instanceId.startsWith('token_inst_'),
    attachedTo: inst.attachedTo,
  };
}

/** Pad a card list to exactly 99 with basic lands, or truncate if over */
function padDeckTo99(list: string[], colors: string[]): string[] {
  if (list.length > 99) return list.slice(0, 99);
  const padded = [...list];
  const landOptions = colors
    .map(c => ({ W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }[c]))
    .filter(Boolean) as string[];
  if (landOptions.length === 0) landOptions.push('Forest');
  let i = 0;
  while (padded.length < 99) {
    padded.push(landOptions[i % landOptions.length]);
    i++;
  }
  return padded;
}

/** Map cards in a zone to SimpleCards, with attachment relationships */
function mapCards(engine: GameState, zone: Zone, playerId: string): SimpleCard[] {
  const instances = getCardsInZone(engine, playerId, zone);
  const cards = instances.map(inst => {
    const def = getCardDefinition(engine, inst);
    return toSimpleCard(inst, def);
  });

  // Build attachment relationships for battlefield cards
  if (zone === 'battlefield') {
    const cardMap = new Map(cards.map(c => [c.instanceId, c]));
    for (const card of cards) {
      if (card.attachedTo) {
        const parent = cardMap.get(card.attachedTo);
        if (parent) {
          if (!parent.attachments) parent.attachments = [];
          parent.attachments.push(card);
        }
      }
    }
    // Filter out attached cards from the top-level list (they'll show under their parent)
    return cards.filter(c => !c.attachedTo);
  }

  return cards;
}

/**
 * Check whether the player could cast a spell if they tapped available lands.
 * Returns true if untapped lands + current mana pool can cover the cost.
 */
function couldCastWithLands(state: GameState, playerId: string, manaCost: ManaCost): boolean {
  // Use findLandsToTap for accurate dual-land handling
  // If it can find a valid tapping plan, the spell is castable
  const currentActions = getLegalActions(state, playerId);
  const manaActions = currentActions.filter(
    (a): a is { kind: 'ActivateManaAbility'; cardInstanceId: string; color: ManaColor } =>
      a.kind === 'ActivateManaAbility',
  );
  return findLandsToTap(state, playerId, manaCost, manaActions) !== null;
}

/**
 * Find ActivateManaAbility actions to tap lands to pay for a spell's mana cost.
 * Uses a greedy algorithm: pay colored costs first, then generic.
 * Returns the list of mana ability actions to apply, or null if not possible.
 */
function findLandsToTap(
  state: GameState,
  playerId: string,
  manaCost: ManaCost,
  manaActions: AIAction[],
): AIAction[] | null {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return null;

  // Calculate what we still need after existing mana pool
  const needed: ManaCost = { ...manaCost };
  const pool: ManaPool = { ...player.manaPool };
  const colorSymbols: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

  // Subtract what's already in the pool from what's needed
  for (const color of colorSymbols) {
    const pay = Math.min(pool[color], needed[color]);
    needed[color] -= pay;
    pool[color] -= pay;
  }
  // Use remaining pool for generic
  let genericNeeded = needed.generic;
  for (const color of colorSymbols) {
    const pay = Math.min(pool[color], genericNeeded);
    genericNeeded -= pay;
    pool[color] -= pay;
  }
  needed.generic = genericNeeded;

  // Check if we still need any mana
  const totalNeeded = needed.W + needed.U + needed.B + needed.R + needed.G + needed.C + needed.generic;
  if (totalNeeded === 0) return []; // Already have enough in pool

  // Group mana actions by card instance (a dual land might produce multiple colors)
  const actionsByCard = new Map<string, AIAction[]>();
  for (const action of manaActions) {
    if (action.kind !== 'ActivateManaAbility') continue;
    const list = actionsByCard.get(action.cardInstanceId) || [];
    list.push(action);
    actionsByCard.set(action.cardInstanceId, list);
  }

  const result: AIAction[] = [];
  const usedCards = new Set<string>();

  // First pass: tap lands for specific colored mana needs
  // Prefer single-color producers over dual/multi lands to preserve flexibility
  for (const color of colorSymbols) {
    while (needed[color] > 0) {
      // Sort candidates: fewest color options first (basic land before dual before 5-color)
      const candidates = [...actionsByCard.entries()]
        .filter(([id]) => !usedCards.has(id))
        .filter(([, actions]) => actions.some(a => a.kind === 'ActivateManaAbility' && a.color === color))
        .sort((a, b) => a[1].length - b[1].length);

      if (candidates.length === 0) return null; // Can't pay colored cost

      const [cardId, actions] = candidates[0];
      const matchingAction = actions.find(
        a => a.kind === 'ActivateManaAbility' && a.color === color,
      )!;
      result.push(matchingAction);
      usedCards.add(cardId);
      needed[color]--;
    }
  }

  // Second pass: tap lands for generic mana (prefer lands that only produce colorless)
  while (needed.generic > 0) {
    let found = false;
    // Prefer colorless-only lands first, then any available land
    const cardEntries = [...actionsByCard.entries()].sort((a, b) => {
      // Prefer cards with fewer color options (colorless-only first)
      return a[1].length - b[1].length;
    });
    for (const [cardId, actions] of cardEntries) {
      if (usedCards.has(cardId)) continue;
      if (actions.length > 0) {
        result.push(actions[0]); // Tap for any color
        usedCards.add(cardId);
        needed.generic--;
        found = true;
        break;
      }
    }
    if (!found) return null; // Can't pay generic cost
  }

  return result;
}

/** Format a mana pool as a readable string like "2R 3C" or "empty" */
function formatManaPool(pool: { W: number; U: number; B: number; R: number; G: number; C: number }): string {
  const parts: string[] = [];
  if (pool.W > 0) parts.push(`${pool.W}W`);
  if (pool.U > 0) parts.push(`${pool.U}U`);
  if (pool.B > 0) parts.push(`${pool.B}B`);
  if (pool.R > 0) parts.push(`${pool.R}R`);
  if (pool.G > 0) parts.push(`${pool.G}G`);
  if (pool.C > 0) parts.push(`${pool.C}C`);
  return parts.length > 0 ? parts.join(' ') : 'empty';
}

/** Derive the SimpleGameState for the UI from the engine's GameState */
function deriveSimpleState(
  engine: GameState,
  humanId: string,
  aiIds: string[],
  humanCommanderName: string,
  aiCommanderNames: Record<string, string>,
): SimpleGameState {
  const humanPlayer = getPlayer(engine, humanId);

  const humanHand = mapCards(engine, 'hand', humanId);
  const humanBattlefield = mapCards(engine, 'battlefield', humanId);
  const humanGraveyard = mapCards(engine, 'graveyard', humanId);
  const humanCommandZone = mapCards(engine, 'command', humanId);

  // Build per-AI data
  const aiPlayers: SimplePlayer[] = [];
  const aiBattlefields: Record<string, SimpleCard[]> = {};
  const aiGraveyards: Record<string, SimpleCard[]> = {};
  const aiCommandZones: Record<string, SimpleCard[]> = {};

  for (const aiId of aiIds) {
    const aiP = getPlayer(engine, aiId);
    aiPlayers.push({
      id: aiId,
      name: aiCommanderNames[aiId] || `AI ${aiId}`,
      life: aiP.life,
      handCount: getCardsInZone(engine, aiId, 'hand').length,
      libraryCount: getCardsInZone(engine, aiId, 'library').length,
    });
    aiBattlefields[aiId] = mapCards(engine, 'battlefield', aiId);
    aiGraveyards[aiId] = mapCards(engine, 'graveyard', aiId);
    aiCommandZones[aiId] = mapCards(engine, 'command', aiId);
  }

  // Build stack display
  const stackDisplay = engine.stack.map(item => {
    let name = '(spell/ability)';
    let casterId = '';
    if (item.kind === 'Spell') {
      const inst = engine.cards.get(item.cardInstanceId);
      if (inst) {
        const def = engine.cardDefinitions.get(inst.definitionId);
        name = def?.name || '(unknown spell)';
      }
      casterId = item.casterId;
    } else if (item.kind === 'TriggeredAbility') {
      const inst = engine.cards.get(item.sourceInstanceId);
      if (inst) {
        const def = engine.cardDefinitions.get(inst.definitionId);
        name = `${def?.name || '?'} trigger`;
      }
      casterId = item.controllerId;
    } else if (item.kind === 'ActivatedAbility') {
      const inst = engine.cards.get(item.sourceInstanceId);
      if (inst) {
        const def = engine.cardDefinitions.get(inst.definitionId);
        name = `${def?.name || '?'} ability`;
      }
      casterId = item.controllerId;
    }
    return { id: item.id, name, casterId };
  });

  // Determine game-over: human lost or ALL AIs lost
  const humanLost = humanPlayer.hasLost;
  const allAIsLost = aiIds.every(id => getPlayer(engine, id).hasLost);
  const anyAIAlive = !allAIsLost;
  const gameOver = humanLost || allAIsLost;
  let winnerId: string | null = null;
  if (humanLost && anyAIAlive) winnerId = aiIds[0]; // AI wins
  else if (allAIsLost && !humanLost) winnerId = humanId;

  // Priority player
  const priorityPlayer = engine.players[engine.priorityPlayerIndex];

  // Map phase/step for display
  let displayStep = engine.step as string;
  if (engine.phase === 'precombat_main' || engine.phase === 'postcombat_main') {
    displayStep = 'main';
  }

  // First AI for backward-compatible aliases
  const firstAiId = aiIds[0] || 'ai1';
  const firstAiPlayer = aiPlayers[0] || { id: firstAiId, name: 'AI', life: 40, handCount: 0, libraryCount: 0 };

  // Convert raw turn number to round number (turn 1&2 in 2-player = round 1, etc.)
  const playerCount = engine.players.length;
  const roundNumber = Math.ceil(engine.turnNumber / playerCount);

  return {
    turnNumber: roundNumber,
    phase: engine.phase,
    step: displayStep,
    activePlayerId: engine.players[engine.activePlayerIndex]?.id || humanId,
    priorityPlayerId: priorityPlayer?.id || humanId,
    humanPlayer: {
      id: humanId,
      name: 'You',
      life: humanPlayer.life,
      handCount: getCardsInZone(engine, humanId, 'hand').length,
      libraryCount: getCardsInZone(engine, humanId, 'library').length,
    },
    humanCommander: humanCommanderName,
    humanHand,
    humanBattlefield,
    humanGraveyard,
    humanCommandZone,
    stack: stackDisplay,
    gameOver,
    winnerId,
    manaPool: { ...humanPlayer.manaPool },

    // Multiplayer AI fields
    aiPlayers,
    aiBattlefields,
    aiGraveyards,
    aiCommandZones,
    aiCommanderNames,

    // Backward-compatible single-AI aliases
    aiPlayer: firstAiPlayer,
    aiCommander: aiCommanderNames[firstAiId] || 'AI',
    aiBattlefield: aiBattlefields[firstAiId] || [],
    aiGraveyard: aiGraveyards[firstAiId] || [],
    aiCommandZone: aiCommandZones[firstAiId] || [],
  };
}

/** Capture a game log entry from the current engine state */
function captureLogEntry(
  engine: GameState,
  humanId: string,
  aiIds: string[],
  player: 'human' | 'ai',
  action: string,
  manaSpent: number,
  specificPlayerId?: string,
): GameLogEntry {
  const humanPlayer = engine.players.find(p => p.id === humanId);

  const humanCreatures = getCardsInZone(engine, humanId, 'battlefield')
    .filter(inst => {
      const def = getCardDefinition(engine, inst);
      return def.card_types.includes('creature');
    }).length;

  // Sum all AI creatures across all AI players
  let aiCreatures = 0;
  for (const aiId of aiIds) {
    aiCreatures += getCardsInZone(engine, aiId, 'battlefield')
      .filter(inst => {
        const def = getCardDefinition(engine, inst);
        return def.card_types.includes('creature');
      }).length;
  }

  const totalMana = Object.values(humanPlayer?.manaPool ?? { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })
    .reduce((sum, v) => sum + v, 0);
  const untappedLands = getCardsInZone(engine, humanId, 'battlefield')
    .filter(inst => {
      const def = getCardDefinition(engine, inst);
      return def.card_types.includes('land') && !inst.tapped;
    }).length;

  // Use first AI's life for backward compat
  const firstAi = engine.players.find(p => p.id === (aiIds[0] || 'ai1'));
  const aiTotalHand = aiIds.reduce((sum, id) => sum + getCardsInZone(engine, id, 'hand').length, 0);

  return {
    turnNumber: Math.ceil(engine.turnNumber / engine.players.length),
    player,
    playerId: specificPlayerId || (player === 'human' ? humanId : aiIds[0]),
    action,
    phase: engine.phase,
    manaAvailable: player === 'human' ? totalMana + untappedLands : 0,
    manaSpent,
    boardCreatureCount: { human: humanCreatures, ai: aiCreatures },
    lifeTotals: {
      human: humanPlayer?.life ?? 0,
      ai: firstAi?.life ?? 0,
    },
    cardsInHand: {
      human: getCardsInZone(engine, humanId, 'hand').length,
      ai: aiTotalHand,
    },
    timestamp: Date.now(),
  };
}

/** Convert engine AIAction to SimpleLegalAction for the UI */
function toSimpleLegalAction(action: AIAction, engineState: GameState): SimpleLegalAction {
  switch (action.kind) {
    case 'PlayLand': {
      const inst = engineState.cards.get(action.cardInstanceId);
      const def = inst ? engineState.cardDefinitions.get(inst.definitionId) : undefined;
      return {
        kind: 'PlayLand',
        cardInstanceId: action.cardInstanceId,
        cardName: def?.name,
        label: `Play ${def?.name || 'land'}`,
        _engineAction: action,
      };
    }
    case 'CastSpell': {
      const inst = engineState.cards.get(action.cardInstanceId);
      const def = inst ? engineState.cardDefinitions.get(inst.definitionId) : undefined;
      return {
        kind: 'CastSpell',
        cardInstanceId: action.cardInstanceId,
        cardName: def?.name,
        label: `Cast ${def?.name || 'spell'}`,
        _engineAction: action,
      };
    }
    case 'ActivateManaAbility': {
      const inst = engineState.cards.get(action.cardInstanceId);
      const def = inst ? engineState.cardDefinitions.get(inst.definitionId) : undefined;
      return {
        kind: 'ActivateManaAbility',
        cardInstanceId: action.cardInstanceId,
        cardName: def?.name,
        label: `Tap ${def?.name || 'permanent'} for ${action.color}`,
        _engineAction: action,
      };
    }
    case 'ActivateAbility': {
      const inst = engineState.cards.get(action.cardInstanceId);
      const def = inst ? engineState.cardDefinitions.get(inst.definitionId) : undefined;
      return {
        kind: 'ActivateAbility',
        cardInstanceId: action.cardInstanceId,
        cardName: def?.name,
        label: `Activate ${def?.name || 'ability'}`,
        _engineAction: action,
      };
    }
    case 'DeclareAttackers': {
      const names = action.attacks.map(a => {
        const inst = engineState.cards.get(a.cardInstanceId);
        const def = inst ? engineState.cardDefinitions.get(inst.definitionId) : undefined;
        return def?.name || '?';
      });
      return {
        kind: 'DeclareAttackers',
        label: action.attacks.length > 0
          ? `Attack with ${names.join(', ')}`
          : 'Skip attacks',
        _engineAction: action,
      };
    }
    case 'DeclareBlockers': {
      return {
        kind: 'DeclareBlockers',
        label: action.blocks.length > 0
          ? `Block with ${action.blocks.length} creature(s)`
          : 'No blocks',
        _engineAction: action,
      };
    }
    case 'Equip': {
      const equipInst = engineState.cards.get(action.equipmentInstanceId);
      const equipDef = equipInst ? engineState.cardDefinitions.get(equipInst.definitionId) : undefined;
      const targetInst = engineState.cards.get(action.targetCreatureId);
      const targetDef = targetInst ? engineState.cardDefinitions.get(targetInst.definitionId) : undefined;
      return {
        kind: 'ActivateAbility',
        cardInstanceId: action.equipmentInstanceId,
        cardName: equipDef?.name,
        label: `Equip ${equipDef?.name || 'equipment'} to ${targetDef?.name || 'creature'}`,
        _engineAction: action,
      };
    }
    case 'PassPriority': {
      // Context-aware label
      let label = 'Done';
      if (engineState.stack.length > 0) {
        label = "Don't Respond";
      } else if (engineState.phase === 'precombat_main' || engineState.phase === 'postcombat_main') {
        label = 'End Phase';
      } else if (engineState.step === 'declare_attackers') {
        label = 'Skip Attacks';
      }
      return {
        kind: 'PassPriority',
        label,
        _engineAction: action,
      };
    }
  }
}

// ========== Hook ==========

export function useShelectorGame() {
  const [gameState, setGameState] = useState<SimpleGameState | null>(null);
  const [legalActions, setLegalActions] = useState<SimpleLegalAction[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [opponentInfo, setOpponentInfo] = useState<OpponentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mulliganPhase, setMulliganPhase] = useState(false);
  const [mulliganCount, setMulliganCount] = useState(0);
  const [gameLog, setGameLog] = useState<GameLogEntry[]>([]);
  const [discardPhase, setDiscardPhase] = useState(false);
  const [discardCount, setDiscardCount] = useState(0);
  const [tutorPhase, setTutorPhase] = useState(false);
  const [tutorCards, setTutorCards] = useState<{ instanceId: string; name: string; typeLine: string; manaCost: string }[]>([]);
  const [tutorTitle, setTutorTitle] = useState('');
  const tutorDestinationRef = useRef<string>('hand');
  const [undosRemaining, setUndosRemaining] = useState(10);

  // Undo history — snapshots of engine state + chat messages before each human action
  const undoStackRef = useRef<{ engine: GameStateWithAI; messages: ChatMessage[]; log: GameLogEntry[] }[]>([]);

  // Engine state ref (mutable, not in React state to avoid re-serializing Map objects)
  const engineRef = useRef<GameStateWithAI | null>(null);
  // Keep deck info for mulligan re-init
  const humanDeckRef = useRef<GeneratedDeck | null>(null);
  const aiDecksRef = useRef<GeneratedDeck[]>([]);
  const cardLookupRef = useRef<((name: string) => ScryfallCard | undefined) | null>(null);
  const humanCommanderRef = useRef('Unknown Commander');
  const aiCommanderNamesRef = useRef<Record<string, string>>({ ai1: 'Shelector AI' });
  const humanIdRef = useRef('human');
  const aiIdsRef = useRef<string[]>(['ai1']);
  const discardCountRef = useRef(0);
  const [coachMode, setCoachMode] = useState(true); // On by default — this is a learning tool

  // Track which mana sources were tapped but mana not yet spent on a spell
  // These can be untapped. Once a spell is cast, the taps become "committed" and can't be reversed.
  const uncommittedTapsRef = useRef<Set<string>>(new Set());

  const addMessage = useCallback((role: ChatMessage['role'], text: string) => {
    setChatMessages(prev => [...prev, { role, text, timestamp: Date.now() }]);
  }, []);

  const appendLog = useCallback((entry: GameLogEntry) => {
    setGameLog(prev => [...prev, entry]);
  }, []);

  /** Sync the React state from the engine ref and compute legal actions */
  const syncState = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const humanPlayer = engine.players.find(p => p.id === humanIdRef.current);
    if (humanPlayer) {
      const total = Object.values(humanPlayer.manaPool).reduce((a, b) => a + b, 0);
      if (total > 0) console.log('[syncState] mana pool:', humanPlayer.manaPool);
    }
    const simple = deriveSimpleState(
      engine,
      humanIdRef.current,
      aiIdsRef.current,
      humanCommanderRef.current,
      aiCommanderNamesRef.current,
    );
    setGameState(simple);

    // Compute legal actions for human if they have priority and game not over
    if (!simple.gameOver && simple.priorityPlayerId === humanIdRef.current) {
      const engineActions = getLegalActions(engine, humanIdRef.current);
      const simpleActions = engineActions.map(a => toSimpleLegalAction(a, engine));

      // Add virtual CastSpell actions for cards that could be cast with auto-tap.
      // The engine only returns CastSpell when mana is already in pool.
      // We check each card in hand (and command zone) to see if it could be cast
      // by tapping available lands, and add a synthetic CastSpell action if so.
      const existingCastIds = new Set(
        engineActions
          .filter(a => a.kind === 'CastSpell')
          .map(a => a.cardInstanceId),
      );
      const manaActions = engineActions.filter(a => a.kind === 'ActivateManaAbility');

      const humanId = humanIdRef.current;
      const player = engine.players.find(p => p.id === humanId);
      const playerIndex = engine.players.findIndex(p => p.id === humanId);
      const isMainPhase = engine.phase === 'precombat_main' || engine.phase === 'postcombat_main';

      if (player && manaActions.length > 0) {
        // Check cards in hand
        const hand = getCardsInZone(engine, humanId, 'hand');
        for (const card of hand) {
          if (existingCastIds.has(card.instanceId)) continue; // Already has CastSpell action
          const def = getCardDefinition(engine, card);
          if (def.card_types.includes('land')) continue; // Lands aren't cast

          // Check timing: instants/flash can be cast anytime with priority,
          // sorcery-speed needs main phase + active player + empty stack
          const isInstant = def.card_types.includes('instant');
          const hasFlash = def.keywords.includes('Flash');
          if (!isInstant && !hasFlash) {
            if (engine.activePlayerIndex !== playerIndex) continue;
            if (!isMainPhase) continue;
            if (engine.stack.length > 0) continue;
          }

          // Check if player could pay the cost with available lands
          const baseCost = parseManaString(def.mana_cost);
          if (couldCastWithLands(engine, humanId, baseCost)) {
            // Create a synthetic CastSpell action (no targets for now — simple spells)
            const castAction: AIAction = {
              kind: 'CastSpell',
              cardInstanceId: card.instanceId,
              targets: [],
            };
            simpleActions.push({
              kind: 'CastSpell',
              cardInstanceId: card.instanceId,
              cardName: def.name,
              label: `Cast ${def.name}`,
              _engineAction: castAction,
            });
          }
        }

        // Check command zone (commander)
        const commandZone = getCardsInZone(engine, humanId, 'command');
        for (const card of commandZone) {
          if (existingCastIds.has(card.instanceId)) continue;
          const isCommander = player.commanderInstanceId === card.instanceId;
          if (!isCommander) continue;
          const def = getCardDefinition(engine, card);
          if (def.card_types.includes('land')) continue;

          const isInstant = def.card_types.includes('instant');
          const hasFlash = def.keywords.includes('Flash');
          if (!isInstant && !hasFlash) {
            if (engine.activePlayerIndex !== playerIndex) continue;
            if (!isMainPhase) continue;
            if (engine.stack.length > 0) continue;
          }

          const baseCost = parseManaString(def.mana_cost);
          const taxAmount = player.commanderCastCount * 2;
          const totalCost: ManaCost = { ...baseCost, generic: baseCost.generic + taxAmount };
          if (couldCastWithLands(engine, humanId, totalCost)) {
            const castAction: AIAction = {
              kind: 'CastSpell',
              cardInstanceId: card.instanceId,
              targets: [],
            };
            simpleActions.push({
              kind: 'CastSpell',
              cardInstanceId: card.instanceId,
              cardName: def.name,
              label: `Cast ${def.name}`,
              _engineAction: castAction,
            });
          }
        }
      }

      setLegalActions(simpleActions);
    } else {
      setLegalActions([]);
    }
  }, []);

  /**
   * Narrate meaningful AI decisions into the messages array
   * and accumulate game log entries.
   */
  const narrateDecisions = useCallback(
    (
      decisions: { action: AIAction }[],
      state: GameState,
      messages: { role: ChatMessage['role']; text: string }[],
      logEntries: GameLogEntry[],
    ) => {
      for (const decision of decisions) {
        const a = decision.action;
        let actionText: string | null = null;
        let manaSpent = 0;

        // Get AI's current mana pool for context
        const aiPlayer = state.players.find(p => aiIdsRef.current.includes(p.id));
        const aiPoolStr = aiPlayer ? formatManaPool(aiPlayer.manaPool) : 'empty';

        if (a.kind === 'PlayLand') {
          const inst = state.cards.get(a.cardInstanceId);
          const def = inst ? state.cardDefinitions.get(inst.definitionId) : undefined;
          actionText = `Played ${def?.name || 'a land'}`;
          messages.push({ role: 'shelector', text: `${actionText}.` });
        } else if (a.kind === 'CastSpell') {
          const inst = state.cards.get(a.cardInstanceId);
          const def = inst ? state.cardDefinitions.get(inst.definitionId) : undefined;
          actionText = `Cast ${def?.name || 'a spell'}`;
          const costStr = def?.mana_cost || '?';
          if (def) {
            const cost = parseManaString(def.mana_cost);
            manaSpent = cost.W + cost.U + cost.B + cost.R + cost.G + cost.C + cost.generic;
          }
          messages.push({ role: 'shelector', text: `${actionText} (cost: ${costStr}). Floating: ${aiPoolStr}` });
        } else if (a.kind === 'ActivateManaAbility') {
          const inst = state.cards.get(a.cardInstanceId);
          const def = inst ? state.cardDefinitions.get(inst.definitionId) : undefined;
          messages.push({ role: 'shelector', text: `Tapped ${def?.name || 'a permanent'} for mana. Floating: ${aiPoolStr}` });
        } else if (a.kind === 'DeclareAttackers') {
          if (a.attacks.length > 0) {
            const names = a.attacks.map(atk => {
              const inst = state.cards.get(atk.cardInstanceId);
              const def = inst ? state.cardDefinitions.get(inst.definitionId) : undefined;
              return def?.name || '?';
            });
            actionText = `Attacked with ${names.join(', ')}`;
            messages.push({ role: 'shelector', text: `${actionText}.` });
          }
        } else if (a.kind === 'DeclareBlockers') {
          if (a.blocks.length > 0) {
            actionText = `Blocked with ${a.blocks.length} creature(s)`;
            messages.push({ role: 'shelector', text: `${actionText}.` });
          }
        } else if (a.kind === 'ActivateAbility') {
          const inst = state.cards.get(a.cardInstanceId);
          const def = inst ? state.cardDefinitions.get(inst.definitionId) : undefined;
          actionText = `Activated ${def?.name || 'an ability'}`;
          messages.push({ role: 'shelector', text: `${actionText}.` });
        }

        if (actionText) {
          logEntries.push(captureLogEntry(
            state, humanIdRef.current, aiIdsRef.current,
            'ai', actionText, manaSpent,
          ));
        }
      }
    },
    [],
  );

  /**
   * Run state-based actions, then move any pending triggers onto the stack.
   * Returns the updated state. This is the standard MTG post-action check:
   * SBAs first (creatures die, legend rule, etc.), then triggers queue up.
   */
  const runSBAAndTriggers = useCallback((s: GameState): GameState => {
    let current = s;
    // SBAs may produce triggers, and resolving triggers may cause more SBAs,
    // so loop until stable (with a safety cap).
    let rounds = 10;
    while (rounds-- > 0) {
      current = checkStateBasedActions(current);
      if (current.pendingTriggers.length > 0) {
        current = putTriggersOnStack(current);
        // New stack items mean we should check SBAs again after they resolve,
        // but we don't resolve here — the main loop handles that.
        break;
      }
      // No pending triggers and SBAs didn't change anything — stable.
      break;
    }
    return current;
  }, []);

  /**
   * Check if the top of the stack is a "tax" triggered ability (Rhystic Study,
   * Smothering Tithe, Mystic Remora, etc.) and handle the payment choice.
   *
   * Returns { state, handled, messages } — if handled is true, the trigger was
   * resolved (or skipped due to payment) and shouldn't be resolved again.
   */
  const resolveTaxTrigger = useCallback(
    (
      state: GameState,
      messages: { role: ChatMessage['role']; text: string }[],
    ): { state: GameState; handled: boolean } => {
      if (state.stack.length === 0) return { state, handled: false };

      const top = state.stack[state.stack.length - 1];
      if (!isTriggeredAbilityStackItem(top)) return { state, handled: false };
      const triggerItem = top as TriggeredAbilityStackItem;

      // Check if the source card has a cached unlessTax ability
      const sourceCard = state.cards.get(triggerItem.sourceInstanceId);
      if (!sourceCard) return { state, handled: false };
      const sourceDef = state.cardDefinitions.get(sourceCard.definitionId);
      if (!sourceDef?.unlessTax) return { state, handled: false };

      const taxInfo = sourceDef.unlessTax;

      // Who cast the spell that triggered this?
      const casterId = triggerItem.eventContext?.casterId;
      if (!casterId) {
        // No context — just resolve normally
        return { state, handled: false };
      }

      const caster = state.players.find(p => p.id === casterId);
      if (!caster) return { state, handled: false };

      const controllerId = triggerItem.controllerId;
      const controllerName = controllerId === humanIdRef.current
        ? 'You'
        : aiCommanderNamesRef.current[controllerId] || controllerId;
      const casterName = casterId === humanIdRef.current
        ? 'You'
        : aiCommanderNamesRef.current[casterId] || casterId;

      // Determine if the caster pays
      const totalMana = Object.values(caster.manaPool).reduce((a, b) => a + b, 0);
      let pays = false;

      if (aiIdsRef.current.includes(casterId)) {
        // AI decision: pay if they have enough mana and it's worth it
        pays = totalMana >= taxInfo.taxAmount;
      } else {
        // Human caster: for now, auto-decide based on available mana
        // (TODO: prompt the human with a choice UI)
        pays = totalMana >= taxInfo.taxAmount;
      }

      // Remove the trigger from the stack
      const newStack = state.stack.slice(0, -1);
      let newState: GameState = {
        ...state,
        stack: newStack,
        hasPriorityPassed: new Array(state.players.length).fill(false),
        priorityPlayerIndex: state.activePlayerIndex,
      };

      if (pays) {
        // Deduct mana from caster
        const casterIdx = newState.players.findIndex(p => p.id === casterId);
        let remaining = taxInfo.taxAmount;
        const newPool = { ...caster.manaPool };
        // Pay from colorless first, then any color
        for (const color of ['C', 'W', 'U', 'B', 'R', 'G'] as const) {
          const deduct = Math.min(newPool[color], remaining);
          newPool[color] -= deduct;
          remaining -= deduct;
          if (remaining <= 0) break;
        }
        const newPlayers = newState.players.map((p, i) =>
          i === casterIdx ? { ...p, manaPool: newPool } : p
        );
        newState = { ...newState, players: newPlayers };

        messages.push({
          role: 'system',
          text: `${sourceDef.name}: ${casterName} paid {${taxInfo.taxAmount}} — no effect.`,
        });
      } else {
        // Effect happens — draw card or create treasure
        const drawCount = taxInfo.effectCount ?? 1;
        if (taxInfo.effect === 'draw') {
          newState = drawCards(newState, controllerId, drawCount);
          messages.push({
            role: controllerId === humanIdRef.current ? 'system' : 'shelector',
            text: `${sourceDef.name}: ${casterName} didn't pay {${taxInfo.taxAmount}} — ${controllerName === 'You' ? 'you draw' : controllerName + ' draws'} ${drawCount}.`,
          });
        } else if (taxInfo.effect === 'treasure') {
          // Simplified: create Treasure token(s)
          // Full implementation would create actual Treasure tokens
          messages.push({
            role: controllerId === humanIdRef.current ? 'system' : 'shelector',
            text: `${sourceDef.name}: ${casterName} didn't pay {${taxInfo.taxAmount}} — Treasure token created.`,
          });
        }
      }

      return { state: newState, handled: true };
    },
    [],
  );

  /** Pass priority for all players in the game (multiplayer-safe). */
  const passAllPriority = useCallback((s: GameState): GameState => {
    let current = s;
    const count = current.players.length;
    for (let i = 0; i < count; i++) {
      current = passPriority(current);
    }
    return current;
  }, []);

  /**
   * Core game loop: follows the proven pattern from the integration test.
   *
   * Steps through the turn structure using passPriority() directly for all
   * players (instead of getLegalActions/applyAction) to avoid the infinite-loop
   * bug where DeclareAttackers resets priority.
   */
  const advanceGameLoop = useCallback(
    (currentState: GameState, messages: { role: ChatMessage['role']; text: string }[], logEntries: GameLogEntry[]): GameState => {
      let state = currentState;
      let safety = 200;

      // Run SBAs + triggers on entry (the action that preceded advanceGameLoop
      // may have caused creatures to die, etc.)
      const checkGameOver = (s: GameState): boolean => {
        const humanDead = s.players.find(p => p.id === humanIdRef.current)?.hasLost;
        const allAIDead = aiIdsRef.current.every(id => {
          const p = s.players.find(pl => pl.id === id);
          return p?.hasLost;
        });
        if (humanDead) messages.push({ role: 'system', text: 'You have been defeated!' });
        else if (allAIDead) messages.push({ role: 'system', text: 'Victory! You won the game!' });
        return !!(humanDead || allAIDead);
      };

      /** Check if top of stack is a human spell with searchAbility — show card picker */
      /** Check if top of stack has a search effect from the human — show card picker */
      const tryResolveTutor = (): boolean => {
        if (state.stack.length === 0) return false;
        const top = state.stack[state.stack.length - 1];
        if (!top) return false;

        // Determine if this is a human-controlled search effect
        let controllerId: string | undefined;
        let sourceName = 'Search';
        let searchInfo: typeof Object.prototype | undefined;

        if (top.kind === 'Spell' && top.casterId === humanIdRef.current) {
          // Spell with search (Demonic Tutor, etc.)
          controllerId = top.casterId;
          const tc = state.cards.get(top.cardInstanceId);
          const td = tc ? state.cardDefinitions.get(tc.definitionId) : undefined;
          if (td?.searchAbility) {
            searchInfo = td.searchAbility;
            sourceName = td.name;
          }
        } else if (top.kind === 'ActivatedAbility' && top.controllerId === humanIdRef.current) {
          // Activated ability with search (fetch lands, Sakura-Tribe Elder, etc.)
          controllerId = top.controllerId;
          const sourceCard = state.cards.get(top.sourceInstanceId);
          const sourceDef = sourceCard ? state.cardDefinitions.get(sourceCard.definitionId) : undefined;
          if (sourceDef?.searchAbility) {
            searchInfo = sourceDef.searchAbility;
            sourceName = sourceDef.name;
          }
          // Also check the ability's effects for SearchLibrary
          if (!searchInfo && top.ability) {
            const effects = top.ability.effects as { kind: string }[];
            const hasSearch = effects?.some(e => e.kind === 'SearchLibrary');
            if (hasSearch && sourceDef) {
              // Parse search info from oracle text
              const oracle = sourceDef.oracle_text.toLowerCase();
              let filter: string | undefined;
              if (oracle.includes('basic land')) filter = 'basic land';
              else if (oracle.includes('land')) filter = 'land';
              const destination = oracle.includes('onto the battlefield') ? 'battlefield' as const : 'hand' as const;
              const tapped = oracle.includes('tapped');
              searchInfo = { filter, destination, tapped, shuffle: oracle.includes('shuffle') };
              sourceName = sourceDef.name;
            }
          }
        }

        if (!controllerId || !searchInfo) return false;
        const search = searchInfo as { filter?: string; destination: string; tapped?: boolean; shuffle: boolean };

        // Remove the item from stack
        const newStack = state.stack.slice(0, -1);
        const newCards = new Map(state.cards);

        // For spells, move to graveyard
        if (top.kind === 'Spell') {
          const tc = state.cards.get(top.cardInstanceId);
          if (tc) newCards.set(tc.instanceId, { ...tc, zone: 'graveyard' as Zone });
        }

        state = { ...state, stack: newStack, cards: newCards };
        engineRef.current = state as GameStateWithAI;

        // Build filtered library card list
        const libraryCards = getCardsInZone(state, humanIdRef.current, 'library');
        const pickerCards = libraryCards.map(c => {
          const d = getCardDefinition(state, c);
          return { instanceId: c.instanceId, name: d.name, typeLine: d.type_line, manaCost: d.mana_cost };
        }).filter(c => {
          if (!search.filter) return true;
          return c.typeLine.toLowerCase().includes(search.filter);
        }).sort((a, b) => a.name.localeCompare(b.name));

        tutorDestinationRef.current = search.destination as 'hand' | 'battlefield' | 'top' | 'graveyard';
        const filterDesc = search.filter ? ` for ${search.filter}` : '';
        setTutorTitle(`${sourceName}: Search your library${filterDesc}`);
        setTutorCards(pickerCards);
        setTutorPhase(true);
        messages.push({ role: 'system', text: `${sourceName} — search your library${filterDesc}.` });
        return true;
      };

      state = runSBAAndTriggers(state);
      if (checkGameOver(state)) return state;

      while (safety-- > 0) {
        // Check game over: human lost, or all AIs lost
        const humanLostCheck = state.players.find(p => p.id === humanIdRef.current)?.hasLost;
        const allAIsLostCheck = aiIdsRef.current.every(id => {
          const p = state.players.find(pl => pl.id === id);
          return p?.hasLost;
        });
        if (humanLostCheck || allAIsLostCheck) break;

        console.log(`[LOOP ${200-safety}] step=${state.step} phase=${state.phase} turn=${state.turnNumber} active=${state.players[state.activePlayerIndex]?.id} stack=${state.stack.length}`);

        // Stack resolution with priority passing
        if (state.stack.length > 0) {
          const priorityPlayer = state.players[state.priorityPlayerIndex];

          if (priorityPlayer && priorityPlayer.id === humanIdRef.current) {
            // Human has priority with items on the stack — check if they have INSTANTS
            const humanActions = getLegalActions(state, humanIdRef.current);
            const humanHasInstant = humanActions.some(a =>
              a.kind === 'CastSpell' || a.kind === 'ActivateAbility'
            );
            if (humanHasInstant) {
              console.log(`  -> stack has ${state.stack.length} items, human has instant-speed responses — waiting`);
              break; // Give human priority to respond with counterspells/instants
            }
            // Human has no instants/counterspells — auto-pass their priority
            state = passPriority(state);
            // Check if all players have now passed (stack resolves)
            if (state.hasPriorityPassed.every((p, i) => p || state.players[i].hasLost)) {
              console.log(`  -> all passed, resolving stack (${state.stack.length} items)`);
              if (tryResolveTutor()) break;
              { const taxResult = resolveTaxTrigger(state, messages); if (taxResult.handled) { state = taxResult.state; } else { state = resolveTopOfStack(state); } }
              state = runSBAAndTriggers(state);
              if (checkGameOver(state)) break;
            }
            continue;
          }

          if (priorityPlayer && aiIdsRef.current.includes(priorityPlayer.id)) {
            // AI has priority with items on the stack — let AI decide (may cast instants)
            try {
              const config = createAIConfig(priorityPlayer.id, 3);
              const decision = makeDecision(state, config);

              if (!decision || decision.action.kind === 'PassPriority') {
                // AI passes priority on the stack
                state = passPriority(state);
                // Check if all players have now passed (stack resolves)
                if (state.hasPriorityPassed.every((p, i) => p || state.players[i].hasLost)) {
                  console.log(`  -> all passed, resolving stack (${state.stack.length} items)`);
                  if (tryResolveTutor()) break;
                  { const taxResult = resolveTaxTrigger(state, messages); if (taxResult.handled) { state = taxResult.state; } else { state = resolveTopOfStack(state); } }
                  state = runSBAAndTriggers(state);
                  if (checkGameOver(state)) break;
                }
                continue;
              }

              // AI cast something in response — apply it
              state = decision.newState;
              narrateDecisions([decision], state, messages, logEntries);
              state = runSBAAndTriggers(state);
              if (checkGameOver(state)) break;
              // Loop back — the new spell is on top of the stack,
              // priority resets, and we check again
              continue;
            } catch (aiErr: unknown) {
              console.error('AI stack response error:', aiErr);
              state = passPriority(state);
              continue;
            }
          }

          // Fallback: no valid priority player — just resolve
          console.log(`  -> resolving stack (${state.stack.length} items)`);
          if (tryResolveTutor()) break;
          state = resolveTopOfStack(state);
          state = runSBAAndTriggers(state);
          if (checkGameOver(state)) break;
          continue;
        }

        const activePlayer = state.players[state.activePlayerIndex];
        const activeId = activePlayer.id;
        const isHumanActive = activeId === humanIdRef.current;

        // Step-specific handling
        if (state.step === 'untap') {
          state = performUntapStep(state);
          state = advanceStep(state);
          state = runSBAAndTriggers(state);
          if (checkGameOver(state)) break;
          continue;
        }

        if (state.step === 'draw') {
          state = drawCards(state, activeId, 1);
          state = runSBAAndTriggers(state);
          if (checkGameOver(state)) break;
          // All players pass through draw
          state = passAllPriority(state);
          state = advanceStep(state);
          state = runSBAAndTriggers(state);
          if (checkGameOver(state)) break;
          continue;
        }

        // Main phases (precombat_main or postcombat_main)
        if (state.phase === 'precombat_main' || state.phase === 'postcombat_main') {
          if (isHumanActive) {
            // Check if human already passed priority (from submitAction calling applyAction(PassPriority))
            const humanIdx = state.players.findIndex(p => p.id === humanIdRef.current);
            const humanAlreadyPassed = humanIdx >= 0 && state.hasPriorityPassed[humanIdx];
            if (!humanAlreadyPassed) {
              // Human hasn't passed yet — break and show UI so they can play cards
              break;
            }
            // Human already passed — auto-pass remaining players and advance
            console.log('  -> human passed main phase, auto-passing remaining');
            // Pass for each remaining player who hasn't passed
            for (let pi = 0; pi < state.players.length - 1; pi++) {
              state = passPriority(state);
            }
            state = advanceStep(state);
            state = runSBAAndTriggers(state);
            if (checkGameOver(state)) break;
            continue;
          } else {
            // AI's main phase — make ONE decision at a time so the human
            // can respond to spells with counterspells / instants.
            const currentAiId = activeId;
            try {
              const config = createAIConfig(currentAiId, 3);
              const decision = makeDecision(state, config);

              if (!decision) {
                console.log(`  -> AI (${currentAiId}) main phase: no decision (null)`);
                state = passAllPriority(state);
                state = advanceStep(state);
                state = runSBAAndTriggers(state);
                if (checkGameOver(state)) break;
                continue;
              }

              const action = decision.action;
              const actionInst = 'cardInstanceId' in action ? state.cards.get(action.cardInstanceId) : undefined;
              const actionDef = actionInst ? state.cardDefinitions.get(actionInst.definitionId) : undefined;
              console.log(`  -> AI main phase: ${action.kind}${actionDef ? ' — ' + actionDef.name : ''}`);

              state = decision.newState;

              // Narrate this single decision
              narrateDecisions([decision], state, messages, logEntries);

              // AI actions may cause creatures to die, ETBs to fire, etc.
              state = runSBAAndTriggers(state);
              if (checkGameOver(state)) break;

              if (action.kind === 'PassPriority') {
                // AI passed — pass remaining players and advance
                for (let pi = 0; pi < state.players.length - 1; pi++) {
                  state = passPriority(state);
                }
                state = advanceStep(state);
                state = runSBAAndTriggers(state);
                if (checkGameOver(state)) break;
                continue;
              }

              if (action.kind === 'CastSpell' || action.kind === 'ActivateAbility') {
                if (state.stack.length > 0) {
                  // Check if human has instant-speed cards in hand + available mana
                  // (can't rely on getLegalActions since mana pool may be empty before tapping)
                  const humanIdx = state.players.findIndex(p => p.id === humanIdRef.current);
                  const tempState: GameState = {
                    ...state,
                    priorityPlayerIndex: humanIdx,
                    hasPriorityPassed: state.players.map(() => false),
                  };

                  // Check for instants/flash cards in hand
                  const handCards = getCardsInZone(tempState, humanIdRef.current, 'hand');
                  const hasInstantInHand = handCards.some(card => {
                    const def = getCardDefinition(tempState, card);
                    return def.card_types.includes('instant') || def.keywords.includes('Flash');
                  });

                  // Check for untapped mana sources on battlefield
                  const battlefield = getCardsInZone(tempState, humanIdRef.current, 'battlefield');
                  const hasUntappedMana = battlefield.some(card => {
                    if (card.tapped) return false;
                    const def = getCardDefinition(tempState, card);
                    const oracle = def.oracle_text.toLowerCase();
                    return oracle.includes('{t}:') && oracle.includes('add');
                  });

                  // Also check getLegalActions for abilities that are already castable
                  const humanActions = getLegalActions(tempState, humanIdRef.current);
                  const hasDirectResponse = humanActions.some(a =>
                    a.kind === 'CastSpell' || a.kind === 'ActivateAbility'
                  );

                  const hasInstantResponse = hasDirectResponse || (hasInstantInHand && hasUntappedMana);

                  if (hasInstantResponse) {
                    // Human has counterspells/instants — STOP and let them respond
                    console.log(`  -> AI cast spell, human has instant-speed response — waiting`);
                    const spellInst = 'cardInstanceId' in action ? state.cards.get(action.cardInstanceId) : undefined;
                    const spellDef = spellInst ? state.cardDefinitions.get(spellInst.definitionId) : undefined;
                    messages.push({ role: 'system', text: `⚡ You can respond to ${spellDef?.name || 'the spell'}!` });
                    state = tempState;
                    break;
                  } else {
                    // Human has no instants — auto-pass, don't interrupt
                    console.log(`  -> AI cast spell, human has no responses — auto-resolving`);
                    const spellInst = 'cardInstanceId' in action ? state.cards.get(action.cardInstanceId) : undefined;
                    const spellDef = spellInst ? state.cardDefinitions.get(spellInst.definitionId) : undefined;
                    messages.push({ role: 'system', text: `${spellDef?.name || 'Spell'} — didn't counter (no responses in hand)` });
                  }
                }
              }

              // For non-spell actions (PlayLand, ActivateManaAbility, DeclareAttackers, etc.)
              // continue the loop to let the AI keep going
              continue;
            } catch (aiErr: unknown) {
              console.error(`AI (${currentAiId}) turn error:`, aiErr);
              messages.push({
                role: 'system',
                text: `AI error: ${aiErr instanceof Error ? aiErr.message : 'unknown'}`,
              });
              // On error, pass through to advance
              state = passAllPriority(state);
              state = advanceStep(state);
              state = runSBAAndTriggers(state);
              if (checkGameOver(state)) break;
              continue;
            }
          }
        }

        // Combat steps
        if (
          state.step === 'declare_attackers' ||
          state.step === 'declare_blockers' ||
          state.step === 'first_strike_damage' ||
          state.step === 'combat_damage' ||
          state.step === 'end_of_combat'
        ) {
          // declare_attackers: let human choose or auto-skip
          if (state.step === 'declare_attackers') {
            if (isHumanActive) {
              const actions = getLegalActions(state, humanIdRef.current);
              const hasRealAttacks = actions.some(
                a => a.kind === 'DeclareAttackers' && a.attacks.length > 0,
              );
              if (hasRealAttacks) {
                break; // Show attack UI to human
              }
              // No creatures to attack with — declare empty attackers via applyAction
              const emptyAttack = actions.find(a => a.kind === 'DeclareAttackers' && a.attacks.length === 0);
              if (emptyAttack) {
                state = applyAction(state, humanIdRef.current, emptyAttack);
              }
            } else {
              // AI declares attackers
              try {
                const config = createAIConfig(activeId, 3);
                const decision = makeDecision(state, config);
                if (decision && decision.action.kind === 'DeclareAttackers' && decision.action.attacks.length > 0) {
                  state = decision.newState;
                  narrateDecisions([decision], state, messages, logEntries);
                  state = runSBAAndTriggers(state);
                  if (checkGameOver(state)) break;
                }
              } catch (aiErr: unknown) {
                console.error('AI attack declaration error:', aiErr);
              }
            }
            // After attackers declared (or AI handled it), pass priority through
            state = passAllPriority(state);
            state = advanceStep(state);
            state = runSBAAndTriggers(state);
            if (checkGameOver(state)) break;
            continue;
          }

          // declare_blockers: auto-handle (AI blocks via runAITurn if it has priority)
          if (state.step === 'declare_blockers') {
            if (state.combat && state.combat.attackers.length > 0) {
              // There are attackers — each non-active player needs to declare blockers
              // In multiplayer, each defender gets a chance
              const activeId2 = state.players[state.activePlayerIndex].id;
              const defenders = state.players
                .filter(p => p.id !== activeId2 && !p.hasLost)
                .map(p => p.id);
              for (const defenderId of defenders) {
                const blockActions = getLegalActions(state, defenderId);
                const noBlock = blockActions.find(a => a.kind === 'DeclareBlockers' && a.blocks.length === 0);
                if (noBlock) {
                  state = applyAction(state, defenderId, noBlock);
                }
              }
            }
            state = passAllPriority(state);
            state = advanceStep(state);
            state = runSBAAndTriggers(state);
            if (checkGameOver(state)) break;
            continue;
          }

          // combat_damage: resolve damage if attackers exist
          if (state.step === 'combat_damage') {
            if (state.combat && state.combat.attackers.length > 0) {
              try {
                state = resolveCombatDamage(state);
                console.log('  -> resolved combat damage');
                // Combat damage may kill creatures — check SBAs and triggers
                state = runSBAAndTriggers(state);
                for (const p of state.players) {
                  const name = p.id === humanIdRef.current ? 'You' : (aiCommanderNamesRef.current[p.id] || p.id);
                  if (p.hasLost) {
                    messages.push({ role: 'system', text: `${name} ${p.id === humanIdRef.current ? 'have' : 'has'} been eliminated! (Life: ${p.life})` });
                  } else if (p.life < 40) {
                    messages.push({ role: 'system', text: `${name}: Life ${p.life}` });
                  }
                }
                if (checkGameOver(state)) break;
              } catch (e) {
                console.error('Combat damage error:', e);
              }
            }
            state = passAllPriority(state);
            state = advanceStep(state);
            state = runSBAAndTriggers(state);
            if (checkGameOver(state)) break;
            continue;
          }

          // first_strike_damage, end_of_combat: just pass through
          state = passAllPriority(state);
          state = advanceStep(state);
          state = runSBAAndTriggers(state);
          if (checkGameOver(state)) break;
          continue;
        }

        // Upkeep, end step, cleanup — pass through
        if (state.step === 'upkeep' || state.step === 'end' || state.step === 'cleanup') {
          if (state.step === 'cleanup') {
            // Discard to hand size (max 7) for the active player
            const activePlayer = state.players[state.activePlayerIndex];
            const activeId = activePlayer.id;
            const handCards = getCardsInZone(state, activeId, 'hand');

            if (handCards.length > 7) {
              const excess = handCards.length - 7;

              if (activeId === humanIdRef.current) {
                // Human must choose which cards to discard — pause the loop
                discardCountRef.current = excess;
                setDiscardCount(excess);
                setDiscardPhase(true);
                messages.push({
                  role: 'system',
                  text: `Discard ${excess} card${excess > 1 ? 's' : ''} to hand size (7).`,
                });
                break;
              } else {
                // AI auto-discards: drop highest-CMC non-land cards first
                const sorted = [...handCards].sort((a, b) => {
                  const defA = getCardDefinition(state, a);
                  const defB = getCardDefinition(state, b);
                  return defB.cmc - defA.cmc; // highest CMC first
                });
                const toDiscard = sorted.slice(0, excess);
                const newCards = new Map(state.cards);
                for (const card of toDiscard) {
                  newCards.set(card.instanceId, { ...card, zone: 'graveyard' as Zone });
                  const def = getCardDefinition(state, card);
                  messages.push({ role: 'shelector', text: `Discarded ${def.name}.` });
                }
                state = { ...state, cards: newCards };
              }
            }

            const oldTurn = state.turnNumber;
            state = advanceStep(state);
            state = runSBAAndTriggers(state);
            if (checkGameOver(state)) break;
            if (state.turnNumber !== oldTurn) {
              uncommittedTapsRef.current.clear(); // New turn — reset tap tracking
              const newActive = state.players[state.activePlayerIndex];
              const isNewActiveHuman = newActive.id === humanIdRef.current;
              const activeName = isNewActiveHuman
                ? 'Your'
                : `${aiCommanderNamesRef.current[newActive.id] || newActive.id}'s`;
              messages.push({
                role: 'system',
                text: `Turn ${Math.ceil(state.turnNumber / state.players.length)} \u2014 ${activeName} turn.`,
              });
            }
            continue;
          }
          // Fire upkeep/end-step triggers before passing priority
          if (state.step === 'upkeep') {
            state = checkTriggersForEvent(state, {
              kind: 'UpkeepStart',
              activePlayerId: state.players[state.activePlayerIndex].id,
            });
          }
          if (state.step === 'end') {
            state = checkTriggersForEvent(state, {
              kind: 'EndStepStart',
              activePlayerId: state.players[state.activePlayerIndex].id,
            });
          }
          state = passAllPriority(state);
          state = advanceStep(state);
          // Upkeep/end-step triggers fire here
          state = runSBAAndTriggers(state);
          if (checkGameOver(state)) break;
          continue;
        }

        // Fallback — pass through
        state = passAllPriority(state);
        state = advanceStep(state);
        state = runSBAAndTriggers(state);
        if (checkGameOver(state)) break;
        continue;
      }

      return state;
    },
    [narrateDecisions, runSBAAndTriggers, passAllPriority],
  );

  // Spawn opponent via the Shelector API
  const spawnOpponent = useCallback(async (options?: SpawnOptions) => {
    setIsLoading(true);
    setError(null);
    try {
      const payload = {
        bracket: options?.bracket ?? 3,
        avoid_colors: options?.avoid_colors ?? [],
        mode: options?.mode ?? 'random',
        human_commander: options?.human_commander ?? null,
        human_colors: options?.human_colors ?? null,
      };
      const res = await fetch('http://localhost:8100/spawn-opponent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Spawn failed: ${res.status}`);
      const data = await res.json();
      setOpponentInfo({
        commander: data.commander || 'Unknown Commander',
        colors: data.colors || [],
        strategy: data.strategy || 'midrange',
        personality: data.personality || 'Balanced',
        deckSize: data.deck_size || 100,
      });
      addMessage('system', `Opponent spawned: ${data.commander || 'Unknown Commander'}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to spawn opponent';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [addMessage]);

  /** Build a CardLookup from API card data (human deck + AI deck) */
  const buildCardLookup = useCallback(
    (cardDataMaps: Record<string, CardDataFromAPI>[]): ((name: string) => ScryfallCard | undefined) => {
      const byName = new Map<string, ScryfallCard>();
      // Add basic lands
      for (const [name, card] of Object.entries(BASIC_LANDS)) {
        byName.set(name, card);
        byName.set(name.toLowerCase(), card);
      }
      // Add API cards
      for (const dataMap of cardDataMaps) {
        for (const [name, data] of Object.entries(dataMap)) {
          const scryfallCard = apiCardToScryfall(name, data);
          byName.set(name, scryfallCard);
          byName.set(name.toLowerCase(), scryfallCard);
          if (data.name && data.name !== name) {
            byName.set(data.name, scryfallCard);
            byName.set(data.name.toLowerCase(), scryfallCard);
          }
        }
      }
      return (name: string) => byName.get(name) || byName.get(name.toLowerCase());
    },
    [],
  );

  /** Initialize engine and draw opening hands */
  const initEngine = useCallback(
    (
      humanDeck: GeneratedDeck,
      aiDecks: GeneratedDeck[],
      lookup: (name: string) => ScryfallCard | undefined,
    ): GameStateWithAI => {
      return initGameFromDecks({
        humanDeck,
        aiDecks,
        aiDifficulty: 3,
        cardLookup: lookup,
        humanGoesFirst: true,
        startingLife: 40,
        startingHandSize: 7,
      });
    },
    [],
  );

  // Initialize a new game with real decks for all players
  const startGame = useCallback(
    (importedCards?: ImportedCards, aiDeckDataArray?: ImportedCards | ImportedCards[]) => {
      setError(null);
      setChatMessages([]);
      setGameLog([]);

      // Normalize aiDeckDataArray to always be an array
      const aiDeckDatas: (ImportedCards | undefined)[] = aiDeckDataArray
        ? Array.isArray(aiDeckDataArray) ? aiDeckDataArray : [aiDeckDataArray]
        : [undefined];

      // Determine human deck info
      const humanCommanderName = importedCards?.commander || 'Unknown Commander';
      const humanCards = importedCards ? [...importedCards.cards, ...importedCards.lands] : [];
      const humanColors = importedCards?.cardData
        ? Array.from(
            new Set(
              Object.values(importedCards.cardData).flatMap(d => d.color_identity || []),
            ),
          )
        : ['G'];

      // Build card lookup from all available card data
      const dataMaps: Record<string, CardDataFromAPI>[] = [];
      if (importedCards?.cardData) dataMaps.push(importedCards.cardData);

      // Build AI decks
      const aiDecks: GeneratedDeck[] = [];
      const aiIds: string[] = [];
      const aiCmdNames: Record<string, string> = {};

      // If we have opponentInfos (from ShelectorGamePage), use them for fallback
      const opponentInfoArr = opponentInfo ? [opponentInfo] : [];

      for (let i = 0; i < aiDeckDatas.length; i++) {
        const aiData = aiDeckDatas[i];
        const fallbackInfo = opponentInfoArr[i] || opponentInfo;
        const aiId = `ai${i + 1}`;
        aiIds.push(aiId);

        const aiCommanderName = aiData?.commander || fallbackInfo?.commander || `Shelector AI ${i + 1}`;
        aiCmdNames[aiId] = aiCommanderName;

        const aiCards = aiData ? [...aiData.cards, ...aiData.lands] : [];
        const aiColors = aiData?.cardData
          ? Array.from(
              new Set(
                Object.values(aiData.cardData).flatMap(d => d.color_identity || []),
              ),
            )
          : fallbackInfo?.colors || ['B', 'R'];

        if (aiData?.cardData) dataMaps.push(aiData.cardData);

        const aiList = padDeckTo99(
          aiCards.filter(n => n.toLowerCase() !== aiCommanderName.toLowerCase()),
          aiColors,
        );

        aiDecks.push({
          id: `ai-deck-${i + 1}`,
          commander: aiCommanderName,
          list: aiList,
          colors: aiColors,
          bracket: 3,
          theme: '',
        });
      }

      const lookup = buildCardLookup(dataMaps);

      // Pad human deck to exactly 99 cards (excluding commander)
      const humanList = padDeckTo99(
        humanCards.filter(n => n.toLowerCase() !== humanCommanderName.toLowerCase()),
        humanColors,
      );

      const humanDeck: GeneratedDeck = {
        id: 'human-deck',
        commander: humanCommanderName,
        list: humanList,
        colors: humanColors,
        bracket: 3,
        theme: '',
      };

      // Store for mulligan re-init
      humanDeckRef.current = humanDeck;
      aiDecksRef.current = aiDecks;
      cardLookupRef.current = lookup;
      humanCommanderRef.current = humanCommanderName;
      aiCommanderNamesRef.current = aiCmdNames;
      humanIdRef.current = 'human';
      aiIdsRef.current = aiIds;

      try {
        const engine = initEngine(humanDeck, aiDecks, lookup);
        engineRef.current = engine;

        setMulliganPhase(true);
        setMulliganCount(0);

        // Derive display state
        const simple = deriveSimpleState(
          engine, humanIdRef.current, aiIdsRef.current,
          humanCommanderName, aiCmdNames,
        );
        setGameState(simple);
        setLegalActions([]);

        addMessage('system', 'Opening hands drawn. Mulligan phase.');
        for (const aiId of aiIds) {
          addMessage('shelector', `${aiCmdNames[aiId]} keeps their hand.`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to initialize game';
        setError(msg);
        console.error('Engine init error:', err);
      }
    },
    [opponentInfo, addMessage, buildCardLookup, initEngine],
  );

  /** Advance engine past beginning phase to precombat main for turn start */
  const advanceToPrecombatMain = useCallback((engine: GameState): GameState => {
    let current = engine;
    let safety = 20;
    while (current.phase === 'beginning' && safety-- > 0) {
      if (current.step === 'untap') {
        current = performUntapStep(current);
      }
      if (current.step === 'draw') {
        const activePlayer = current.players[current.activePlayerIndex];
        current = drawCards(current, activePlayer.id, 1);
      }
      current = advanceStep(current);
    }
    return current;
  }, []);

  // Keep hand -- end mulligan phase, proceed to normal gameplay
  const keepHand = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    setMulliganPhase(false);

    if (mulliganCount > 0) {
      const handCards = getCardsInZone(engine, humanIdRef.current, 'hand');
      const cardsToBottom = Math.min(mulliganCount, handCards.length);
      for (let i = 0; i < cardsToBottom; i++) {
        const card = handCards[handCards.length - 1 - i];
        if (card) card.zone = 'library';
      }
      addMessage(
        'player',
        `Keeping ${handCards.length - cardsToBottom} cards (mulliganed ${cardsToBottom} time${cardsToBottom > 1 ? 's' : ''}).`,
      );
    } else {
      addMessage('player', 'Keeping opening hand.');
    }

    addMessage('system', 'Game started! You are on the play.');
    addMessage('system', `Turn 1 \u2014 Your precombat main phase.`);

    // Advance engine to precombat main
    const advanced = advanceToPrecombatMain(engine);
    engineRef.current = advanced as GameStateWithAI;

    syncState();
  }, [mulliganCount, addMessage, syncState, advanceToPrecombatMain]);

  // Mulligan -- re-init the engine with fresh shuffled decks
  const mulligan = useCallback(() => {
    const humanDeck = humanDeckRef.current;
    const aiDecks = aiDecksRef.current;
    const lookup = cardLookupRef.current;
    if (!humanDeck || !aiDecks || aiDecks.length === 0 || !lookup) return;

    const newMulliganCount = mulliganCount + 1;
    setMulliganCount(newMulliganCount);

    try {
      const newEngine = initEngine(humanDeck, aiDecks, lookup);
      engineRef.current = newEngine;

      // Auto-keep after 3 mulligans
      if (newMulliganCount >= 3) {
        const handCards = getCardsInZone(newEngine, humanIdRef.current, 'hand');
        const cardsToBottom = Math.min(newMulliganCount, handCards.length);
        for (let i = 0; i < cardsToBottom; i++) {
          const card = handCards[handCards.length - 1 - i];
          if (card) card.zone = 'library';
        }

        setMulliganPhase(false);

        const advanced = advanceToPrecombatMain(newEngine);
        engineRef.current = advanced as GameStateWithAI;

        syncState();

        addMessage(
          'player',
          `Mulliganed to ${handCards.length - cardsToBottom} (auto-kept after 3 mulligans).`,
        );
        addMessage('system', 'Game started! You are on the play.');
        addMessage('system', `Turn 1 \u2014 Your precombat main phase.`);
        return;
      }

      // Show new hand
      const simple = deriveSimpleState(
        newEngine, humanIdRef.current, aiIdsRef.current,
        humanCommanderRef.current, aiCommanderNamesRef.current,
      );
      setGameState(simple);

      addMessage(
        'player',
        `Mulligan #${newMulliganCount}. Drawing a new hand of 7 (will put ${newMulliganCount} on bottom).`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Mulligan failed';
      setError(msg);
      console.error('Mulligan error:', err);
    }
  }, [mulliganCount, addMessage, initEngine, syncState, advanceToPrecombatMain]);

  // Discard a card from hand (during cleanup discard-to-hand-size)
  const discardCard = useCallback(
    (cardInstanceId: string) => {
      const engine = engineRef.current;
      if (!engine || !discardPhase) return;

      const card = engine.cards.get(cardInstanceId);
      if (!card || card.zone !== 'hand' || card.ownerId !== humanIdRef.current) return;

      const def = getCardDefinition(engine, card);
      const newCards = new Map(engine.cards);
      newCards.set(cardInstanceId, { ...card, zone: 'graveyard' as Zone });
      const newEngine = { ...engine, cards: newCards } as GameStateWithAI;
      engineRef.current = newEngine;

      addMessage('player', `Discarded ${def.name}.`);

      discardCountRef.current -= 1;
      setDiscardCount(discardCountRef.current);

      if (discardCountRef.current <= 0) {
        // Done discarding — continue the game loop
        setDiscardPhase(false);

        // Advance past cleanup to next turn
        const loopMessages: { role: ChatMessage['role']; text: string }[] = [];
        const loopLogEntries: GameLogEntry[] = [];
        let state: GameState = newEngine;
        const oldTurn = state.turnNumber;
        state = advanceStep(state);
        state = runSBAAndTriggers(state);
        if (state.turnNumber !== oldTurn) {
          const newActive = state.players[state.activePlayerIndex];
          const isNewActiveHuman = newActive.id === humanIdRef.current;
          const activeName = isNewActiveHuman
            ? 'Your'
            : `${aiCommanderNamesRef.current[newActive.id] || newActive.id}'s`;
          loopMessages.push({
            role: 'system',
            text: `Turn ${state.turnNumber} \u2014 ${activeName} turn.`,
          });
        }
        // Continue the game loop for AI turns etc.
        state = advanceGameLoop(state, loopMessages, loopLogEntries);
        engineRef.current = state as GameStateWithAI;

        for (const msg of loopMessages) {
          addMessage(msg.role, msg.text);
        }
        if (loopLogEntries.length > 0) {
          setGameLog(prev => [...prev, ...loopLogEntries]);
        }
      }

      syncState();
    },
    [discardPhase, addMessage, syncState, advanceGameLoop],
  );

  const resolveTutor = useCallback((cardInstanceId: string) => {
    const engine = engineRef.current;
    if (!engine) return;

    const card = engine.cards.get(cardInstanceId);
    if (!card) return;
    const def = engine.cardDefinitions.get(card.definitionId);
    const cardName = def?.name || 'a card';

    // Determine destination from the tutor's oracle text
    const dest = tutorDestinationRef.current;
    const newCards = new Map(engine.cards);

    if (dest === 'top') {
      // Put on top of library — move to front of library iteration order
      // First collect all library cards except the chosen one
      const libEntries: [string, CardInstance][] = [];
      const otherEntries: [string, CardInstance][] = [];
      for (const [id, c] of newCards) {
        if (id === cardInstanceId) continue; // skip chosen card
        if (c.ownerId === humanIdRef.current && c.zone === 'library') {
          libEntries.push([id, c]);
        } else {
          otherEntries.push([id, c]);
        }
      }
      // Put chosen card first in library order, then shuffle the rest
      for (let i = libEntries.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [libEntries[i], libEntries[j]] = [libEntries[j], libEntries[i]];
      }
      const shuffledCards = new Map([...otherEntries, [cardInstanceId, card] as [string, CardInstance], ...libEntries]);
      const newEngine = { ...engine, cards: shuffledCards } as GameStateWithAI;
      engineRef.current = newEngine;
      addMessage('player', `Found ${cardName} and put it on top of library. Library shuffled.`);
    } else if (dest === 'battlefield') {
      // Put onto battlefield
      newCards.set(cardInstanceId, { ...card, zone: 'battlefield' as Zone, tapped: false, summoningSick: true });
      // Shuffle remaining library
      const libEntries: [string, CardInstance][] = [];
      const otherEntries: [string, CardInstance][] = [];
      for (const [id, c] of newCards) {
        if (c.ownerId === humanIdRef.current && c.zone === 'library') {
          libEntries.push([id, c]);
        } else {
          otherEntries.push([id, c]);
        }
      }
      for (let i = libEntries.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [libEntries[i], libEntries[j]] = [libEntries[j], libEntries[i]];
      }
      const shuffledCards = new Map([...otherEntries, ...libEntries]);
      const newEngine = { ...engine, cards: shuffledCards } as GameStateWithAI;
      engineRef.current = newEngine;
      addMessage('player', `Found ${cardName} and put it onto the battlefield. Library shuffled.`);
    } else if (dest === 'graveyard') {
      newCards.set(cardInstanceId, { ...card, zone: 'graveyard' as Zone });
      const libEntries: [string, CardInstance][] = [];
      const otherEntries: [string, CardInstance][] = [];
      for (const [id, c] of newCards) {
        if (c.ownerId === humanIdRef.current && c.zone === 'library') {
          libEntries.push([id, c]);
        } else {
          otherEntries.push([id, c]);
        }
      }
      for (let i = libEntries.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [libEntries[i], libEntries[j]] = [libEntries[j], libEntries[i]];
      }
      const shuffledCards = new Map([...otherEntries, ...libEntries]);
      const newEngine = { ...engine, cards: shuffledCards } as GameStateWithAI;
      engineRef.current = newEngine;
      addMessage('player', `Found ${cardName} and put it into graveyard. Library shuffled.`);
    } else {
      // Default: hand
      newCards.set(cardInstanceId, { ...card, zone: 'hand' as Zone });
      const libEntries: [string, CardInstance][] = [];
      const otherEntries: [string, CardInstance][] = [];
      for (const [id, c] of newCards) {
        if (c.ownerId === humanIdRef.current && c.zone === 'library') {
          libEntries.push([id, c]);
        } else {
          otherEntries.push([id, c]);
        }
      }
      for (let i = libEntries.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [libEntries[i], libEntries[j]] = [libEntries[j], libEntries[i]];
      }
      const shuffledCards = new Map([...otherEntries, ...libEntries]);
      const newEngine = { ...engine, cards: shuffledCards } as GameStateWithAI;
      engineRef.current = newEngine;
      addMessage('player', `Found ${cardName} and put it into hand. Library shuffled.`);
    }
    setTutorPhase(false);
    setTutorCards([]);

    // Continue game loop
    const loopMessages: { role: ChatMessage['role']; text: string }[] = [];
    const loopLogEntries: GameLogEntry[] = [];
    let state: GameState = advanceGameLoop(engineRef.current!, loopMessages, loopLogEntries);
    engineRef.current = state as GameStateWithAI;
    for (const msg of loopMessages) addMessage(msg.role, msg.text);
    if (loopLogEntries.length > 0) setGameLog(prev => [...prev, ...loopLogEntries]);

    syncState();
  }, [addMessage, syncState, advanceGameLoop]);

  // Undo last human action
  const undoAction = useCallback(() => {
    if (undosRemaining <= 0 || undoStackRef.current.length === 0) return;

    const snapshot = undoStackRef.current.pop()!;
    engineRef.current = snapshot.engine;
    setChatMessages([...snapshot.messages, { role: 'system', text: `Undo! (${undosRemaining - 1} remaining)`, timestamp: Date.now() }]);
    setGameLog(snapshot.log);
    setUndosRemaining(prev => prev - 1);

    // Clear any special phases
    setDiscardPhase(false);
    setTutorPhase(false);

    syncState();
  }, [undosRemaining, syncState]);

  // Untap a mana source — only if the mana hasn't been spent on a spell yet
  const untapManaSource = useCallback((cardInstanceId: string) => {
    const engine = engineRef.current;
    if (!engine) return;

    // Only allow untapping uncommitted taps (mana not yet spent on a spell)
    if (!uncommittedTapsRef.current.has(cardInstanceId)) return;

    const card = engine.cards.get(cardInstanceId);
    if (!card || !card.tapped || card.zone !== 'battlefield' || card.ownerId !== humanIdRef.current) return;

    const def = engine.cardDefinitions.get(card.definitionId);
    if (!def) return;

    // Untap the card
    const newCards = new Map(engine.cards);
    newCards.set(cardInstanceId, { ...card, tapped: false });

    // Remove the mana it produced from the pool
    const playerIdx = engine.players.findIndex(p => p.id === humanIdRef.current);
    const player = engine.players[playerIdx];
    const newPool = { ...player.manaPool };

    if (def.manaProduction) {
      for (const [color, amount] of Object.entries(def.manaProduction.amounts)) {
        const c = color as keyof typeof newPool;
        newPool[c] = Math.max(0, newPool[c] - amount);
      }
    } else {
      // Fallback: remove 1 of whatever color seems right from oracle text
      const oracle = def.oracle_text.toLowerCase();
      for (const [sym, c] of [['w','W'],['u','U'],['b','B'],['r','R'],['g','G'],['c','C']] as const) {
        if (oracle.includes(`{${sym}}`)) {
          newPool[c as keyof typeof newPool] = Math.max(0, newPool[c as keyof typeof newPool] - 1);
          break;
        }
      }
    }

    const newPlayers = engine.players.map((p, i) =>
      i === playerIdx ? { ...p, manaPool: newPool } : p
    );

    const newEngine = { ...engine, cards: newCards, players: newPlayers } as GameStateWithAI;
    engineRef.current = newEngine;

    uncommittedTapsRef.current.delete(cardInstanceId);
    addMessage('player', `Untapped ${def.name}. Floating: ${formatManaPool(newPool)}`);
    syncState();
  }, [addMessage, syncState]);

  // Deep-clone engine state for undo snapshots (Maps need special handling)
  const cloneEngineState = useCallback((s: GameStateWithAI): GameStateWithAI => {
    return {
      ...s,
      cards: new Map(s.cards),
      cardDefinitions: new Map(s.cardDefinitions),
      battlefieldAbilities: new Map(s.battlefieldAbilities),
      players: s.players.map(p => ({ ...p, manaPool: { ...p.manaPool }, commanderDamage: { ...p.commanderDamage } })),
      stack: [...s.stack],
      pendingTriggers: [...s.pendingTriggers],
      hasPriorityPassed: [...s.hasPriorityPassed],
    };
  }, []);

  // Handle player action
  const submitAction = useCallback(
    (action: SimpleLegalAction) => {
      const engine = engineRef.current;
      if (!engine || gameState?.gameOver) return;

      const engineAction = action._engineAction;
      if (!engineAction) {
        console.warn('No engine action attached to', action);
        return;
      }

      // Snapshot state before meaningful human actions (for undo)
      // Skip mana taps and pass priority — only snapshot game-changing actions
      const isUndoable = action.kind !== 'ActivateManaAbility' && action.kind !== 'PassPriority';
      if (isUndoable && undosRemaining > 0) {
        undoStackRef.current.push({
          engine: cloneEngineState(engine),
          messages: [...chatMessages],
          log: [...gameLog],
        });
        if (undoStackRef.current.length > 10) {
          undoStackRef.current.shift();
        }
      }

      try {
        // Coach mode: evaluate all options BEFORE applying the action
        let coachMessage: string | null = null;
        if (coachMode && isUndoable && engineAction.kind !== 'DeclareAttackers' && engineAction.kind !== 'DeclareBlockers') {
          try {
            const allActions = getLegalActions(engine, humanIdRef.current);
            // Only evaluate if there were real choices (not just pass)
            const meaningfulActions = allActions.filter(a => a.kind !== 'PassPriority' && a.kind !== 'ActivateManaAbility');
            if (meaningfulActions.length > 1) {
              const ranked = evaluateActions(engine, humanIdRef.current, meaningfulActions);
              const humanIdx = ranked.findIndex(r => {
                if (r.action.kind !== engineAction.kind) return false;
                if ('cardInstanceId' in r.action && 'cardInstanceId' in engineAction) {
                  return r.action.cardInstanceId === engineAction.cardInstanceId;
                }
                return true;
              });
              const humanEval = humanIdx >= 0 ? ranked[humanIdx] : null;
              const bestEval = ranked[0];

              if (humanEval && humanIdx === 0) {
                coachMessage = `Optimal play.`;
              } else if (humanEval && bestEval) {
                const bestCard = 'cardInstanceId' in bestEval.action
                  ? engine.cards.get(bestEval.action.cardInstanceId)
                  : null;
                const bestDef = bestCard ? engine.cardDefinitions.get(bestCard.definitionId) : null;
                const bestName = bestDef?.name || bestEval.action.kind;
                const scoreDiff = bestEval.score - (humanEval?.score ?? 0);
                if (scoreDiff < 1) {
                  coachMessage = `Good play (close to optimal).`;
                } else {
                  coachMessage = `Consider: ${bestName} (score ${bestEval.score.toFixed(1)} vs your ${humanEval.score.toFixed(1)}). ${bestEval.reasoning || ''}`;
                }
              }
            }
          } catch {
            // Coach evaluation is optional — don't break the game
          }
        }

        let newState: GameState;

        // For DeclareAttackers with no actual attacks, skip combat via passPriority
        if (engineAction.kind === 'DeclareAttackers' && engineAction.attacks.length === 0) {
          // Skip combat — pass both players through all remaining combat steps
          newState = engine as GameState;
          let combatSafety = 20;
          while (
            (newState.step === 'declare_attackers' ||
             newState.step === 'declare_blockers' ||
             newState.step === 'first_strike_damage' ||
             newState.step === 'combat_damage' ||
             newState.step === 'end_of_combat') &&
            combatSafety-- > 0
          ) {
            newState = passPriority(newState);
            newState = passPriority(newState);
            newState = advanceStep(newState);
          }
        } else if (engineAction.kind === 'CastSpell') {
          // Auto-tap lands if needed before casting the spell
          const humanId = humanIdRef.current;
          const card = engine.cards.get(engineAction.cardInstanceId);
          const player = engine.players.find(p => p.id === humanId);

          if (card && player) {
            const def = getCardDefinition(engine, card);
            const baseCost = parseManaString(def.mana_cost);
            const isFromCommandZone = card.zone === 'command';
            const taxAmount = isFromCommandZone ? player.commanderCastCount * 2 : 0;
            const totalCost: ManaCost = { ...baseCost, generic: baseCost.generic + taxAmount };

            if (!canPayCost(player.manaPool, totalCost)) {
              // Need to auto-tap lands first
              const currentActions = getLegalActions(engine, humanId);
              const manaActions = currentActions.filter(a => a.kind === 'ActivateManaAbility');
              const landsToTap = findLandsToTap(engine, humanId, totalCost, manaActions);

              if (landsToTap && landsToTap.length > 0) {
                // Apply each mana ability action sequentially, narrating each tap
                let tapState: GameState = engine;
                for (const manaAction of landsToTap) {
                  const beforePool = tapState.players.find(p => p.id === humanId)?.manaPool;
                  tapState = applyAction(tapState, humanId, manaAction);
                  const afterPool = tapState.players.find(p => p.id === humanId)?.manaPool;
                  // Narrate the tap
                  const tappedCard = 'cardInstanceId' in manaAction ? tapState.cards.get(manaAction.cardInstanceId) : undefined;
                  const tappedDef = tappedCard ? getCardDefinition(tapState, tappedCard) : undefined;
                  const gained: string[] = [];
                  if (afterPool && beforePool) {
                    for (const c of ['W', 'U', 'B', 'R', 'G', 'C'] as const) {
                      const diff = afterPool[c] - beforePool[c];
                      if (diff > 0) gained.push(`+${diff}${c}`);
                    }
                  }
                  addMessage('system', `Auto-tapped ${tappedDef?.name || 'a permanent'} (${gained.join(' ') || '+mana'}).`);
                }
                const poolBeforeCast = tapState.players.find(p => p.id === humanId)?.manaPool;
                addMessage('system', `Mana available: ${poolBeforeCast ? formatManaPool(poolBeforeCast) : '?'}`);
                // Now cast the spell on the state with mana in the pool
                newState = applyAction(tapState, humanId, engineAction);
              } else {
                // Couldn't find lands to tap — try anyway, engine will throw if impossible
                newState = applyAction(engine, humanId, engineAction);
              }
            } else {
              // Already have enough mana in pool
              const poolBeforeCast = player.manaPool;
              addMessage('system', `Using floating mana: ${formatManaPool(poolBeforeCast)}`);
              newState = applyAction(engine, humanId, engineAction);
            }
          } else {
            newState = applyAction(engine, humanIdRef.current, engineAction);
          }
        } else {
          // Apply human action through the engine normally
          newState = applyAction(engine, humanIdRef.current, engineAction);
        }

        // Track uncommitted mana taps (can be untapped) vs committed (used for a spell)
        if (engineAction.kind === 'ActivateManaAbility' && 'cardInstanceId' in engineAction) {
          uncommittedTapsRef.current.add(engineAction.cardInstanceId);
        } else if (engineAction.kind === 'CastSpell') {
          // Spell was cast — all tapped mana sources are now committed
          uncommittedTapsRef.current.clear();
        }

        // Log what the player did with mana context
        const poolAfter = newState.players.find(p => p.id === humanIdRef.current)?.manaPool;
        const poolStr = poolAfter ? formatManaPool(poolAfter) : 'empty';

        if (action.kind === 'PlayLand') {
          addMessage('player', `Played ${action.cardName || 'a land'}.`);
        } else if (action.kind === 'CastSpell') {
          // Show what was spent
          const castAction = engineAction as { kind: 'CastSpell'; cardInstanceId: string };
          const cardInst = engine.cards.get(castAction.cardInstanceId);
          const cardDef = cardInst ? getCardDefinition(engine, cardInst) : undefined;
          const costStr = cardDef?.mana_cost || '?';
          // Check if this spell produces mana (ritual) — don't show "Floating: empty" since it'll resolve to add mana
          const isManaSpell = cardDef?.oracle_text?.toLowerCase().includes('add {') || cardDef?.oracle_text?.toLowerCase().includes('add mana');
          const floatingNote = isManaSpell ? '(resolving...)' : `Floating: ${poolStr}`;
          addMessage('player', `Cast ${action.cardName || 'a spell'} (cost: ${costStr}). ${floatingNote}`);
        } else if (action.kind === 'PassPriority') {
          // Use context-aware label from the action
          const passMsg = engine.stack.length > 0 ? 'Chose not to respond.' : action.label + '.';
          addMessage('player', passMsg);
        } else if (action.kind === 'DeclareAttackers') {
          addMessage('player', action.label);
        } else if (action.kind === 'DeclareBlockers') {
          addMessage('player', action.label);
        } else if (action.kind === 'ActivateAbility') {
          const msg = action.label.startsWith('Equip')
            ? `${action.label}. Floating: ${poolStr}`
            : `Activated ${action.cardName || 'an ability'}.`;
          addMessage('player', msg);
        } else if (action.kind === 'ActivateManaAbility') {
          // Show mana gained and floating total
          const poolBefore = engine.players.find(p => p.id === humanIdRef.current)?.manaPool;
          const gained: string[] = [];
          if (poolAfter && poolBefore) {
            for (const c of ['W', 'U', 'B', 'R', 'G', 'C'] as const) {
              const diff = poolAfter[c] - poolBefore[c];
              if (diff > 0) gained.push(`+${diff}${c}`);
            }
          }
          const gainStr = gained.length > 0 ? gained.join(' ') : '+1 mana';
          addMessage('player', `Tapped ${action.cardName || 'a permanent'} (${gainStr}). Floating: ${poolStr}`);
        }
        // Note: ActivateManaAbility now has narration for manual tapping

        // Record game log entry for meaningful human actions
        if (action.kind !== 'ActivateManaAbility') {
          const humanAction = action.kind === 'PlayLand'
            ? `Played ${action.cardName || 'a land'}`
            : action.kind === 'CastSpell'
            ? `Cast ${action.cardName || 'a spell'}`
            : action.kind === 'DeclareAttackers'
            ? action.label
            : action.kind === 'DeclareBlockers'
            ? action.label
            : action.kind === 'ActivateAbility'
            ? `Activated ${action.cardName || 'an ability'}`
            : action.kind === 'PassPriority'
            ? 'Passed priority'
            : action.label;
          // Estimate mana spent from CMC of card if it was a cast
          let manaSpent = 0;
          if (action.kind === 'CastSpell' && action.cardInstanceId) {
            const card = newState.cards.get(action.cardInstanceId);
            if (card) {
              const def = getCardDefinition(newState, card);
              const cost = parseManaString(def.mana_cost);
              manaSpent = cost.W + cost.U + cost.B + cost.R + cost.G + cost.C + cost.generic;
            }
          }
          appendLog(captureLogEntry(
            newState, humanIdRef.current, aiIdsRef.current,
            'human', humanAction, manaSpent,
          ));
        }

        // Run the game loop: resolve stack, advance steps, run AI turns
        const loopMessages: { role: ChatMessage['role']; text: string }[] = [];
        const loopLogEntries: GameLogEntry[] = [];
        newState = advanceGameLoop(newState, loopMessages, loopLogEntries);

        // Commit state
        engineRef.current = newState as GameStateWithAI;

        // Check if mana pool changed after spell resolution (e.g., rituals add mana)
        const poolAfterLoop = newState.players.find(p => p.id === humanIdRef.current)?.manaPool;
        if (poolAfterLoop && poolAfter) {
          const totalBefore = Object.values(poolAfter).reduce((a, b) => a + b, 0);
          const totalAfterLoop = Object.values(poolAfterLoop).reduce((a, b) => a + b, 0);
          if (totalAfterLoop > totalBefore) {
            // Mana was added by spell resolution (ritual, mana dork trigger, etc.)
            const gained: string[] = [];
            for (const c of ['W', 'U', 'B', 'R', 'G', 'C'] as const) {
              const diff = poolAfterLoop[c] - poolAfter[c];
              if (diff > 0) gained.push(`+${diff}${c}`);
            }
            addMessage('system', `Spell resolved: ${gained.join(' ')} added. Floating: ${formatManaPool(poolAfterLoop)}`);
          }
        }

        // Add accumulated messages
        for (const msg of loopMessages) {
          addMessage(msg.role, msg.text);
        }

        // Add accumulated log entries from AI turns
        if (loopLogEntries.length > 0) {
          setGameLog(prev => [...prev, ...loopLogEntries]);
        }

        // Check game over
        const humanP = newState.players.find(p => p.id === humanIdRef.current);
        const allAIsLost = aiIdsRef.current.every(id => {
          const p = newState.players.find(pl => pl.id === id);
          return p?.hasLost;
        });
        if (humanP?.hasLost) {
          addMessage('system', 'You have been defeated!');
        } else if (allAIsLost) {
          addMessage('system', 'Victory! The Shelector has been defeated!');
        }

        // Coach feedback
        if (coachMessage) {
          addMessage('system', `Coach: ${coachMessage}`);
        }

        // Sync display
        syncState();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Action failed';
        addMessage('system', `Error: ${msg}`);
        console.error('Action error:', err);
        syncState();
      }
    },
    [gameState, addMessage, appendLog, syncState, advanceGameLoop],
  );

  const isHumanTurn = gameState?.priorityPlayerId === humanIdRef.current;
  const isGameOver = gameState?.gameOver ?? false;
  const winner = gameState?.winnerId ?? null;

  return {
    // State
    gameState,
    legalActions,
    chatMessages,
    isLoading,
    isHumanTurn,
    isGameOver,
    winner,
    opponentInfo,
    error,
    mulliganPhase,
    mulliganCount,
    discardPhase,
    discardCount,
    tutorPhase,
    tutorCards,
    tutorTitle,
    gameLog,
    undosRemaining,
    coachMode,
    untappableCardIds: [...uncommittedTapsRef.current],

    // Actions
    spawnOpponent,
    startGame,
    submitAction,
    keepHand,
    mulligan,
    discardCard,
    resolveTutor,
    undoAction,
    setCoachMode,
    untapManaSource,
  };
}
