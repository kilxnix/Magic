/**
 * useCommanderEngine
 *
 * React hook that wraps the full TypeScript Commander engine.
 * Provides the same API surface as the original useGameEngine so
 * GamePage.tsx needs minimal changes.
 */

import { useState, useCallback, useRef } from 'react';

// Engine imports
import {
  // Types
  type GameState as EngineGameState,
  type CardDefinition,
  type ManaColor,
  type ManaPool,
  type ManaCost,
  type Phase,
  type Step,
  type Zone,
  type AttackerDeclaration,
  type BlockerDeclaration,
  // Game state
  getCardsInZone,
  // Actions
  canPlayLand,
  playLand,
  tapLandForMana,
  drawCards,
  // Stack
  canCastSpell as engineCanCastSpell,
  castSpell as engineCastSpell,
  resolveTopOfStack,
  putTriggersOnStack,
  // Mana
  parseManaString,
  canPayCost,
  // Combat
  canDeclareAttacker,
  declareAttackers,
  canDeclareBlocker,
  declareBlockers,
  resolveCombatDamage,
  // Turn management
  advanceStep,
  advanceToNextTurn,
  performUntapStep,
  // Priority
  passPriority,
  allPlayersPassed,
  // State-based actions
  checkStateBasedActions,
  // AI
  makeDecision,
  runAITurn as engineRunAITurn,
  type AIPlayerConfig,
  type AIDifficulty,
  type AIPersonality,
  // Game init
  initGameFromDecks,
  type GameInitConfig,
  // Cards
  createCardLookup,
  type ScryfallCard,
  type GeneratedDeck,
  type CardLookup,
  type StorageAdapter,
  // Parser (for targeting info)
  parseOracleText,
  // Activated abilities
  getActivatedAbilities as engineGetActivatedAbilities,
  canActivateAbility as engineCanActivateAbility,
  activateAbility as engineActivateAbility,
  type ActivatedAbility,
} from 'commander-engine';

// Adapter imports
import {
  adaptGameState,
  getCardsInZoneAdapted,
  type FrontendGameState,
  type FrontendCardInstance,
  type FrontendStackItem,
} from './engineAdapter';

// Re-export types that GamePage.tsx uses
export type { CardDefinition, ManaColor, ManaPool, Phase, Step, Zone };
export type CardInstance = FrontendCardInstance;
export type { FrontendStackItem as StackItem };
export type { AttackerDeclaration, BlockerDeclaration };

// ===== Types matching the original hook's interface =====

export type CardType = 'creature' | 'instant' | 'sorcery' | 'artifact' | 'enchantment' | 'land' | 'planeswalker';

export interface Player {
  id: string;
  name: string;
  life: number;
  manaPool: ManaPool;
  hasPlayedLand: boolean;
  hasPriority: boolean;
  hasLost: boolean;
  commanderDamage: Record<string, number>;
  commanderTax: number;
  commanderInstanceId: string | null;
  commanderCastCount: number;
}

export interface CombatState {
  attackers: AttackerDeclaration[];
  blockers: BlockerDeclaration[];
  damageAssignment: Map<string, number>;
}

export interface LogEntry {
  timestamp: Date;
  message: string;
  type: 'info' | 'action' | 'combat' | 'spell' | 'ai' | 'damage' | 'trigger';
}

export interface TargetingState {
  isTargeting: boolean;
  sourceCardId: string | null;
  requiredTargetCount: number;
  validTargets: string[];
  selectedTargets: string[];
  targetType: 'creature' | 'player' | 'any' | 'permanent' | null;
}

export interface ManaDeficit {
  [color: string]: number;
}

export interface ManaInfo {
  canCast: boolean;
  timingOk: boolean;
  cost: string;
  deficit: ManaDeficit | null;
}

export interface AutoTapResult {
  newEngineState: EngineGameState;
  success: boolean;
  deficit: ManaDeficit | null;
  tappedNames: string[];
}

export interface GameConfig {
  deckId: string;
  opponentCount: number;
  difficulty: number;
  personalities: string[];
}

export interface GameEngine {
  gameState: FrontendGameState | null;
  isLoading: boolean;
  error: string | null;
  gameLog: LogEntry[];
  selectedCard: string | null;
  humanPlayer: Player | null;
  aiPlayers: Player[];
  targeting: TargetingState;
  mulliganActive: boolean;
  mulliganCount: number;
  putBackCount: number;
  getHandCards: () => FrontendCardInstance[];
  getBattlefieldCards: (playerId: string) => FrontendCardInstance[];
  getGraveyardCards: (playerId: string) => FrontendCardInstance[];
  getExileCards: (playerId: string) => FrontendCardInstance[];
  getCommandZoneCards: (playerId: string) => FrontendCardInstance[];
  getLibraryCount: (playerId: string) => number;
  getStackItems: () => FrontendStackItem[];
  getCardDef: (definitionId: string) => CardDefinition | undefined;
  getCardById: (instanceId: string) => FrontendCardInstance | undefined;
  getCardFaces: (cardName: string) => CardFaceData[] | null;
  canAffordSpell: (cardId: string) => boolean;
  getManaFromLand: (cardId: string) => ManaColor | null;
  getManaInfo: (cardId: string) => ManaInfo;
  canCastWithAutoTap: (cardId: string) => boolean;
  selectCard: (cardId: string | null) => void;
  playLandAction: (cardId: string) => void;
  castSpellAction: (cardId: string, targets?: string[]) => void;
  tapForMana: (cardId: string) => void;
  activateAbility: (cardId: string, abilityIndex: number) => void;
  passPriorityAction: () => void;
  startTargeting: (sourceCardId: string, targetType: 'creature' | 'player' | 'any' | 'permanent', count: number) => void;
  selectTarget: (targetId: string) => void;
  cancelTargeting: () => void;
  confirmTargets: () => void;
  declareAttacker: (cardId: string, defendingPlayerId?: string) => void;
  declareBlocker: (blockerId: string, attackerId: string) => void;
  confirmAttackers: () => void;
  confirmBlockers: () => void;
  respondToStack: () => void;
  endTurn: () => void;
  startGame: (config: GameConfig) => void;
  mulliganAction: () => void;
  keepHandAction: () => void;
  putBackCardAction: (cardId: string) => void;
}

// ===== Mana Helpers (ported from old hook — engine doesn't have auto-tap) =====

function getManaColorsFromCard(state: EngineGameState, cardId: string): ManaColor[] {
  const card = state.cards.get(cardId);
  if (!card) return [];
  const def = state.cardDefinitions.get(card.definitionId);
  if (!def) return [];
  const colors: ManaColor[] = [];
  // Match both "{T}: Add {X}" and basic land "({T}: Add {X}.)"
  const matches = def.oracle_text.matchAll(/\(?\{?T\}?:.*?Add \{([WUBRGC])\}/g);
  for (const m of matches) {
    const color = m[1] as ManaColor;
    if (!colors.includes(color)) colors.push(color);
  }
  return colors;
}

function getEffectiveManaCost(state: EngineGameState, playerId: string, cardId: string): ManaCost {
  const card = state.cards.get(cardId);
  if (!card) return parseManaString('');
  const def = state.cardDefinitions.get(card.definitionId);
  if (!def) return parseManaString('');
  const cost = parseManaString(def.mana_cost);
  if (card.zone === 'command' && card.isCommander) {
    const player = state.players.find(p => p.id === playerId);
    if (player) {
      cost.generic += player.commanderCastCount * 2;
    }
  }
  return cost;
}

function canCastTiming(state: EngineGameState, playerId: string, cardId: string): { ok: boolean; reason: string } {
  const card = state.cards.get(cardId);
  if (!card) return { ok: false, reason: 'Card not found' };
  const validZone = card.zone === 'hand' || (card.zone === 'command' && card.isCommander);
  if (!validZone) return { ok: false, reason: 'Card not in hand or command zone' };
  const def = state.cardDefinitions.get(card.definitionId);
  if (!def || def.card_types.includes('land')) return { ok: false, reason: 'Not a castable spell' };
  const isInstant = def.card_types.includes('instant');
  const hasFlash = def.keywords.includes('Flash');
  if (!isInstant && !hasFlash) {
    const playerIndex = state.players.findIndex(p => p.id === playerId);
    if (state.activePlayerIndex !== playerIndex) return { ok: false, reason: "Not your turn" };
    if (state.phase !== 'precombat_main' && state.phase !== 'postcombat_main') return { ok: false, reason: "Can only cast during a main phase" };
    if (state.stack.length > 0) return { ok: false, reason: 'Stack must be empty for sorcery-speed spells' };
  }
  return { ok: true, reason: '' };
}

function autoTapForCost(state: EngineGameState, playerId: string, cardId: string): AutoTapResult {
  const cost = getEffectiveManaCost(state, playerId, cardId);
  const remaining = { ...cost };
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { newEngineState: state, success: false, deficit: { generic: cost.generic }, tappedNames: [] };

  // Subtract mana already in pool
  for (const color of ['W', 'U', 'B', 'R', 'G', 'C'] as ManaColor[]) {
    const fromPool = Math.min(player.manaPool[color], remaining[color]);
    remaining[color] -= fromPool;
  }
  let poolGenericAvailable = 0;
  for (const color of ['W', 'U', 'B', 'R', 'G', 'C'] as ManaColor[]) {
    const leftover = player.manaPool[color] - cost[color];
    if (leftover > 0) poolGenericAvailable += leftover;
  }
  remaining.generic = Math.max(0, remaining.generic - poolGenericAvailable);

  const totalRemaining = remaining.W + remaining.U + remaining.B + remaining.R + remaining.G + remaining.C + remaining.generic;
  if (totalRemaining === 0) {
    return { newEngineState: state, success: true, deficit: null, tappedNames: [] };
  }

  // Gather untapped mana sources
  const sources: { instanceId: string; name: string; colors: ManaColor[] }[] = [];
  state.cards.forEach((card) => {
    if (card.zone === 'battlefield' && card.ownerId === playerId && !card.tapped) {
      // Skip summoning-sick creatures (but not lands)
      const def = state.cardDefinitions.get(card.definitionId);
      if (card.summoningSick && def && !def.card_types.includes('land')) return;
      const colors = getManaColorsFromCard(state, card.instanceId);
      if (colors.length > 0) {
        sources.push({ instanceId: card.instanceId, name: def?.name || 'Unknown', colors });
      }
    }
  });

  // Sort: single-color sources first, multi-color last
  sources.sort((a, b) => a.colors.length - b.colors.length);

  const toTap: { instanceId: string; name: string; color: ManaColor }[] = [];

  // Pass 1: satisfy colored requirements
  for (const color of ['W', 'U', 'B', 'R', 'G', 'C'] as ManaColor[]) {
    while (remaining[color] > 0) {
      const idx = sources.findIndex(s => s.colors.includes(color));
      if (idx === -1) break;
      const source = sources[idx];
      toTap.push({ instanceId: source.instanceId, name: source.name, color });
      remaining[color]--;
      sources.splice(idx, 1);
    }
  }

  // Pass 2: satisfy generic
  while (remaining.generic > 0 && sources.length > 0) {
    const source = sources.shift()!;
    toTap.push({ instanceId: source.instanceId, name: source.name, color: source.colors[0] });
    remaining.generic--;
  }

  // Check for deficit
  const deficit: ManaDeficit = {};
  for (const color of ['W', 'U', 'B', 'R', 'G', 'C'] as ManaColor[]) {
    if (remaining[color] > 0) deficit[color] = remaining[color];
  }
  if (remaining.generic > 0) deficit['generic'] = remaining.generic;

  if (Object.keys(deficit).length > 0) {
    return { newEngineState: state, success: false, deficit, tappedNames: [] };
  }

  // Apply taps using engine's tapLandForMana
  let newState = state;
  for (const tap of toTap) {
    try {
      newState = tapLandForMana(newState, playerId, tap.instanceId, tap.color);
    } catch {
      return { newEngineState: state, success: false, deficit: { generic: 1 }, tappedNames: [] };
    }
  }
  return { newEngineState: newState, success: true, deficit: null, tappedNames: toTap.map(t => t.name) };
}

function canCastWithAutoTapCheck(state: EngineGameState, playerId: string, cardId: string): boolean {
  const timing = canCastTiming(state, playerId, cardId);
  if (!timing.ok) return false;
  const cost = getEffectiveManaCost(state, playerId, cardId);
  const player = state.players.find(p => p.id === playerId);
  if (!player) return false;
  if (canPayCost(player.manaPool, cost)) return true;
  const result = autoTapForCost(state, playerId, cardId);
  return result.success;
}

function formatManaDeficit(manaCost: string, deficit: ManaDeficit | null, timingReason?: string): string {
  if (timingReason) return timingReason;
  if (!deficit) return 'Cannot cast spell';
  const costStr = manaCost || '{0}';
  const parts: string[] = [];
  for (const [color, amount] of Object.entries(deficit)) {
    if (color === 'generic') {
      parts.push(`{${amount}}`);
    } else {
      for (let i = 0; i < amount; i++) parts.push(`{${color}}`);
    }
  }
  return `Need ${costStr} — missing ${parts.join('')}`;
}

// ===== LocalStorage Adapter for Save/Load =====

export class LocalStorageAdapter implements StorageAdapter {
  get(key: string): string | null {
    return localStorage.getItem(key);
  }
  set(key: string, value: string): void {
    localStorage.setItem(key, value);
  }
  remove(key: string): void {
    localStorage.removeItem(key);
  }
  keys(prefix: string): string[] {
    const result: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) result.push(key);
    }
    return result;
  }
}

// ===== Deck Fetching =====

export interface CardFaceData {
  name: string;
  type_line: string;
  oracle_text: string;
  mana_cost: string;
  power?: string | null;
  toughness?: string | null;
}

interface ApiCardData {
  name: string;
  type_line: string;
  oracle_text: string;
  mana_cost: string;
  cmc: number;
  colors: string[];
  color_identity: string[];
  keywords: string[];
  power?: string | null;
  toughness?: string | null;
  layout?: string | null;
  card_faces?: CardFaceData[] | null;
}

interface ApiDeck {
  id: string;
  commander: string;
  colors: string[];
  list: string[];
  bracket?: number;
  theme?: string;
}

function parseDeckListEntry(entry: string): { name: string; quantity: number } {
  const cleaned = entry.replace(/\s*\*CMDR\*\s*$/, '');
  const match = cleaned.match(/^(\d+)x\s+(.+)$/);
  if (match) {
    return { name: match[2], quantity: parseInt(match[1]) };
  }
  return { name: cleaned, quantity: 1 };
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function apiCardToScryfallCard(card: ApiCardData): ScryfallCard {
  return {
    id: card.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    name: card.name,
    type_line: card.type_line,
    oracle_text: card.oracle_text || '',
    mana_cost: card.mana_cost || '',
    cmc: card.cmc,
    colors: card.colors || [],
    color_identity: card.color_identity || [],
    keywords: card.keywords || [],
    power: card.power ?? undefined,
    toughness: card.toughness ?? undefined,
  };
}

function inferBasicLandText(name: string, oracleText: string): string {
  const basicLandMana: Record<string, string> = {
    'Plains': '({T}: Add {W}.)',
    'Island': '({T}: Add {U}.)',
    'Swamp': '({T}: Add {B}.)',
    'Mountain': '({T}: Add {R}.)',
    'Forest': '({T}: Add {G}.)',
  };
  if (!oracleText && basicLandMana[name]) return basicLandMana[name];
  return oracleText;
}

async function fetchDeckAndCards(deckId: string): Promise<{
  deck: ApiDeck;
  cardLookup: CardLookup;
  scryfallCards: ScryfallCard[];
  facesMap: Map<string, CardFaceData[]>;
}> {
  const deckRes = await fetch(`/api/deck/${deckId}`);
  if (!deckRes.ok) throw new Error('Failed to load deck');
  const deck: ApiDeck = await deckRes.json();

  // Parse deck list, expand quantities
  const parsedEntries = deck.list
    .map(parseDeckListEntry)
    .filter(e => e.name !== deck.commander);
  const expandedNames: string[] = [];
  for (const entry of parsedEntries) {
    for (let i = 0; i < entry.quantity; i++) {
      expandedNames.push(entry.name);
    }
  }

  const allNames = [deck.commander, ...expandedNames];
  const uniqueNames = [...new Set(allNames)];

  const cardsRes = await fetch('/api/cards-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names: uniqueNames }),
  });
  if (!cardsRes.ok) throw new Error('Failed to load card data');
  const cardDataList: ApiCardData[] = await cardsRes.json();

  // Infer basic land mana text
  for (const card of cardDataList) {
    if (card.type_line.toLowerCase().includes('land')) {
      card.oracle_text = inferBasicLandText(card.name, card.oracle_text);
    }
  }

  const scryfallCards = cardDataList.map(apiCardToScryfallCard);
  const cardLookup = createCardLookup(scryfallCards);

  // Build faces map for double-faced cards
  const facesMap = new Map<string, CardFaceData[]>();
  for (const card of cardDataList) {
    if (card.card_faces && card.card_faces.length > 1) {
      facesMap.set(card.name, card.card_faces);
    }
  }

  return { deck, cardLookup, scryfallCards, facesMap };
}

// ===== AI Deck Generation (simple fallback) =====

function createSimpleAIDeck(commanderName: string, colors: string[]): GeneratedDeck {
  // Build a simple deck for the AI using basic lands and the commander
  const landNames: Record<string, string> = {
    'W': 'Plains', 'U': 'Island', 'B': 'Swamp', 'R': 'Mountain', 'G': 'Forest',
  };

  const deckColors = colors.length > 0 ? colors : ['U']; // Default to blue
  const list: string[] = [];

  // Fill with basic lands (99 cards)
  const landsPerColor = Math.floor(99 / deckColors.length);
  for (const color of deckColors) {
    const landName = landNames[color] || 'Island';
    for (let i = 0; i < landsPerColor; i++) {
      list.push(landName);
    }
  }
  // Fill remaining slots
  while (list.length < 99) {
    const landName = landNames[deckColors[0]] || 'Island';
    list.push(landName);
  }

  return {
    id: `ai-deck-${Date.now()}`,
    commander: commanderName,
    list,
    colors: deckColors,
    bracket: 1,
    theme: 'basic',
  };
}

// ===== Main Hook =====

export function useCommanderEngine(): GameEngine {
  // Engine state (raw, from the engine)
  const engineStateRef = useRef<EngineGameState | null>(null);

  // Frontend-adapted state (for rendering)
  const [frontendState, setFrontendState] = useState<FrontendGameState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gameLog, setGameLog] = useState<LogEntry[]>([]);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [targeting, setTargeting] = useState<TargetingState>({
    isTargeting: false, sourceCardId: null, requiredTargetCount: 0,
    validTargets: [], selectedTargets: [], targetType: null,
  });
  const [mulliganActive, setMulliganActive] = useState(false);
  const [mulliganCount, setMulliganCount] = useState(0);
  const [putBackCount, setPutBackCount] = useState(0);

  const aiThinkingRef = useRef(false);
  const pendingAttackers = useRef<AttackerDeclaration[]>([]);
  const pendingBlockers = useRef<BlockerDeclaration[]>([]);
  const aiConfigRef = useRef<Map<string, AIPlayerConfig>>(new Map());
  const cardFacesMapRef = useRef<Map<string, CardFaceData[]>>(new Map());

  // Helper to update both engine and frontend state
  const updateState = useCallback((newEngineState: EngineGameState) => {
    engineStateRef.current = newEngineState;
    setFrontendState(adaptGameState(newEngineState));
  }, []);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    setGameLog(prev => [...prev, { timestamp: new Date(), message, type }]);
  }, []);

  // ===== Derived State =====

  const humanPlayer = frontendState?.players.find(p => p.id === 'human') ?? null;
  const aiPlayers = frontendState?.players.filter(p => p.id !== 'human') ?? [];

  // ===== Query Functions =====

  const getHandCards = useCallback((): FrontendCardInstance[] =>
    frontendState ? getCardsInZoneAdapted(frontendState, 'human', 'hand') : [], [frontendState]);

  const getBattlefieldCards = useCallback((playerId: string): FrontendCardInstance[] =>
    frontendState ? getCardsInZoneAdapted(frontendState, playerId, 'battlefield') : [], [frontendState]);

  const getGraveyardCards = useCallback((playerId: string): FrontendCardInstance[] =>
    frontendState ? getCardsInZoneAdapted(frontendState, playerId, 'graveyard') : [], [frontendState]);

  const getExileCards = useCallback((playerId: string): FrontendCardInstance[] =>
    frontendState ? getCardsInZoneAdapted(frontendState, playerId, 'exile') : [], [frontendState]);

  const getCommandZoneCards = useCallback((playerId: string): FrontendCardInstance[] =>
    frontendState ? getCardsInZoneAdapted(frontendState, playerId, 'command') : [], [frontendState]);

  const getLibraryCount = useCallback((playerId: string): number =>
    frontendState ? getCardsInZoneAdapted(frontendState, playerId, 'library').length : 0, [frontendState]);

  const getStackItems = useCallback((): FrontendStackItem[] =>
    frontendState?.stack ?? [], [frontendState]);

  const getCardDef = useCallback((definitionId: string): CardDefinition | undefined =>
    frontendState?.cardDefinitions.get(definitionId), [frontendState]);

  const getCardById = useCallback((instanceId: string): FrontendCardInstance | undefined =>
    frontendState?.cards.get(instanceId), [frontendState]);

  const getCardFaces = useCallback((cardName: string): CardFaceData[] | null =>
    cardFacesMapRef.current.get(cardName) ?? null, []);

  const canAffordSpell = useCallback((cardId: string): boolean => {
    const es = engineStateRef.current;
    if (!es) return false;
    return engineCanCastSpell(es, 'human', cardId);
  }, [frontendState]); // eslint-disable-line -- depends on frontendState for re-render

  const getManaFromLand = useCallback((cardId: string): ManaColor | null => {
    const es = engineStateRef.current;
    if (!es) return null;
    const colors = getManaColorsFromCard(es, cardId);
    return colors.length > 0 ? colors[0] : null;
  }, [frontendState]); // eslint-disable-line

  const getManaInfo = useCallback((cardId: string): ManaInfo => {
    const es = engineStateRef.current;
    if (!es) return { canCast: false, timingOk: false, cost: '', deficit: null };
    const card = es.cards.get(cardId);
    const def = card ? es.cardDefinitions.get(card.definitionId) : null;
    if (!card || !def) return { canCast: false, timingOk: false, cost: '', deficit: null };
    const timing = canCastTiming(es, 'human', cardId);
    const canCast = canCastWithAutoTapCheck(es, 'human', cardId);
    let deficit: ManaDeficit | null = null;
    if (timing.ok && !canCast) {
      const result = autoTapForCost(es, 'human', cardId);
      deficit = result.deficit;
    }
    return { canCast, timingOk: timing.ok, cost: def.mana_cost, deficit };
  }, [frontendState]); // eslint-disable-line

  const canCastWithAutoTap = useCallback((cardId: string): boolean => {
    const es = engineStateRef.current;
    if (!es) return false;
    return canCastWithAutoTapCheck(es, 'human', cardId);
  }, [frontendState]); // eslint-disable-line

  // ===== Targeting =====

  function getValidTargetsForType(
    state: EngineGameState,
    targetType: 'creature' | 'player' | 'any' | 'permanent',
  ): string[] {
    const valid: string[] = [];
    if (targetType === 'player' || targetType === 'any') {
      state.players.forEach(p => { if (!p.hasLost) valid.push(p.id); });
    }
    if (targetType === 'creature' || targetType === 'any' || targetType === 'permanent') {
      state.cards.forEach(c => {
        if (c.zone === 'battlefield') {
          const cDef = state.cardDefinitions.get(c.definitionId);
          if (cDef && (targetType === 'permanent' || cDef.card_types.includes('creature'))) {
            valid.push(c.instanceId);
          }
        }
      });
    }
    return valid;
  }

  const startTargeting = useCallback((
    sourceCardId: string,
    targetType: 'creature' | 'player' | 'any' | 'permanent',
    count: number,
  ) => {
    const es = engineStateRef.current;
    if (!es) return;

    const validTargets: string[] = [];
    if (targetType === 'player' || targetType === 'any') {
      es.players.forEach(p => { if (!p.hasLost) validTargets.push(p.id); });
    }
    if (targetType === 'creature' || targetType === 'any' || targetType === 'permanent') {
      es.cards.forEach(c => {
        if (c.zone === 'battlefield') {
          const cDef = es.cardDefinitions.get(c.definitionId);
          if (cDef && (targetType === 'permanent' || cDef.card_types.includes('creature'))) {
            validTargets.push(c.instanceId);
          }
        }
      });
    }

    setTargeting({
      isTargeting: true, sourceCardId, requiredTargetCount: count,
      validTargets, selectedTargets: [], targetType,
    });
  }, [frontendState]); // eslint-disable-line

  const selectTarget = useCallback((targetId: string) => {
    setTargeting(prev => {
      if (!prev.isTargeting || !prev.validTargets.includes(targetId)) return prev;
      if (prev.selectedTargets.includes(targetId)) {
        return { ...prev, selectedTargets: prev.selectedTargets.filter(t => t !== targetId) };
      }
      if (prev.selectedTargets.length >= prev.requiredTargetCount) return prev;
      return { ...prev, selectedTargets: [...prev.selectedTargets, targetId] };
    });
  }, []);

  const cancelTargeting = useCallback(() => {
    setTargeting({
      isTargeting: false, sourceCardId: null, requiredTargetCount: 0,
      validTargets: [], selectedTargets: [], targetType: null,
    });
  }, []);

  const confirmTargets = useCallback(() => {
    if (!targeting.isTargeting || !targeting.sourceCardId) return;
    const es = engineStateRef.current;
    if (!es) return;
    if (targeting.selectedTargets.length < targeting.requiredTargetCount) return;

    try {
      const card = es.cards.get(targeting.sourceCardId);
      const def = card ? es.cardDefinitions.get(card.definitionId) : null;
      let stateForCast = es;
      let tappedNames: string[] = [];

      // Auto-tap if needed
      const cost = getEffectiveManaCost(es, 'human', targeting.sourceCardId);
      const player = es.players.find(p => p.id === 'human');
      if (player && !canPayCost(player.manaPool, cost)) {
        const tapResult = autoTapForCost(es, 'human', targeting.sourceCardId);
        if (!tapResult.success) {
          addLog(formatManaDeficit(def?.mana_cost || '', tapResult.deficit), 'info');
          cancelTargeting();
          return;
        }
        stateForCast = tapResult.newEngineState;
        tappedNames = tapResult.tappedNames;
      }

      let newState = engineCastSpell(stateForCast, 'human', targeting.sourceCardId, targeting.selectedTargets);
      if (tappedNames.length > 0) {
        addLog(`Auto-tapped ${tappedNames.join(', ')} — Cast ${def?.name ?? 'spell'}`, 'spell');
      } else {
        addLog(`Cast ${def?.name ?? 'spell'}`, 'spell');
      }

      // Resolve stack (engine resolves one at a time with SBAs)
      newState = resolveStackFully(newState);
      updateState(newState);
      setSelectedCard(null);
    } catch (err) {
      addLog(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'info');
    }
    cancelTargeting();
  }, [targeting, addLog, cancelTargeting, updateState]);

  // ===== Game Actions =====

  const selectCard = useCallback((cardId: string | null) => setSelectedCard(cardId), []);

  const playLandAction = useCallback((cardId: string) => {
    const es = engineStateRef.current;
    if (!es) return;

    if (!canPlayLand(es, 'human', cardId)) {
      addLog('Cannot play land right now.', 'info');
      return;
    }

    const card = es.cards.get(cardId);
    const def = card ? es.cardDefinitions.get(card.definitionId) : null;

    try {
      const newState = playLand(es, 'human', cardId);
      updateState(newState);
      setSelectedCard(null);
      addLog(`Played ${def?.name ?? 'land'}`, 'action');
    } catch (err) {
      addLog(`Cannot play land: ${err instanceof Error ? err.message : 'Unknown error'}`, 'info');
    }
  }, [addLog, updateState]);

  const tapForMana = useCallback((cardId: string) => {
    const es = engineStateRef.current;
    if (!es) return;
    const card = es.cards.get(cardId);
    if (!card || card.tapped) return;
    const def = es.cardDefinitions.get(card.definitionId);
    // Summoning sick creatures can't tap for mana (lands are unaffected)
    if (card.summoningSick && def && !def.card_types.includes('land')) {
      addLog(`${def.name} has summoning sickness and can't tap yet.`, 'info');
      return;
    }
    const manaColor = getManaColorsFromCard(es, cardId);
    if (manaColor.length === 0) { addLog('Cannot tap for mana.', 'info'); return; }

    try {
      const newState = tapLandForMana(es, 'human', cardId, manaColor[0]);
      updateState(newState);
      addLog(`Tapped ${def?.name ?? 'permanent'} for {${manaColor[0]}}`, 'action');
    } catch (err) {
      addLog(`Cannot tap: ${err instanceof Error ? err.message : 'Unknown error'}`, 'info');
    }
  }, [addLog, updateState]);

  // Helper: auto-tap for a raw mana cost string (for activated ability costs)
  function autoTapForManaCost(state: EngineGameState, playerId: string, manaCostStr: string): AutoTapResult {
    const cost = parseManaString(manaCostStr);
    const remaining = { ...cost };
    const player = state.players.find(p => p.id === playerId);
    if (!player) return { newEngineState: state, success: false, deficit: { generic: cost.generic }, tappedNames: [] };

    // Subtract from pool
    for (const color of ['W', 'U', 'B', 'R', 'G', 'C'] as ManaColor[]) {
      const fromPool = Math.min(player.manaPool[color], remaining[color]);
      remaining[color] -= fromPool;
    }
    let poolGenericAvailable = 0;
    for (const color of ['W', 'U', 'B', 'R', 'G', 'C'] as ManaColor[]) {
      const leftover = player.manaPool[color] - cost[color];
      if (leftover > 0) poolGenericAvailable += leftover;
    }
    remaining.generic = Math.max(0, remaining.generic - poolGenericAvailable);

    const totalRemaining = remaining.W + remaining.U + remaining.B + remaining.R + remaining.G + remaining.C + remaining.generic;
    if (totalRemaining === 0) return { newEngineState: state, success: true, deficit: null, tappedNames: [] };

    const sources: { instanceId: string; name: string; colors: ManaColor[] }[] = [];
    state.cards.forEach((card) => {
      if (card.zone === 'battlefield' && card.ownerId === playerId && !card.tapped) {
        const def = state.cardDefinitions.get(card.definitionId);
        if (card.summoningSick && def && !def.card_types.includes('land')) return;
        const colors = getManaColorsFromCard(state, card.instanceId);
        if (colors.length > 0) sources.push({ instanceId: card.instanceId, name: def?.name || 'Unknown', colors });
      }
    });
    sources.sort((a, b) => a.colors.length - b.colors.length);

    const toTap: { instanceId: string; name: string; color: ManaColor }[] = [];
    for (const color of ['W', 'U', 'B', 'R', 'G', 'C'] as ManaColor[]) {
      while (remaining[color] > 0) {
        const idx = sources.findIndex(s => s.colors.includes(color));
        if (idx === -1) break;
        toTap.push({ instanceId: sources[idx].instanceId, name: sources[idx].name, color });
        remaining[color]--;
        sources.splice(idx, 1);
      }
    }
    while (remaining.generic > 0 && sources.length > 0) {
      const source = sources.shift()!;
      toTap.push({ instanceId: source.instanceId, name: source.name, color: source.colors[0] });
      remaining.generic--;
    }

    const deficit: ManaDeficit = {};
    for (const color of ['W', 'U', 'B', 'R', 'G', 'C'] as ManaColor[]) {
      if (remaining[color] > 0) deficit[color] = remaining[color];
    }
    if (remaining.generic > 0) deficit['generic'] = remaining.generic;
    if (Object.keys(deficit).length > 0) return { newEngineState: state, success: false, deficit, tappedNames: [] };

    let newState = state;
    for (const tap of toTap) {
      try { newState = tapLandForMana(newState, playerId, tap.instanceId, tap.color); }
      catch { return { newEngineState: state, success: false, deficit: { generic: 1 }, tappedNames: [] }; }
    }
    return { newEngineState: newState, success: true, deficit: null, tappedNames: toTap.map(t => t.name) };
  }

  function formatAbilityCost(ability: ActivatedAbility): string {
    const parts: string[] = [];
    if (ability.cost.tap) parts.push('{T}');
    if (ability.cost.sacrifice === 'self') parts.push('Sacrifice');
    if (ability.cost.mana) parts.push(ability.cost.mana);
    return parts.join(', ') || 'Free';
  }

  const activateAbilityAction = useCallback((cardId: string, abilityIndex: number) => {
    const es = engineStateRef.current;
    if (!es) return;
    const card = es.cards.get(cardId);
    const def = card ? es.cardDefinitions.get(card.definitionId) : null;
    if (!card || !def) return;

    // Check if this is a non-mana activated ability handled by the engine
    const abilities = engineGetActivatedAbilities(es, cardId);
    if (abilities.length > 0 && abilityIndex < abilities.length) {
      if (!engineCanActivateAbility(es, 'human', cardId, abilityIndex)) {
        addLog(`Cannot activate ${def.name}'s ability right now.`, 'info');
        return;
      }

      try {
        // Auto-tap for mana cost if needed
        let stateForActivate = es;
        const ability = abilities[abilityIndex];
        if (ability.cost.mana) {
          const manaCost = parseManaString(ability.cost.mana);
          const player = stateForActivate.players.find(p => p.id === 'human');
          if (player && !canPayCost(player.manaPool, manaCost)) {
            // Build a temporary card ID for auto-tap (reuse the mana cost auto-tap logic)
            // We need to manually find and tap sources
            const tapResult = autoTapForManaCost(stateForActivate, 'human', ability.cost.mana);
            if (!tapResult.success) {
              addLog(`Not enough mana to activate ${def.name}'s ability.`, 'info');
              return;
            }
            stateForActivate = tapResult.newEngineState;
            if (tapResult.tappedNames.length > 0) {
              addLog(`Auto-tapped ${tapResult.tappedNames.join(', ')}`, 'action');
            }
          }
        }

        let newState = engineActivateAbility(stateForActivate, 'human', cardId, abilityIndex);
        const costDesc = formatAbilityCost(ability);
        addLog(`Activated ${def.name} (${costDesc})`, 'action');

        // Resolve stack
        newState = resolveStackFully(newState);
        updateState(newState);
        setSelectedCard(null);
        return;
      } catch (err) {
        addLog(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'info');
        return;
      }
    }

    // Fallback: mana ability (old behavior)
    if (def.oracle_text.includes('{T}: Add {') || def.oracle_text.includes('({T}: Add {')) {
      const match = def.oracle_text.match(/Add \{([WUBRGC])\}/);
      if (match && !card.tapped && card.zone === 'battlefield') {
        if (card.summoningSick && !def.card_types.includes('land')) {
          addLog(`${def.name} has summoning sickness.`, 'info');
          return;
        }
        try {
          const newState = tapLandForMana(es, 'human', cardId, match[1] as ManaColor);
          updateState(newState);
          addLog(`${def.name} adds {${match[1]}}`, 'action');
          return;
        } catch {
          // Fall through
        }
      }
    }
    addLog('Cannot activate ability.', 'info');
  }, [addLog, updateState]);

  const castSpellAction = useCallback((cardId: string, targets: string[] = []) => {
    const es = engineStateRef.current;
    if (!es) return;
    const card = es.cards.get(cardId);
    const def = card ? es.cardDefinitions.get(card.definitionId) : null;

    const timing = canCastTiming(es, 'human', cardId);
    if (!timing.ok) {
      addLog(timing.reason, 'info');
      return;
    }

    // Handle targeting — only for instants/sorceries (non-permanents).
    // Permanents with "target" in oracle text have ETB triggers that handle targeting separately.
    if (def && targets.length === 0) {
      const isPermanent = def.card_types.some(t =>
        ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle'].includes(t));
      const isTargetedSpell = !isPermanent && def.oracle_text.toLowerCase().includes('target');

      if (isTargetedSpell) {
        // Check mana before entering targeting mode
        if (!canCastWithAutoTapCheck(es, 'human', cardId)) {
          const result = autoTapForCost(es, 'human', cardId);
          addLog(formatManaDeficit(def.mana_cost, result.deficit), 'info');
          return;
        }

        // Determine target type from oracle text or parser
        let targetType: 'creature' | 'player' | 'any' | 'permanent' = 'any';
        const parsed = parseOracleText(def.oracle_text, def.mana_cost);
        if (parsed.kind === 'Spell' && parsed.targets.length > 0) {
          const spec = parsed.targets[0];
          if (spec.type === 'Creature') targetType = 'creature';
          else if (spec.type === 'Player') targetType = 'player';
          else targetType = 'any';
        } else {
          // Fallback to text matching
          if (def.oracle_text.toLowerCase().includes('target creature')) targetType = 'creature';
          else if (def.oracle_text.toLowerCase().includes('target player')) targetType = 'player';
        }

        // Check if valid targets exist before entering targeting mode
        const validTargets = getValidTargetsForType(es, targetType);
        if (validTargets.length === 0) {
          addLog(`No valid targets for ${def.name}`, 'info');
          return;
        }

        startTargeting(cardId, targetType, 1);
        addLog(`Select a target for ${def.name}`, 'info');
        return;
      }
    }

    try {
      let stateForCast = es;
      let tappedNames: string[] = [];

      // Auto-tap if pool doesn't cover cost
      const cost = getEffectiveManaCost(es, 'human', cardId);
      const player = es.players.find(p => p.id === 'human');
      if (player && !canPayCost(player.manaPool, cost)) {
        const tapResult = autoTapForCost(es, 'human', cardId);
        if (!tapResult.success) {
          addLog(formatManaDeficit(def?.mana_cost || '', tapResult.deficit), 'info');
          return;
        }
        stateForCast = tapResult.newEngineState;
        tappedNames = tapResult.tappedNames;
      }

      let newState = engineCastSpell(stateForCast, 'human', cardId, targets);

      if (tappedNames.length > 0) {
        addLog(`Auto-tapped ${tappedNames.join(', ')} — Cast ${def?.name ?? 'spell'}`, 'spell');
      } else {
        addLog(`Cast ${def?.name ?? 'spell'}`, 'spell');
      }

      // Resolve stack
      newState = resolveStackFully(newState);
      updateState(newState);
      setSelectedCard(null);
    } catch (err) {
      addLog(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'info');
    }
  }, [addLog, startTargeting, updateState]);

  // ===== Priority & Turn Management =====

  const passPriorityAction = useCallback(() => {
    const es = engineStateRef.current;
    if (!es) return;

    addLog('You passed priority', 'action');

    // Pass priority, then check if all players passed
    let newState = passPriority(es);

    // If all players passed with empty stack, advance step
    if (allPlayersPassed(newState) && newState.stack.length === 0) {
      newState = advanceStep(newState);
      // Handle untap step
      if (newState.step === 'untap') {
        newState = performUntapStep(newState);
        newState = advanceStep(newState); // Move to upkeep
      }
      // Handle draw step
      if (newState.step === 'draw') {
        newState = drawCards(newState, newState.players[newState.activePlayerIndex].id, 1);
        addLog('Drew a card', 'action');
        newState = advanceStep(newState); // Move to main phase
      }
      newState = checkStateBasedActions(newState);
      addLog(`Advanced to ${newState.phase === 'precombat_main' ? 'Main 1' : newState.phase === 'postcombat_main' ? 'Main 2' : newState.step}`, 'info');
    } else if (allPlayersPassed(newState) && newState.stack.length > 0) {
      // All passed with stack items — resolve top
      newState = resolveTopOfStack(newState);
      newState = putTriggersOnStack(newState);
      newState = checkStateBasedActions(newState);
      addLog('Stack item resolved', 'spell');
    }

    updateState(newState);

    // Check if AI now has priority
    scheduleAIIfNeeded(newState);
  }, [addLog, updateState]);

  const declareAttackerAction = useCallback((cardId: string, defendingPlayerId?: string) => {
    const es = engineStateRef.current;
    if (!es) return;

    // Allow declaring attackers during main phase too (UI enters combat)
    const testState = es.step === 'declare_attackers' ? es : { ...es, step: 'declare_attackers' as Step };
    if (!canDeclareAttacker(testState, 'human', cardId)) {
      addLog('Cannot attack with this creature.', 'info');
      return;
    }

    const def = es.cardDefinitions.get(es.cards.get(cardId)?.definitionId ?? '');
    pendingAttackers.current = [
      ...pendingAttackers.current.filter(a => a.cardInstanceId !== cardId),
      { cardInstanceId: cardId, defendingPlayerId: defendingPlayerId || aiPlayers[0]?.id || 'ai1' },
    ];
    addLog(`${def?.name ?? 'Creature'} declared as attacker`, 'combat');
  }, [aiPlayers, addLog]);

  const confirmAttackersAction = useCallback(() => {
    const es = engineStateRef.current;
    if (!es) return;

    let newState: EngineGameState = { ...es, step: 'declare_attackers' as Step, phase: 'combat' as Phase };

    if (pendingAttackers.current.length === 0) {
      addLog('No attackers - skipping combat', 'combat');
      newState = { ...newState, step: 'end_of_combat' as Step, phase: 'postcombat_main' as Phase };
      updateState(newState);
      pendingAttackers.current = [];
      return;
    }

    try {
      newState = declareAttackers(newState, 'human', pendingAttackers.current);
      addLog(`${pendingAttackers.current.length} creature(s) attacking!`, 'combat');
      pendingAttackers.current = [];

      // Move to declare blockers step
      newState = { ...newState, step: 'declare_blockers' as Step };

      // AI auto-blocks
      for (const aiPlayer of newState.players.filter(p => p.id !== 'human' && !p.hasLost)) {
        const config = aiConfigRef.current.get(aiPlayer.id);
        if (config) {
          const decision = makeDecision(newState, config);
          if (decision && decision.action.kind === 'DeclareBlockers') {
            newState = decision.newState;
            for (const block of decision.action.blocks) {
              const blockerDef = newState.cardDefinitions.get(newState.cards.get(block.cardInstanceId)?.definitionId ?? '');
              const attackerDef = newState.cardDefinitions.get(newState.cards.get(block.blockingAttackerId)?.definitionId ?? '');
              addLog(`AI's ${blockerDef?.name ?? 'creature'} blocks ${attackerDef?.name ?? 'attacker'}`, 'ai');
            }
          }
        }
      }

      updateState(newState);
    } catch (err) {
      addLog(`Combat error: ${err instanceof Error ? err.message : 'Unknown error'}`, 'info');
    }
  }, [addLog, updateState]);

  const declareBlockerAction = useCallback((blockerId: string, attackerId: string) => {
    const es = engineStateRef.current;
    if (!es) return;
    if (!canDeclareBlocker(es, 'human', blockerId, attackerId)) {
      addLog('Cannot block with this creature.', 'info');
      return;
    }
    const blockerDef = es.cardDefinitions.get(es.cards.get(blockerId)?.definitionId ?? '');
    const attackerDef = es.cardDefinitions.get(es.cards.get(attackerId)?.definitionId ?? '');
    pendingBlockers.current = [
      ...pendingBlockers.current.filter(b => b.cardInstanceId !== blockerId),
      { cardInstanceId: blockerId, blockingAttackerId: attackerId },
    ];
    addLog(`${blockerDef?.name ?? 'Creature'} blocks ${attackerDef?.name ?? 'attacker'}`, 'combat');
  }, [addLog]);

  const confirmBlockersAction = useCallback(() => {
    const es = engineStateRef.current;
    if (!es || es.step !== 'declare_blockers') return;

    let newState = es;
    if (pendingBlockers.current.length > 0) {
      try {
        newState = declareBlockers(newState, 'human', pendingBlockers.current);
      } catch (err) {
        addLog(`Block error: ${err instanceof Error ? err.message : 'Unknown'}`, 'info');
      }
      pendingBlockers.current = [];
    }

    // Resolve combat damage
    newState = { ...newState, step: 'combat_damage' as Step };
    try {
      newState = resolveCombatDamage(newState);
      addLog('Combat damage dealt!', 'damage');
    } catch (err) {
      addLog(`Combat damage error: ${err instanceof Error ? err.message : 'Unknown'}`, 'info');
    }
    newState = checkStateBasedActions(newState);
    newState = { ...newState, step: 'end_of_combat' as Step };
    updateState(newState);
  }, [addLog, updateState]);

  const respondToStack = useCallback(() => {
    const es = engineStateRef.current;
    if (!es || es.stack.length === 0) return;
    try {
      let newState = resolveTopOfStack(es);
      newState = putTriggersOnStack(newState);
      newState = checkStateBasedActions(newState);
      addLog('Stack item resolved', 'spell');
      updateState(newState);
    } catch (err) {
      addLog(`Stack error: ${err instanceof Error ? err.message : 'Unknown'}`, 'info');
    }
  }, [addLog, updateState]);

  const endTurn = useCallback(() => {
    const es = engineStateRef.current;
    if (!es) return;

    const adapted = adaptGameState(es);
    if (adapted.gameOver) return;

    let newState = advanceToNextTurn(es);
    // Untap and draw for next player
    newState = performUntapStep(newState);
    newState = drawCards(newState, newState.players[newState.activePlayerIndex].id, 1);
    newState = { ...newState, phase: 'precombat_main' as Phase, step: 'upkeep' as Step };
    newState = checkStateBasedActions(newState);

    const activePlayer = newState.players[newState.activePlayerIndex];
    addLog(`Turn ${newState.turnNumber} - ${activePlayer.name}'s turn`, 'info');

    updateState(newState);

    // If it's an AI's turn, schedule their actions
    if (activePlayer.id !== 'human') {
      scheduleAITurn(newState);
    }
  }, [addLog, updateState]);

  // ===== AI Turn Handling =====

  const scheduleAIIfNeeded = useCallback((state: EngineGameState) => {
    const priorityPlayer = state.players[state.priorityPlayerIndex];
    if (priorityPlayer && priorityPlayer.id !== 'human' && !priorityPlayer.hasLost && !aiThinkingRef.current) {
      const adapted = adaptGameState(state);
      if (!adapted.gameOver) {
        scheduleAIAction(state, priorityPlayer.id);
      }
    }
  }, []); // eslint-disable-line

  const scheduleAIAction = useCallback((state: EngineGameState, aiPlayerId: string) => {
    if (aiThinkingRef.current) return;
    aiThinkingRef.current = true;

    setTimeout(() => {
      const config = aiConfigRef.current.get(aiPlayerId);
      if (!config) {
        aiThinkingRef.current = false;
        return;
      }

      const decision = makeDecision(state, config);
      if (!decision) {
        aiThinkingRef.current = false;
        return;
      }

      let newState = decision.newState;
      const action = decision.action;

      // Log the decision
      switch (action.kind) {
        case 'PlayLand': {
          const def = newState.cardDefinitions.get(newState.cards.get(action.cardInstanceId)?.definitionId ?? '');
          addLog(`AI played ${def?.name ?? 'land'}`, 'ai');
          break;
        }
        case 'CastSpell': {
          const def = newState.cardDefinitions.get(newState.cards.get(action.cardInstanceId)?.definitionId ?? '');
          addLog(`AI cast ${def?.name ?? 'spell'}`, 'ai');
          // Resolve the stack after casting
          newState = resolveStackFully(newState);
          break;
        }
        case 'DeclareAttackers': {
          for (const attack of action.attacks) {
            const def = newState.cardDefinitions.get(newState.cards.get(attack.cardInstanceId)?.definitionId ?? '');
            addLog(`AI's ${def?.name ?? 'creature'} attacks!`, 'ai');
          }
          // Auto-resolve combat for AI
          newState = { ...newState, step: 'combat_damage' as Step };
          try {
            newState = resolveCombatDamage(newState);
            addLog('AI dealt combat damage!', 'damage');
          } catch {
            // Combat may fail if no combat state
          }
          break;
        }
        case 'ActivateManaAbility': {
          // Silent — just mana tapping
          break;
        }
        case 'ActivateAbility': {
          const def = newState.cardDefinitions.get(newState.cards.get(action.cardInstanceId)?.definitionId ?? '');
          addLog(`AI activated ${def?.name ?? 'permanent'}'s ability`, 'ai');
          newState = resolveStackFully(newState);
          break;
        }
        case 'PassPriority': {
          // AI passed — check if we should advance
          if (allPlayersPassed(newState) && newState.stack.length === 0) {
            newState = advanceStep(newState);
            if (newState.step === 'untap') {
              newState = performUntapStep(newState);
              newState = advanceStep(newState);
            }
            if (newState.step === 'draw') {
              newState = drawCards(newState, newState.players[newState.activePlayerIndex].id, 1);
              newState = advanceStep(newState);
            }
          }
          break;
        }
        case 'DeclareBlockers': {
          for (const block of action.blocks) {
            const def = newState.cardDefinitions.get(newState.cards.get(block.cardInstanceId)?.definitionId ?? '');
            addLog(`AI blocks with ${def?.name ?? 'creature'}`, 'ai');
          }
          break;
        }
      }

      newState = checkStateBasedActions(newState);
      updateState(newState);
      aiThinkingRef.current = false;

      // Check if game is over
      const adapted = adaptGameState(newState);
      if (adapted.gameOver) {
        addLog(adapted.winnerId === 'human' ? 'YOU WIN!' : 'You lost...', 'info');
        return;
      }

      // If AI still has priority, continue
      const nextPriority = newState.players[newState.priorityPlayerIndex];
      if (nextPriority && nextPriority.id !== 'human' && !nextPriority.hasLost) {
        scheduleAIAction(newState, nextPriority.id);
      }
    }, 600);
  }, [addLog, updateState]); // eslint-disable-line

  const scheduleAITurn = useCallback((state: EngineGameState) => {
    if (aiThinkingRef.current) return;
    aiThinkingRef.current = true;
    addLog('AI is thinking...', 'ai');

    setTimeout(() => {
      const activePlayer = state.players[state.activePlayerIndex];
      const config = aiConfigRef.current.get(activePlayer.id);
      if (!config) {
        aiThinkingRef.current = false;
        return;
      }

      // Use engine's runAITurn for a complete turn
      const { finalState, decisions } = engineRunAITurn(state, config);
      let newState = finalState;

      // Log decisions
      for (const decision of decisions) {
        const action = decision.action;
        switch (action.kind) {
          case 'PlayLand': {
            const def = newState.cardDefinitions.get(newState.cards.get(action.cardInstanceId)?.definitionId ?? '');
            addLog(`AI played ${def?.name ?? 'land'}`, 'ai');
            break;
          }
          case 'CastSpell': {
            const def = newState.cardDefinitions.get(newState.cards.get(action.cardInstanceId)?.definitionId ?? '');
            addLog(`AI cast ${def?.name ?? 'spell'}${decision.reasoning ? ` (${decision.reasoning})` : ''}`, 'ai');
            break;
          }
          case 'DeclareAttackers': {
            for (const attack of action.attacks) {
              const def = newState.cardDefinitions.get(newState.cards.get(attack.cardInstanceId)?.definitionId ?? '');
              addLog(`AI's ${def?.name ?? 'creature'} attacks!`, 'ai');
            }
            break;
          }
          default:
            break;
        }
      }

      // If AI declared attackers, resolve combat
      if (newState.combat && newState.combat.attackers.length > 0) {
        newState = { ...newState, step: 'combat_damage' as Step };
        try {
          newState = resolveCombatDamage(newState);
          addLog('AI dealt combat damage!', 'damage');
        } catch {
          // No combat to resolve
        }
      }

      // Resolve any remaining stack items
      newState = resolveStackFully(newState);
      newState = checkStateBasedActions(newState);

      // Check game over
      const adapted = adaptGameState(newState);
      if (adapted.gameOver) {
        addLog(adapted.winnerId === 'human' ? 'YOU WIN!' : 'You lost...', 'info');
        updateState(newState);
        aiThinkingRef.current = false;
        return;
      }

      // Pass turn back to human
      newState = advanceToNextTurn(newState);
      newState = performUntapStep(newState);
      newState = drawCards(newState, 'human', 1);
      newState = { ...newState, phase: 'precombat_main' as Phase, step: 'upkeep' as Step };
      newState = checkStateBasedActions(newState);

      addLog(`Turn ${newState.turnNumber} - Your turn`, 'info');
      addLog('Drew a card', 'action');

      updateState(newState);
      aiThinkingRef.current = false;

      // Check again if AI somehow still has priority
      const nextActive = newState.players[newState.activePlayerIndex];
      if (nextActive.id !== 'human' && !nextActive.hasLost) {
        scheduleAITurn(newState);
      }
    }, 1000);
  }, [addLog, updateState]); // eslint-disable-line

  // ===== Stack Resolution Helper =====

  function resolveStackFully(state: EngineGameState): EngineGameState {
    let current = state;
    let iterations = 0;
    while (current.stack.length > 0 && iterations < 50) {
      // Step 1: Resolve the top of stack — if this throws, the spell fizzles
      try {
        current = resolveTopOfStack(current);
      } catch (err) {
        console.warn('[resolveStackFully] resolveTopOfStack threw:', err);
        // Spell fizzled (e.g. invalid targets) — remove from stack and move to graveyard
        if (current.stack.length > 0) {
          const topItem = current.stack[current.stack.length - 1];
          const newStack = current.stack.slice(0, -1);
          const newCards = new Map(current.cards);
          if ('cardInstanceId' in topItem) {
            const card = newCards.get(topItem.cardInstanceId);
            if (card) {
              newCards.set(topItem.cardInstanceId, { ...card, zone: 'graveyard' as Zone });
            }
          }
          current = { ...current, stack: newStack, cards: newCards };
          addLog('Spell fizzled', 'info');
        } else {
          break;
        }
        iterations++;
        continue;
      }

      // Step 2: Post-resolution cleanup — errors here should NOT undo the resolution
      try {
        current = putTriggersOnStack(current);
      } catch (err) {
        console.warn('[resolveStackFully] putTriggersOnStack threw:', err);
      }
      try {
        current = checkStateBasedActions(current);
      } catch (err) {
        console.warn('[resolveStackFully] checkStateBasedActions threw:', err);
      }

      iterations++;
    }
    return current;
  }

  // ===== Mulligan =====

  const mulliganAction = useCallback(() => {
    const es = engineStateRef.current;
    if (!es) return;

    const newCards = new Map(es.cards);
    // Move all human hand cards back to library
    newCards.forEach((card, id) => {
      if (card.ownerId === 'human' && card.zone === 'hand') {
        newCards.set(id, { ...card, zone: 'library' as Zone });
      }
    });
    // Gather all human library cards and shuffle
    const libraryIds: string[] = [];
    newCards.forEach((card, id) => {
      if (card.ownerId === 'human' && card.zone === 'library') {
        libraryIds.push(id);
      }
    });
    const shuffled = shuffleArray(libraryIds);
    // Draw 7
    for (let i = 0; i < Math.min(7, shuffled.length); i++) {
      const card = newCards.get(shuffled[i])!;
      newCards.set(shuffled[i], { ...card, zone: 'hand' as Zone });
    }

    const newCount = mulliganCount + 1;
    const newState = { ...es, cards: newCards };
    updateState(newState);
    setMulliganCount(newCount);
    addLog(`Mulligan #${newCount} — drew 7 new cards`, 'action');
  }, [mulliganCount, addLog, updateState]);

  const keepHandAction = useCallback(() => {
    const es = engineStateRef.current;
    if (!es) return;

    if (mulliganCount > 1) {
      const putBack = mulliganCount - 1;
      setPutBackCount(putBack);
      addLog(`Kept hand — put ${putBack} card${putBack > 1 ? 's' : ''} on bottom`, 'action');
    } else {
      // Advance phase to precombat_main so cards can be played
      const advancedState = { ...es, phase: 'precombat_main' as Phase, step: 'begin_combat' as Step };
      updateState(advancedState);

      setMulliganActive(false);
      addLog(mulliganCount === 1 ? 'Kept hand after free mulligan' : 'Kept opening hand', 'action');
      addLog('Game started! You have 40 life.', 'info');
      addLog(`Turn 1 - Your turn. Main Phase 1.`, 'info');
      const commanderCards = getCardsInZone(advancedState, 'human', 'command');
      if (commanderCards.length > 0) {
        const def = advancedState.cardDefinitions.get(commanderCards[0].definitionId);
        addLog(`Your commander is ${def?.name}`, 'info');
      }
    }
  }, [mulliganCount, addLog, updateState]);

  const putBackCardAction = useCallback((cardId: string) => {
    const es = engineStateRef.current;
    if (!es) return;

    const newCards = new Map(es.cards);
    const card = newCards.get(cardId);
    if (card && card.zone === 'hand') {
      newCards.set(cardId, { ...card, zone: 'library' as Zone });
    }

    const newState = { ...es, cards: newCards };
    updateState(newState);

    const remaining = putBackCount - 1;
    setPutBackCount(remaining);
    const def = card ? es.cardDefinitions.get(card.definitionId) : null;
    addLog(`Put ${def?.name ?? 'card'} on bottom of library`, 'action');

    if (remaining === 0) {
      // Advance phase to precombat_main so cards can be played
      const advancedState = { ...newState, phase: 'precombat_main' as Phase, step: 'begin_combat' as Step };
      updateState(advancedState);

      setMulliganActive(false);
      addLog('Game started! You have 40 life.', 'info');
      addLog(`Turn 1 - Your turn. Main Phase 1.`, 'info');
      const commanderCards = getCardsInZone(advancedState, 'human', 'command');
      if (commanderCards.length > 0) {
        const cDef = advancedState.cardDefinitions.get(commanderCards[0].definitionId);
        addLog(`Your commander is ${cDef?.name}`, 'info');
      }
    }
  }, [putBackCount, addLog, updateState]);

  // ===== Game Initialization =====

  const startGame = useCallback((config: GameConfig) => {
    setIsLoading(true);
    setError(null);
    setGameLog([]);
    pendingAttackers.current = [];
    pendingBlockers.current = [];
    aiThinkingRef.current = false;

    const initFromState = (state: EngineGameState, aiIds: string[], difficulty: number) => {
      // Set up AI configs
      aiConfigRef.current = new Map();
      for (let i = 0; i < aiIds.length; i++) {
        const personality = (config.personalities[i] || 'Balanced') as AIPersonality;
        aiConfigRef.current.set(aiIds[i], {
          playerId: aiIds[i],
          difficulty: Math.min(5, Math.max(1, difficulty)) as AIDifficulty,
          personality,
        });
      }

      updateState(state);
      setMulliganActive(true);
      setMulliganCount(0);
      setPutBackCount(0);
      addLog('Opening hand dealt — mulligan or keep?', 'info');
      setIsLoading(false);
    };

    if (config.deckId === 'test-deck') {
      // Use a test game with the engine's initGameFromDecks
      try {
        // Create simple test decks
        const humanDeck: GeneratedDeck = {
          id: 'test-human',
          commander: 'Goreclaw, Terror of Qal Sisma',
          list: Array(99).fill('Forest'),
          colors: ['G'],
          bracket: 1,
          theme: 'test',
        };

        const aiDeck: GeneratedDeck = {
          id: 'test-ai',
          commander: 'Talrand, Sky Summoner',
          list: Array(99).fill('Island'),
          colors: ['U'],
          bracket: 1,
          theme: 'test',
        };

        // We need card data — for test deck, create a minimal lookup
        const testCards: ScryfallCard[] = [
          { id: 'goreclaw', name: 'Goreclaw, Terror of Qal Sisma', type_line: 'Legendary Creature — Bear', oracle_text: 'Creature spells you cast with power 4 or greater cost {2} less to cast.', mana_cost: '{3}{G}', cmc: 4, colors: ['G'], color_identity: ['G'], keywords: [], power: '4', toughness: '3' },
          { id: 'talrand', name: 'Talrand, Sky Summoner', type_line: 'Legendary Creature — Merfolk Wizard', oracle_text: 'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.', mana_cost: '{2}{U}{U}', cmc: 4, colors: ['U'], color_identity: ['U'], keywords: [], power: '2', toughness: '2' },
          { id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [] },
          { id: 'island', name: 'Island', type_line: 'Basic Land — Island', oracle_text: '({T}: Add {U}.)', mana_cost: '', cmc: 0, colors: [], color_identity: ['U'], keywords: [] },
        ];

        const lookup = createCardLookup(testCards);
        const gameInitConfig: GameInitConfig = {
          humanDeck,
          aiDecks: [aiDeck],
          aiDifficulty: config.difficulty,
          cardLookup: lookup,
          humanGoesFirst: true,
        };

        const state = initGameFromDecks(gameInitConfig);
        initFromState(state, ['ai1'], config.difficulty);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start game');
        setIsLoading(false);
      }
    } else {
      // Fetch real deck from API
      fetchDeckAndCards(config.deckId)
        .then(async ({ deck, cardLookup, scryfallCards, facesMap }) => {
          cardFacesMapRef.current = facesMap;
          // Build human deck
          const parsedEntries = deck.list
            .map(parseDeckListEntry)
            .filter(e => e.name !== deck.commander);
          const expandedNames: string[] = [];
          for (const entry of parsedEntries) {
            for (let i = 0; i < entry.quantity; i++) {
              expandedNames.push(entry.name);
            }
          }

          // Pad short decks with basic lands to reach 99
          if (expandedNames.length < 99) {
            const landNames: Record<string, string> = {
              'W': 'Plains', 'U': 'Island', 'B': 'Swamp', 'R': 'Mountain', 'G': 'Forest',
            };
            const deckColors = deck.colors.length > 0 ? deck.colors : ['U'];
            const deficit = 99 - expandedNames.length;
            const perColor = Math.floor(deficit / deckColors.length);
            const remainder = deficit % deckColors.length;
            for (let i = 0; i < deckColors.length; i++) {
              const landName = landNames[deckColors[i]] || 'Island';
              const count = perColor + (i < remainder ? 1 : 0);
              for (let j = 0; j < count; j++) {
                expandedNames.push(landName);
              }
            }
          }

          const humanDeck: GeneratedDeck = {
            id: deck.id,
            commander: deck.commander,
            list: expandedNames,
            colors: deck.colors,
            bracket: deck.bracket || 3,
            theme: deck.theme || 'general',
          };

          // Create AI decks — use simple land-based decks for now
          // (future: fetch real AI decks from backend)
          const aiDecks: GeneratedDeck[] = [];
          const aiCommanders = ['Talrand, Sky Summoner', 'Goreclaw, Terror of Qal Sisma', 'Teysa Karlov'];
          const aiCommanderColors: Record<string, string[]> = {
            'Talrand, Sky Summoner': ['U'],
            'Goreclaw, Terror of Qal Sisma': ['G'],
            'Teysa Karlov': ['W', 'B'],
          };

          for (let i = 0; i < config.opponentCount; i++) {
            const cmdr = aiCommanders[i % aiCommanders.length];
            // Check if the commander is in our card data
            const cmdrData = cardLookup(cmdr);
            if (cmdrData) {
              aiDecks.push(createSimpleAIDeck(cmdr, aiCommanderColors[cmdr] || ['U']));
            } else {
              // Fall back to basic land deck with a known commander
              aiDecks.push(createSimpleAIDeck('Island', ['U']));
            }
          }

          // Ensure AI commander cards are in the lookup
          const aiCommanderCards: ScryfallCard[] = [
            { id: 'talrand', name: 'Talrand, Sky Summoner', type_line: 'Legendary Creature — Merfolk Wizard', oracle_text: 'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.', mana_cost: '{2}{U}{U}', cmc: 4, colors: ['U'], color_identity: ['U'], keywords: [], power: '2', toughness: '2' },
            { id: 'goreclaw', name: 'Goreclaw, Terror of Qal Sisma', type_line: 'Legendary Creature — Bear', oracle_text: 'Creature spells you cast with power 4 or greater cost {2} less to cast.', mana_cost: '{3}{G}', cmc: 4, colors: ['G'], color_identity: ['G'], keywords: [], power: '4', toughness: '3' },
            { id: 'teysa', name: 'Teysa Karlov', type_line: 'Legendary Creature — Human Advisor', oracle_text: "If a creature dying causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.", mana_cost: '{2}{W}{B}', cmc: 4, colors: ['W', 'B'], color_identity: ['W', 'B'], keywords: [], power: '2', toughness: '4' },
            { id: 'plains', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '({T}: Add {W}.)', mana_cost: '', cmc: 0, colors: [], color_identity: ['W'], keywords: [] },
            { id: 'island', name: 'Island', type_line: 'Basic Land — Island', oracle_text: '({T}: Add {U}.)', mana_cost: '', cmc: 0, colors: [], color_identity: ['U'], keywords: [] },
            { id: 'swamp', name: 'Swamp', type_line: 'Basic Land — Swamp', oracle_text: '({T}: Add {B}.)', mana_cost: '', cmc: 0, colors: [], color_identity: ['B'], keywords: [] },
            { id: 'mountain', name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '({T}: Add {R}.)', mana_cost: '', cmc: 0, colors: [], color_identity: ['R'], keywords: [] },
            { id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [] },
          ];

          const allCards = [...scryfallCards, ...aiCommanderCards];
          const fullLookup = createCardLookup(allCards);

          const gameInitConfig: GameInitConfig = {
            humanDeck,
            aiDecks,
            aiDifficulty: config.difficulty,
            cardLookup: fullLookup,
            aiPersonalities: config.personalities.map(p => (p || 'Balanced') as AIPersonality),
            humanGoesFirst: true,
          };

          const state = initGameFromDecks(gameInitConfig);
          const aiIds = aiDecks.map((_, i) => `ai${i + 1}`);
          initFromState(state, aiIds, config.difficulty);
        })
        .catch(err => {
          setError(err instanceof Error ? err.message : 'Failed to load deck');
          setIsLoading(false);
        });
    }
  }, [addLog, updateState]);

  // ===== Return the GameEngine interface =====

  return {
    gameState: frontendState,
    isLoading,
    error,
    gameLog,
    selectedCard,
    humanPlayer: humanPlayer as Player | null,
    aiPlayers: aiPlayers as Player[],
    targeting,
    mulliganActive,
    mulliganCount,
    putBackCount,
    getHandCards,
    getBattlefieldCards,
    getGraveyardCards,
    getExileCards,
    getCommandZoneCards,
    getLibraryCount,
    getStackItems,
    getCardDef,
    getCardById,
    getCardFaces,
    canAffordSpell,
    getManaFromLand,
    getManaInfo,
    canCastWithAutoTap,
    selectCard,
    playLandAction,
    castSpellAction,
    tapForMana,
    activateAbility: activateAbilityAction,
    passPriorityAction,
    startTargeting,
    selectTarget,
    cancelTargeting,
    confirmTargets,
    declareAttacker: declareAttackerAction,
    declareBlocker: declareBlockerAction,
    confirmAttackers: confirmAttackersAction,
    confirmBlockers: confirmBlockersAction,
    respondToStack,
    endTurn,
    startGame,
    mulliganAction,
    keepHandAction,
    putBackCardAction,
  };
}
