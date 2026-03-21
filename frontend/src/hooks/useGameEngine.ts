import { useState, useCallback, useRef } from 'react';

// ============== TYPE DEFINITIONS (mirroring engine/src/types.ts) ==============

export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
export type ManaPool = Record<ManaColor, number>;
export type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command' | 'stack';
export type Phase = 'beginning' | 'precombat_main' | 'combat' | 'postcombat_main' | 'ending';
export type Step = 'untap' | 'upkeep' | 'draw' | 'begin_combat' | 'declare_attackers' | 'declare_blockers' | 'first_strike_damage' | 'combat_damage' | 'end_of_combat' | 'end' | 'cleanup';
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

export interface CardInstance {
  instanceId: string;
  definitionId: string;
  ownerId: string;
  controllerId: string;
  zone: Zone;
  tapped: boolean;
  summoningSick: boolean;
  counters: Record<string, number>;
  damage: number;
  isCommander: boolean;
  isAttacking: boolean;
  isBlocking: string | null;
  blockedBy: string[];
}

export interface CardDefinition {
  id: string;
  name: string;
  type_line: string;
  oracle_text: string;
  mana_cost: string;
  cmc: number;
  colors: string[];
  color_identity: string[];
  keywords: string[];
  card_types: CardType[];
  power?: number;
  toughness?: number;
}

export interface AttackerDeclaration {
  cardInstanceId: string;
  defendingPlayerId: string;
}

export interface BlockerDeclaration {
  cardInstanceId: string;
  blockingAttackerId: string;
}

export interface CombatState {
  attackers: AttackerDeclaration[];
  blockers: BlockerDeclaration[];
  damageAssignment: Map<string, number>;
}

export interface StackItem {
  id: string;
  cardInstanceId: string;
  casterId: string;
  targets: string[];
}

export interface GameState {
  players: Player[];
  cards: Map<string, CardInstance>;
  cardDefinitions: Map<string, CardDefinition>;
  activePlayerIndex: number;
  priorityPlayerIndex: number;
  phase: Phase;
  step: Step;
  turnNumber: number;
  hasPriorityPassed: boolean[];
  stack: StackItem[];
  combat: CombatState | null;
  battlefieldAbilities: Map<string, unknown>;
  pendingTriggers: unknown[];
  gameOver: boolean;
  winnerId: string | null;
}

// ============== GAME LOG ==============

export interface LogEntry {
  timestamp: Date;
  message: string;
  type: 'info' | 'action' | 'combat' | 'spell' | 'ai' | 'damage' | 'trigger';
}

// ============== TARGETING ==============

export interface TargetingState {
  isTargeting: boolean;
  sourceCardId: string | null;
  requiredTargetCount: number;
  validTargets: string[];
  selectedTargets: string[];
  targetType: 'creature' | 'player' | 'any' | 'permanent' | null;
}

// ============== MANA INFO ==============

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
  newState: GameState;
  success: boolean;
  deficit: ManaDeficit | null;
  tappedNames: string[];
}

// ============== HOOK INTERFACE ==============

export interface GameEngine {
  gameState: GameState | null;
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
  getHandCards: () => CardInstance[];
  getBattlefieldCards: (playerId: string) => CardInstance[];
  getGraveyardCards: (playerId: string) => CardInstance[];
  getExileCards: (playerId: string) => CardInstance[];
  getCommandZoneCards: (playerId: string) => CardInstance[];
  getLibraryCount: (playerId: string) => number;
  getStackItems: () => StackItem[];
  getCardDef: (definitionId: string) => CardDefinition | undefined;
  getCardById: (instanceId: string) => CardInstance | undefined;
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

export interface GameConfig {
  deckId: string;
  opponentCount: number;
  difficulty: number;
  personalities: string[];
}

// ============== HELPER FUNCTIONS ==============

function emptyManaPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

function createPlayer(id: string, name: string, life: number = 40): Player {
  return {
    id, name, life,
    manaPool: emptyManaPool(),
    hasPlayedLand: false,
    hasPriority: false,
    hasLost: false,
    commanderDamage: {},
    commanderTax: 0,
    commanderInstanceId: null,
    commanderCastCount: 0,
  };
}

function getCardsInZone(state: GameState, playerId: string, zone: Zone): CardInstance[] {
  const result: CardInstance[] = [];
  state.cards.forEach(card => {
    if ((card.ownerId === playerId || card.controllerId === playerId) && card.zone === zone) {
      result.push(card);
    }
  });
  return result;
}

function parseManaString(manaString: string): { W: number; U: number; B: number; R: number; G: number; C: number; generic: number } {
  const result = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 };
  const matches = manaString.match(/\{([^}]+)\}/g) || [];
  for (const match of matches) {
    const symbol = match.slice(1, -1);
    if (/^\d+$/.test(symbol)) {
      result.generic += parseInt(symbol);
    } else if (symbol === 'W') result.W++;
    else if (symbol === 'U') result.U++;
    else if (symbol === 'B') result.B++;
    else if (symbol === 'R') result.R++;
    else if (symbol === 'G') result.G++;
    else if (symbol === 'C') result.C++;
  }
  return result;
}

function canPayMana(pool: ManaPool, cost: ReturnType<typeof parseManaString>): boolean {
  const available = { ...pool };
  for (const color of ['W', 'U', 'B', 'R', 'G', 'C'] as ManaColor[]) {
    if (available[color] < cost[color]) return false;
    available[color] -= cost[color];
  }
  const total = Object.values(available).reduce((sum, v) => sum + v, 0);
  return total >= cost.generic;
}

function payMana(pool: ManaPool, cost: ReturnType<typeof parseManaString>): ManaPool {
  const newPool = { ...pool };
  for (const color of ['W', 'U', 'B', 'R', 'G', 'C'] as ManaColor[]) {
    newPool[color] -= cost[color];
  }
  let generic = cost.generic;
  for (const color of ['C', 'W', 'U', 'B', 'R', 'G'] as ManaColor[]) {
    while (generic > 0 && newPool[color] > 0) {
      newPool[color]--;
      generic--;
    }
  }
  return newPool;
}

// ============== AUTO-TAP & MANA HELPERS ==============

function getManaColorsFromCard(state: GameState, cardId: string): ManaColor[] {
  const card = state.cards.get(cardId);
  if (!card) return [];
  const def = state.cardDefinitions.get(card.definitionId);
  if (!def) return [];
  const colors: ManaColor[] = [];
  const matches = def.oracle_text.matchAll(/\{T\}:.*?Add \{([WUBRGC])\}/g);
  for (const m of matches) {
    const color = m[1] as ManaColor;
    if (!colors.includes(color)) colors.push(color);
  }
  // Also check basic land pattern "(T: Add {X}.)"
  const basicMatch = def.oracle_text.matchAll(/\(?\{?T\}?:.*?Add \{([WUBRGC])\}/g);
  for (const m of basicMatch) {
    const color = m[1] as ManaColor;
    if (!colors.includes(color)) colors.push(color);
  }
  return colors;
}

function canCastTiming(state: GameState, playerId: string, cardId: string): { ok: boolean; reason: string } {
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

function getEffectiveManaCost(state: GameState, playerId: string, cardId: string): ReturnType<typeof parseManaString> {
  const card = state.cards.get(cardId);
  if (!card) return parseManaString('');
  const def = state.cardDefinitions.get(card.definitionId);
  if (!def) return parseManaString('');
  const cost = parseManaString(def.mana_cost);
  // Commander tax: +2 generic per previous cast from command zone
  if (card.zone === 'command' && card.isCommander) {
    const player = state.players.find(p => p.id === playerId);
    if (player) {
      cost.generic += player.commanderCastCount * 2;
    }
  }
  return cost;
}

function autoTapForCost(state: GameState, playerId: string, cardId: string): AutoTapResult {
  const cost = getEffectiveManaCost(state, playerId, cardId);
  const remaining = { ...cost };
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { newState: state, success: false, deficit: { generic: cost.generic }, tappedNames: [] };

  // Subtract mana already in pool
  for (const color of ['W', 'U', 'B', 'R', 'G', 'C'] as ManaColor[]) {
    const fromPool = Math.min(player.manaPool[color], remaining[color]);
    remaining[color] -= fromPool;
  }
  // Pool generic: leftover pool mana pays generic
  let poolGenericAvailable = 0;
  for (const color of ['W', 'U', 'B', 'R', 'G', 'C'] as ManaColor[]) {
    const leftover = player.manaPool[color] - cost[color];
    if (leftover > 0) poolGenericAvailable += leftover;
  }
  remaining.generic = Math.max(0, remaining.generic - poolGenericAvailable);

  // Check if pool already covers everything
  const totalRemaining = remaining.W + remaining.U + remaining.B + remaining.R + remaining.G + remaining.C + remaining.generic;
  if (totalRemaining === 0) {
    return { newState: state, success: true, deficit: null, tappedNames: [] };
  }

  // Gather untapped mana sources
  const sources: { instanceId: string; name: string; colors: ManaColor[] }[] = [];
  state.cards.forEach((card) => {
    if (card.zone === 'battlefield' && card.controllerId === playerId && !card.tapped) {
      const colors = getManaColorsFromCard(state, card.instanceId);
      if (colors.length > 0) {
        const def = state.cardDefinitions.get(card.definitionId);
        sources.push({ instanceId: card.instanceId, name: def?.name || 'Unknown', colors });
      }
    }
  });

  // Sort: single-color sources first (use them for colored reqs), multi-color last (save flexibility)
  sources.sort((a, b) => a.colors.length - b.colors.length);

  const toTap: { instanceId: string; name: string; color: ManaColor }[] = [];

  // Pass 1: satisfy colored requirements using the most constrained sources first
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

  // Pass 2: satisfy generic from remaining sources
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
    return { newState: state, success: false, deficit, tappedNames: [] };
  }

  // Apply taps
  let newState = state;
  for (const tap of toTap) {
    newState = tapLandForMana(newState, playerId, tap.instanceId, tap.color);
  }
  return { newState, success: true, deficit: null, tappedNames: toTap.map(t => t.name) };
}

function canCastWithAutoTapCheck(state: GameState, playerId: string, cardId: string): boolean {
  const timing = canCastTiming(state, playerId, cardId);
  if (!timing.ok) return false;
  // Check if pool already covers cost
  const cost = getEffectiveManaCost(state, playerId, cardId);
  const player = state.players.find(p => p.id === playerId);
  if (!player) return false;
  if (canPayMana(player.manaPool, cost)) return true;
  // Check if auto-tap could cover it
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

// ============== GAME ACTIONS ==============

function canPlayLand(state: GameState, playerId: string, cardId: string): boolean {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1 || state.activePlayerIndex !== playerIndex) return false;
  if (state.players[playerIndex].hasPlayedLand) return false;
  if (state.phase !== 'precombat_main' && state.phase !== 'postcombat_main') return false;
  if (state.stack.length > 0) return false;
  const card = state.cards.get(cardId);
  if (!card || card.zone !== 'hand' || card.ownerId !== playerId) return false;
  const def = state.cardDefinitions.get(card.definitionId);
  return def?.card_types.includes('land') ?? false;
}

function playLand(state: GameState, playerId: string, cardId: string): GameState {
  const newCards = new Map(state.cards);
  const card = newCards.get(cardId)!;
  newCards.set(cardId, { ...card, zone: 'battlefield', tapped: false, summoningSick: false });
  const newPlayers = state.players.map(p =>
    p.id === playerId ? { ...p, hasPlayedLand: true } : p
  );
  return { ...state, cards: newCards, players: newPlayers };
}

function tapLandForMana(state: GameState, playerId: string, cardId: string, color: ManaColor): GameState {
  const newCards = new Map(state.cards);
  const card = newCards.get(cardId)!;
  newCards.set(cardId, { ...card, tapped: true });
  const newPlayers = state.players.map(p => {
    if (p.id === playerId) {
      const newManaPool = { ...p.manaPool };
      newManaPool[color]++;
      return { ...p, manaPool: newManaPool };
    }
    return p;
  });
  return { ...state, cards: newCards, players: newPlayers };
}

function canCastSpell(state: GameState, playerId: string, cardId: string): boolean {
  const card = state.cards.get(cardId);
  if (!card) return false;
  const validZone = card.zone === 'hand' || (card.zone === 'command' && card.isCommander);
  if (!validZone) return false;
  const def = state.cardDefinitions.get(card.definitionId);
  if (!def || def.card_types.includes('land')) return false;
  const isInstant = def.card_types.includes('instant');
  const hasFlash = def.keywords.includes('Flash');
  if (!isInstant && !hasFlash) {
    const playerIndex = state.players.findIndex(p => p.id === playerId);
    if (state.activePlayerIndex !== playerIndex) return false;
    if (state.phase !== 'precombat_main' && state.phase !== 'postcombat_main') return false;
    if (state.stack.length > 0) return false;
  }
  const player = state.players.find(p => p.id === playerId);
  if (!player) return false;
  const cost = parseManaString(def.mana_cost);
  return canPayMana(player.manaPool, cost);
}

function castSpell(state: GameState, playerId: string, cardId: string, targets: string[] = []): GameState {
  const card = state.cards.get(cardId)!;
  const cost = getEffectiveManaCost(state, playerId, cardId);
  const newCards = new Map(state.cards);
  newCards.set(cardId, { ...card, zone: 'stack' });
  const newPlayers = state.players.map(p => {
    if (p.id === playerId) {
      const updatedPlayer = { ...p, manaPool: payMana(p.manaPool, cost) };
      // Track commander cast count
      if (card.zone === 'command' && card.isCommander) {
        updatedPlayer.commanderCastCount = p.commanderCastCount + 1;
      }
      return updatedPlayer;
    }
    return p;
  });
  const stackItem: StackItem = {
    id: `stack_${Date.now()}`,
    cardInstanceId: cardId,
    casterId: playerId,
    targets,
  };
  return { ...state, cards: newCards, players: newPlayers, stack: [...state.stack, stackItem] };
}

function resolveTopOfStack(state: GameState): GameState {
  if (state.stack.length === 0) return state;
  const newStack = [...state.stack];
  const item = newStack.pop()!;
  const newCards = new Map(state.cards);
  const card = newCards.get(item.cardInstanceId);
  if (!card) return { ...state, stack: newStack };
  const def = state.cardDefinitions.get(card.definitionId);
  if (!def) return { ...state, stack: newStack };
  let newState: GameState = { ...state, stack: newStack };

  const isPermanent = def.card_types.some(t => ['creature', 'artifact', 'enchantment', 'planeswalker'].includes(t));
  if (isPermanent) {
    const isCreature = def.card_types.includes('creature');
    newCards.set(item.cardInstanceId, { ...card, zone: 'battlefield', summoningSick: isCreature, tapped: false });
    newState = { ...newState, cards: newCards };
  } else {
    newState = applySpellEffect(newState, card, def, item.targets, item.casterId);
    const updatedCards = new Map(newState.cards);
    updatedCards.set(item.cardInstanceId, { ...card, zone: 'graveyard' });
    newState = { ...newState, cards: updatedCards };
  }
  return checkStateBasedActions(newState);
}

function applySpellEffect(state: GameState, _card: CardInstance, def: CardDefinition, targets: string[], casterId: string): GameState {
  let newState = state;
  const text = def.oracle_text.toLowerCase();

  // Draw cards
  const drawMatch = text.match(/draw (\d+|a|two|three) cards?/);
  if (drawMatch) {
    const num = drawMatch[1] === 'a' ? 1 : drawMatch[1] === 'two' ? 2 : drawMatch[1] === 'three' ? 3 : parseInt(drawMatch[1]);
    newState = drawCards(newState, casterId, num);
  }

  // Gain life
  const lifeMatch = text.match(/gain (\d+) life/);
  if (lifeMatch) {
    const amount = parseInt(lifeMatch[1]);
    newState = modifyLife(newState, casterId, amount);
  }

  // Deal damage
  const damageMatch = text.match(/deals? (\d+) damage/);
  if (damageMatch && targets.length > 0) {
    const damage = parseInt(damageMatch[1]);
    newState = dealDamage(newState, targets[0], damage);
  }

  // Destroy
  if (text.includes('destroy target') && targets.length > 0) {
    newState = destroyPermanent(newState, targets[0]);
  }

  return newState;
}

function drawCards(state: GameState, playerId: string, count: number): GameState {
  const library = getCardsInZone(state, playerId, 'library');
  const newCards = new Map(state.cards);
  for (let i = 0; i < Math.min(count, library.length); i++) {
    const card = library[i];
    newCards.set(card.instanceId, { ...card, zone: 'hand' });
  }
  return { ...state, cards: newCards };
}

function modifyLife(state: GameState, playerId: string, amount: number): GameState {
  const newPlayers = state.players.map(p =>
    p.id === playerId ? { ...p, life: p.life + amount } : p
  );
  return { ...state, players: newPlayers };
}

function dealDamage(state: GameState, targetId: string, damage: number): GameState {
  const player = state.players.find(p => p.id === targetId);
  if (player) {
    return modifyLife(state, targetId, -damage);
  }
  const newCards = new Map(state.cards);
  const creature = newCards.get(targetId);
  if (creature) {
    newCards.set(targetId, { ...creature, damage: creature.damage + damage });
    return { ...state, cards: newCards };
  }
  return state;
}

function destroyPermanent(state: GameState, cardId: string): GameState {
  const newCards = new Map(state.cards);
  const card = newCards.get(cardId);
  if (card && card.zone === 'battlefield') {
    newCards.set(cardId, { ...card, zone: 'graveyard', damage: 0, tapped: false, isAttacking: false, isBlocking: null, blockedBy: [] });
  }
  return { ...state, cards: newCards };
}

// ============== COMBAT ==============

function canDeclareAttacker(state: GameState, playerId: string, cardId: string): boolean {
  if (state.step !== 'declare_attackers') return false;
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (state.activePlayerIndex !== playerIndex) return false;
  const card = state.cards.get(cardId);
  if (!card || card.zone !== 'battlefield' || card.controllerId !== playerId) return false;
  if (card.tapped || card.summoningSick) return false;
  const def = state.cardDefinitions.get(card.definitionId);
  return def?.card_types.includes('creature') ?? false;
}

function declareAttackers(state: GameState, _playerId: string, attacks: AttackerDeclaration[]): GameState {
  const newCards = new Map(state.cards);
  for (const attack of attacks) {
    const card = newCards.get(attack.cardInstanceId)!;
    const def = state.cardDefinitions.get(card.definitionId);
    const hasVigilance = def?.keywords.includes('Vigilance');
    newCards.set(attack.cardInstanceId, { ...card, tapped: !hasVigilance, isAttacking: true });
  }
  const combat: CombatState = { attackers: attacks, blockers: [], damageAssignment: new Map() };
  return { ...state, cards: newCards, combat };
}

function canDeclareBlocker(state: GameState, playerId: string, blockerId: string, attackerId: string): boolean {
  if (state.step !== 'declare_blockers' || !state.combat) return false;
  const blocker = state.cards.get(blockerId);
  if (!blocker || blocker.zone !== 'battlefield' || blocker.controllerId !== playerId || blocker.tapped) return false;
  const def = state.cardDefinitions.get(blocker.definitionId);
  if (!def?.card_types.includes('creature')) return false;
  const attacker = state.combat.attackers.find(a => a.cardInstanceId === attackerId);
  if (!attacker || attacker.defendingPlayerId !== playerId) return false;
  const attackerCard = state.cards.get(attackerId);
  const attackerDef = attackerCard ? state.cardDefinitions.get(attackerCard.definitionId) : null;
  if (attackerDef?.keywords.includes('Flying')) {
    if (!def.keywords.includes('Flying') && !def.keywords.includes('Reach')) return false;
  }
  return true;
}

function declareBlockers(state: GameState, _playerId: string, blocks: BlockerDeclaration[]): GameState {
  if (!state.combat) return state;
  const newCards = new Map(state.cards);
  for (const block of blocks) {
    const blocker = newCards.get(block.cardInstanceId)!;
    const attacker = newCards.get(block.blockingAttackerId)!;
    newCards.set(block.cardInstanceId, { ...blocker, isBlocking: block.blockingAttackerId });
    newCards.set(block.blockingAttackerId, { ...attacker, blockedBy: [...attacker.blockedBy, block.cardInstanceId] });
  }
  const combat: CombatState = { ...state.combat, blockers: [...state.combat.blockers, ...blocks] };
  return { ...state, cards: newCards, combat };
}

function resolveCombatDamage(state: GameState): GameState {
  if (!state.combat) return state;
  const newCards = new Map(state.cards);
  let newPlayers = state.players.map(p => ({ ...p }));

  for (const attacker of state.combat.attackers) {
    const attackerCard = newCards.get(attacker.cardInstanceId);
    if (!attackerCard) continue;
    const attackerDef = state.cardDefinitions.get(attackerCard.definitionId);
    const power = (attackerDef?.power ?? 0) + (attackerCard.counters['+1/+1'] ?? 0);

    if (attackerCard.blockedBy.length === 0) {
      // Unblocked - damage to player
      const defenderIndex = newPlayers.findIndex(p => p.id === attacker.defendingPlayerId);
      if (defenderIndex !== -1) {
        newPlayers[defenderIndex].life -= power;
        // Track commander damage
        if (attackerCard.isCommander) {
          newPlayers[defenderIndex].commanderDamage[attacker.cardInstanceId] =
            (newPlayers[defenderIndex].commanderDamage[attacker.cardInstanceId] ?? 0) + power;
        }
      }
    } else {
      // Blocked - damage to blocker, blocker damages back
      const blockerId = attackerCard.blockedBy[0];
      const blockerCard = newCards.get(blockerId);
      if (blockerCard) {
        const blockerDef = state.cardDefinitions.get(blockerCard.definitionId);
        const blockerPower = (blockerDef?.power ?? 0) + (blockerCard.counters['+1/+1'] ?? 0);
        // Attacker damages blocker
        newCards.set(blockerId, { ...blockerCard, damage: blockerCard.damage + power });
        // Blocker damages attacker
        newCards.set(attacker.cardInstanceId, { ...attackerCard, damage: attackerCard.damage + blockerPower });
      }
    }
  }

  // Reset combat status
  newCards.forEach((card, id) => {
    if (card.isAttacking || card.isBlocking) {
      newCards.set(id, { ...card, isAttacking: false, isBlocking: null, blockedBy: [] });
    }
  });

  return { ...state, cards: newCards, players: newPlayers, combat: null };
}

// ============== STATE-BASED ACTIONS ==============

function checkStateBasedActions(state: GameState): GameState {
  let newState = state;
  let changed = true;
  while (changed) {
    changed = false;
    // Check players at 0 life
    const newPlayers = newState.players.map(p => {
      if (p.life <= 0 && !p.hasLost) {
        changed = true;
        return { ...p, hasLost: true };
      }
      // Check 21+ commander damage
      for (const [_, dmg] of Object.entries(p.commanderDamage)) {
        if (dmg >= 21 && !p.hasLost) {
          changed = true;
          return { ...p, hasLost: true };
        }
      }
      return p;
    });
    // Check creatures with lethal damage
    const newCards = new Map(newState.cards);
    newCards.forEach((card, id) => {
      if (card.zone === 'battlefield') {
        const def = newState.cardDefinitions.get(card.definitionId);
        if (def?.card_types.includes('creature') && def.toughness !== undefined) {
          const toughness = def.toughness + (card.counters['+1/+1'] ?? 0);
          if (card.damage >= toughness) {
            newCards.set(id, { ...card, zone: 'graveyard', damage: 0, tapped: false, isAttacking: false, isBlocking: null, blockedBy: [] });
            changed = true;
          }
        }
      }
    });
    newState = { ...newState, players: newPlayers, cards: newCards };
  }
  // Check game over
  const alive = newState.players.filter(p => !p.hasLost);
  if (alive.length === 1) {
    newState = { ...newState, gameOver: true, winnerId: alive[0].id };
  } else if (alive.length === 0) {
    newState = { ...newState, gameOver: true, winnerId: null };
  }
  return newState;
}

// ============== TURN MANAGEMENT ==============

const STEP_ORDER: Step[] = ['untap', 'upkeep', 'draw', 'begin_combat', 'declare_attackers', 'declare_blockers', 'first_strike_damage', 'combat_damage', 'end_of_combat', 'end', 'cleanup'];

function getPhaseForStep(step: Step): Phase {
  if (['untap', 'upkeep', 'draw'].includes(step)) return 'beginning';
  if (['begin_combat', 'declare_attackers', 'declare_blockers', 'first_strike_damage', 'combat_damage', 'end_of_combat'].includes(step)) return 'combat';
  if (['end', 'cleanup'].includes(step)) return 'ending';
  return 'precombat_main';
}

function advanceStep(state: GameState): GameState {
  const currentIndex = STEP_ORDER.indexOf(state.step);
  if (currentIndex === STEP_ORDER.length - 1) {
    return advanceToNextTurn(state);
  }
  // Handle main phases
  if (state.step === 'draw') {
    return { ...state, phase: 'precombat_main', step: 'begin_combat' };
  }
  if (state.step === 'end_of_combat') {
    return { ...state, phase: 'postcombat_main', step: 'end' };
  }
  const nextStep = STEP_ORDER[currentIndex + 1];
  return { ...state, step: nextStep, phase: getPhaseForStep(nextStep) };
}

function advanceToNextTurn(state: GameState): GameState {
  const nextIndex = (state.activePlayerIndex + 1) % state.players.length;
  const newPlayers = state.players.map((p, i) => ({
    ...p,
    hasPlayedLand: false,
    hasPriority: i === nextIndex,
    manaPool: emptyManaPool(),
  }));
  const newCards = new Map(state.cards);
  const nextPlayerId = state.players[nextIndex].id;
  newCards.forEach((card, id) => {
    if (card.controllerId === nextPlayerId && card.zone === 'battlefield') {
      newCards.set(id, { ...card, tapped: false, summoningSick: false, damage: 0 });
    }
  });
  return {
    ...state,
    cards: newCards,
    players: newPlayers,
    activePlayerIndex: nextIndex,
    priorityPlayerIndex: nextIndex,
    phase: 'beginning',
    step: 'untap',
    turnNumber: state.turnNumber + 1,
    combat: null,
  };
}

// ============== SAMPLE CARDS (fallback for test-deck) ==============

function createSampleCardDefinitions(): Map<string, CardDefinition> {
  const defs = new Map<string, CardDefinition>();
  const lands = [
    { id: 'plains', name: 'Plains', type: 'Basic Land — Plains', color: 'W' },
    { id: 'island', name: 'Island', type: 'Basic Land — Island', color: 'U' },
    { id: 'swamp', name: 'Swamp', type: 'Basic Land — Swamp', color: 'B' },
    { id: 'mountain', name: 'Mountain', type: 'Basic Land — Mountain', color: 'R' },
    { id: 'forest', name: 'Forest', type: 'Basic Land — Forest', color: 'G' },
  ];
  lands.forEach(land => {
    for (let i = 0; i < 10; i++) {
      defs.set(`${land.id}_${i}`, {
        id: `${land.id}_${i}`, name: land.name, type_line: land.type,
        oracle_text: `({T}: Add {${land.color}}.)`, mana_cost: '', cmc: 0,
        colors: [], color_identity: [land.color], keywords: [], card_types: ['land'],
      });
    }
  });
  const creatures = [
    { id: 'llanowar_elves', name: 'Llanowar Elves', cost: '{G}', cmc: 1, power: 1, toughness: 1, text: '{T}: Add {G}.', type: 'Creature — Elf Druid', colors: ['G'] },
    { id: 'grizzly_bears', name: 'Grizzly Bears', cost: '{1}{G}', cmc: 2, power: 2, toughness: 2, text: '', type: 'Creature — Bear', colors: ['G'] },
    { id: 'centaur_courser', name: 'Centaur Courser', cost: '{2}{G}', cmc: 3, power: 3, toughness: 3, text: '', type: 'Creature — Centaur Warrior', colors: ['G'] },
    { id: 'rumbling_baloth', name: 'Rumbling Baloth', cost: '{2}{G}{G}', cmc: 4, power: 4, toughness: 4, text: '', type: 'Creature — Beast', colors: ['G'] },
    { id: 'serra_angel', name: 'Serra Angel', cost: '{3}{W}{W}', cmc: 5, power: 4, toughness: 4, text: 'Flying, vigilance', type: 'Creature — Angel', colors: ['W'], keywords: ['Flying', 'Vigilance'] },
    { id: 'air_elemental', name: 'Air Elemental', cost: '{3}{U}{U}', cmc: 5, power: 4, toughness: 4, text: 'Flying', type: 'Creature — Elemental', colors: ['U'], keywords: ['Flying'] },
    { id: 'goblin_guide', name: 'Goblin Guide', cost: '{R}', cmc: 1, power: 2, toughness: 2, text: 'Haste', type: 'Creature — Goblin Scout', colors: ['R'], keywords: ['Haste'] },
    { id: 'walking_corpse', name: 'Walking Corpse', cost: '{1}{B}', cmc: 2, power: 2, toughness: 2, text: '', type: 'Creature — Zombie', colors: ['B'] },
    { id: 'goreclaw', name: 'Goreclaw, Terror of Qal Sisma', cost: '{3}{G}', cmc: 4, power: 4, toughness: 3, text: 'Creature spells you cast with power 4 or greater cost {2} less to cast.', type: 'Legendary Creature — Bear', colors: ['G'] },
    { id: 'talrand', name: 'Talrand, Sky Summoner', cost: '{2}{U}{U}', cmc: 4, power: 2, toughness: 2, text: 'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.', type: 'Legendary Creature — Merfolk Wizard', colors: ['U'] },
  ];
  creatures.forEach(c => {
    defs.set(c.id, {
      id: c.id, name: c.name, type_line: c.type, oracle_text: c.text, mana_cost: c.cost, cmc: c.cmc,
      colors: c.colors, color_identity: c.colors, keywords: (c as {keywords?: string[]}).keywords || [], card_types: ['creature'], power: c.power, toughness: c.toughness,
    });
  });
  const spells = [
    { id: 'giant_growth', name: 'Giant Growth', cost: '{G}', cmc: 1, text: 'Target creature gets +3/+3 until end of turn.', type: 'Instant', colors: ['G'] },
    { id: 'lightning_bolt', name: 'Lightning Bolt', cost: '{R}', cmc: 1, text: 'Lightning Bolt deals 3 damage to any target.', type: 'Instant', colors: ['R'] },
    { id: 'doom_blade', name: 'Doom Blade', cost: '{1}{B}', cmc: 2, text: 'Destroy target nonblack creature.', type: 'Instant', colors: ['B'] },
    { id: 'divination', name: 'Divination', cost: '{2}{U}', cmc: 3, text: 'Draw two cards.', type: 'Sorcery', colors: ['U'] },
    { id: 'murder', name: 'Murder', cost: '{1}{B}{B}', cmc: 3, text: 'Destroy target creature.', type: 'Instant', colors: ['B'] },
  ];
  spells.forEach(s => {
    defs.set(s.id, {
      id: s.id, name: s.name, type_line: s.type, oracle_text: s.text, mana_cost: s.cost, cmc: s.cmc,
      colors: s.colors, color_identity: s.colors, keywords: [], card_types: [s.type.toLowerCase() as CardType],
    });
  });
  return defs;
}

let instanceCounter = 0;
function nextInstanceId(prefix: string): string {
  return `${prefix}_${++instanceCounter}_${Date.now().toString(36)}`;
}

function createTestGameState(_config: GameConfig): GameState {
  instanceCounter = 0;
  const cardDefs = createSampleCardDefinitions();
  const cards = new Map<string, CardInstance>();

  const humanDeckCards = [
    { defId: 'goreclaw', zone: 'command' as Zone, isCommander: true },
    { defId: 'forest_0', zone: 'hand' as Zone }, { defId: 'forest_1', zone: 'hand' as Zone }, { defId: 'mountain_0', zone: 'hand' as Zone },
    { defId: 'llanowar_elves', zone: 'hand' as Zone }, { defId: 'grizzly_bears', zone: 'hand' as Zone }, { defId: 'centaur_courser', zone: 'hand' as Zone },
    { defId: 'giant_growth', zone: 'hand' as Zone },
    { defId: 'forest_2', zone: 'library' as Zone }, { defId: 'forest_3', zone: 'library' as Zone }, { defId: 'forest_4', zone: 'library' as Zone },
    { defId: 'mountain_1', zone: 'library' as Zone }, { defId: 'mountain_2', zone: 'library' as Zone },
    { defId: 'rumbling_baloth', zone: 'library' as Zone }, { defId: 'goblin_guide', zone: 'library' as Zone }, { defId: 'lightning_bolt', zone: 'library' as Zone },
  ];
  let humanCommanderInstanceId: string | null = null;
  humanDeckCards.forEach((c) => {
    const id = nextInstanceId('human');
    cards.set(id, {
      instanceId: id, definitionId: c.defId, ownerId: 'human', controllerId: 'human', zone: c.zone,
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: c.isCommander || false,
      isAttacking: false, isBlocking: null, blockedBy: [],
    });
    if (c.isCommander) humanCommanderInstanceId = id;
  });

  const aiDeckCards = [
    { defId: 'talrand', zone: 'command' as Zone, isCommander: true },
    { defId: 'island_0', zone: 'hand' as Zone }, { defId: 'island_1', zone: 'hand' as Zone }, { defId: 'swamp_0', zone: 'hand' as Zone },
    { defId: 'walking_corpse', zone: 'hand' as Zone }, { defId: 'air_elemental', zone: 'hand' as Zone },
    { defId: 'doom_blade', zone: 'hand' as Zone }, { defId: 'divination', zone: 'hand' as Zone },
    { defId: 'island_2', zone: 'library' as Zone }, { defId: 'island_3', zone: 'library' as Zone },
    { defId: 'swamp_1', zone: 'library' as Zone }, { defId: 'swamp_2', zone: 'library' as Zone }, { defId: 'murder', zone: 'library' as Zone },
  ];
  let aiCommanderInstanceId: string | null = null;
  aiDeckCards.forEach((c) => {
    const id = nextInstanceId('ai1');
    cards.set(id, {
      instanceId: id, definitionId: c.defId, ownerId: 'ai1', controllerId: 'ai1', zone: c.zone,
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: c.isCommander || false,
      isAttacking: false, isBlocking: null, blockedBy: [],
    });
    if (c.isCommander) aiCommanderInstanceId = id;
  });

  const humanPlayer: Player = { ...createPlayer('human', 'You', 40), commanderInstanceId: humanCommanderInstanceId, hasPriority: true };
  const aiPlayer: Player = { ...createPlayer('ai1', 'AI Opponent', 40), commanderInstanceId: aiCommanderInstanceId };

  return {
    players: [humanPlayer, aiPlayer], cards, cardDefinitions: cardDefs,
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'upkeep',
    turnNumber: 1, hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [], gameOver: false, winnerId: null,
  };
}

// ============== DECK FETCHING ==============

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
}

interface ApiDeck {
  id: string;
  commander: string;
  colors: string[];
  list: string[];
}

function parseCardTypes(typeLine: string): CardType[] {
  const types: CardType[] = [];
  const lower = typeLine.toLowerCase();
  if (lower.includes('creature')) types.push('creature');
  if (lower.includes('instant')) types.push('instant');
  if (lower.includes('sorcery')) types.push('sorcery');
  if (lower.includes('artifact')) types.push('artifact');
  if (lower.includes('enchantment')) types.push('enchantment');
  if (lower.includes('land')) types.push('land');
  if (lower.includes('planeswalker')) types.push('planeswalker');
  return types;
}

function inferLandManaAbility(name: string, oracleText: string): string {
  // Basic lands may have empty oracle text in some data sources
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

function apiCardToDefinition(card: ApiCardData, defId: string): CardDefinition {
  const cardTypes = parseCardTypes(card.type_line);
  const oracleText = cardTypes.includes('land')
    ? inferLandManaAbility(card.name, card.oracle_text)
    : card.oracle_text;
  return {
    id: defId,
    name: card.name,
    type_line: card.type_line,
    oracle_text: oracleText,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    colors: card.colors,
    color_identity: card.color_identity,
    keywords: card.keywords,
    card_types: cardTypes,
    power: card.power != null ? parseInt(card.power) || 0 : undefined,
    toughness: card.toughness != null ? parseInt(card.toughness) || 0 : undefined,
  };
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function parseDeckListEntry(entry: string): { name: string; quantity: number } {
  // Deck list entries are formatted as "Nx CardName" with optional " *CMDR*" suffix
  // e.g. "1x Sol Ring", "3x Forest", "1x Goreclaw, Terror of Qal Sisma *CMDR*"
  let cleaned = entry.replace(/\s*\*CMDR\*\s*$/, '');
  const match = cleaned.match(/^(\d+)x\s+(.+)$/);
  if (match) {
    return { name: match[2], quantity: parseInt(match[1]) };
  }
  return { name: cleaned, quantity: 1 };
}

async function fetchDeckGameState(config: GameConfig): Promise<GameState> {
  instanceCounter = 0;

  // Fetch deck data and card data in sequence (need deck list for card batch)
  const deckRes = await fetch(`/api/deck/${config.deckId}`);
  if (!deckRes.ok) throw new Error('Failed to load deck');
  const deck: ApiDeck = await deckRes.json();

  // Parse deck list entries: strip "Nx " prefix and " *CMDR*" suffix, expand quantities
  const parsedEntries = deck.list
    .map(parseDeckListEntry)
    .filter(e => e.name !== deck.commander); // Commander handled separately
  const expandedCardNames: string[] = [];
  for (const entry of parsedEntries) {
    for (let i = 0; i < entry.quantity; i++) {
      expandedCardNames.push(entry.name);
    }
  }

  // Deck list includes all 99 cards (commander is separate in deck.commander)
  const allCardNames = [deck.commander, ...expandedCardNames];
  const uniqueNames = [...new Set(allCardNames)];

  const cardsRes = await fetch('/api/cards-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names: uniqueNames }),
  });
  if (!cardsRes.ok) throw new Error('Failed to load card data');
  const cardDataList: ApiCardData[] = await cardsRes.json();
  const cardDataByName = new Map(cardDataList.map(c => [c.name, c]));

  // Build card definitions and instances
  const cardDefs = new Map<string, CardDefinition>();
  const cards = new Map<string, CardInstance>();

  // Track duplicate card names with unique def IDs
  const nameCounters = new Map<string, number>();
  function getDefId(name: string): string {
    const count = nameCounters.get(name) || 0;
    nameCounters.set(name, count + 1);
    const sanitized = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    return count === 0 ? sanitized : `${sanitized}_${count}`;
  }

  // Commander goes to command zone
  const commanderData = cardDataByName.get(deck.commander);
  let humanCommanderInstanceId: string | null = null;
  if (commanderData) {
    const defId = getDefId(deck.commander);
    cardDefs.set(defId, apiCardToDefinition(commanderData, defId));
    const instId = nextInstanceId('human');
    cards.set(instId, {
      instanceId: instId, definitionId: defId, ownerId: 'human', controllerId: 'human',
      zone: 'command', tapped: false, summoningSick: false, counters: {}, damage: 0,
      isCommander: true, isAttacking: false, isBlocking: null, blockedBy: [],
    });
    humanCommanderInstanceId = instId;
  }

  // Remaining 99 cards: shuffle, draw 7 for hand, rest go to library
  const deckCards = expandedCardNames.filter(name => cardDataByName.has(name));
  const shuffledDeck = shuffleArray(deckCards);
  const handCards = shuffledDeck.slice(0, 7);
  const libraryCards = shuffledDeck.slice(7);

  for (const name of handCards) {
    const data = cardDataByName.get(name)!;
    const defId = getDefId(name);
    cardDefs.set(defId, apiCardToDefinition(data, defId));
    const instId = nextInstanceId('human');
    cards.set(instId, {
      instanceId: instId, definitionId: defId, ownerId: 'human', controllerId: 'human',
      zone: 'hand', tapped: false, summoningSick: false, counters: {}, damage: 0,
      isCommander: false, isAttacking: false, isBlocking: null, blockedBy: [],
    });
  }

  for (const name of libraryCards) {
    const data = cardDataByName.get(name)!;
    const defId = getDefId(name);
    cardDefs.set(defId, apiCardToDefinition(data, defId));
    const instId = nextInstanceId('human');
    cards.set(instId, {
      instanceId: instId, definitionId: defId, ownerId: 'human', controllerId: 'human',
      zone: 'library', tapped: false, summoningSick: false, counters: {}, damage: 0,
      isCommander: false, isAttacking: false, isBlocking: null, blockedBy: [],
    });
  }

  // AI opponent gets a simple deck from the sample cards (same as test deck)
  const aiDefs = createSampleCardDefinitions();
  aiDefs.forEach((def, id) => cardDefs.set(id, def));

  const aiDeckCards = [
    { defId: 'talrand', zone: 'command' as Zone, isCommander: true },
    { defId: 'island_0', zone: 'hand' as Zone }, { defId: 'island_1', zone: 'hand' as Zone }, { defId: 'swamp_0', zone: 'hand' as Zone },
    { defId: 'walking_corpse', zone: 'hand' as Zone }, { defId: 'air_elemental', zone: 'hand' as Zone },
    { defId: 'doom_blade', zone: 'hand' as Zone }, { defId: 'divination', zone: 'hand' as Zone },
    { defId: 'island_2', zone: 'library' as Zone }, { defId: 'island_3', zone: 'library' as Zone },
    { defId: 'swamp_1', zone: 'library' as Zone }, { defId: 'swamp_2', zone: 'library' as Zone }, { defId: 'murder', zone: 'library' as Zone },
  ];
  let aiCommanderInstanceId: string | null = null;
  aiDeckCards.forEach((c) => {
    const id = nextInstanceId('ai1');
    cards.set(id, {
      instanceId: id, definitionId: c.defId, ownerId: 'ai1', controllerId: 'ai1', zone: c.zone,
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: c.isCommander || false,
      isAttacking: false, isBlocking: null, blockedBy: [],
    });
    if (c.isCommander) aiCommanderInstanceId = id;
  });

  const humanPlayer: Player = { ...createPlayer('human', 'You', 40), commanderInstanceId: humanCommanderInstanceId, hasPriority: true };
  const aiPlayer: Player = { ...createPlayer('ai1', 'AI Opponent', 40), commanderInstanceId: aiCommanderInstanceId };

  return {
    players: [humanPlayer, aiPlayer], cards, cardDefinitions: cardDefs,
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'upkeep',
    turnNumber: 1, hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [], gameOver: false, winnerId: null,
  };
}

// ============== MULLIGAN ==============

function performMulligan(state: GameState): GameState {
  const newCards = new Map(state.cards);
  // Move all human hand cards back to library
  newCards.forEach((card, id) => {
    if (card.ownerId === 'human' && card.zone === 'hand') {
      newCards.set(id, { ...card, zone: 'library' });
    }
  });
  // Gather all human library cards and shuffle
  const libraryCards: string[] = [];
  newCards.forEach((card, id) => {
    if (card.ownerId === 'human' && card.zone === 'library') {
      libraryCards.push(id);
    }
  });
  const shuffled = shuffleArray(libraryCards);
  // Deal top 7 to hand
  for (let i = 0; i < Math.min(7, shuffled.length); i++) {
    const card = newCards.get(shuffled[i])!;
    newCards.set(shuffled[i], { ...card, zone: 'hand' });
  }
  return { ...state, cards: newCards };
}

function putCardOnBottom(state: GameState, cardId: string): GameState {
  const newCards = new Map(state.cards);
  const card = newCards.get(cardId);
  if (card && card.zone === 'hand') {
    newCards.set(cardId, { ...card, zone: 'library' });
  }
  return { ...state, cards: newCards };
}

// ============== MAIN HOOK ==============

export function useGameEngine(): GameEngine {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gameLog, setGameLog] = useState<LogEntry[]>([]);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [targeting, setTargeting] = useState<TargetingState>({
    isTargeting: false, sourceCardId: null, requiredTargetCount: 0, validTargets: [], selectedTargets: [], targetType: null,
  });
  const [mulliganActive, setMulliganActive] = useState(false);
  const [mulliganCount, setMulliganCount] = useState(0);
  const [putBackCount, setPutBackCount] = useState(0);

  const aiThinkingRef = useRef(false);
  const pendingAttackers = useRef<AttackerDeclaration[]>([]);
  const pendingBlockers = useRef<BlockerDeclaration[]>([]);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    setGameLog(prev => [...prev, { timestamp: new Date(), message, type }]);
  }, []);

  const humanPlayer = gameState?.players.find(p => p.id === 'human') ?? null;
  const aiPlayers = gameState?.players.filter(p => p.id !== 'human') ?? [];

  const getHandCards = useCallback(() => gameState ? getCardsInZone(gameState, 'human', 'hand') : [], [gameState]);
  const getBattlefieldCards = useCallback((playerId: string) => gameState ? getCardsInZone(gameState, playerId, 'battlefield') : [], [gameState]);
  const getGraveyardCards = useCallback((playerId: string) => gameState ? getCardsInZone(gameState, playerId, 'graveyard') : [], [gameState]);
  const getExileCards = useCallback((playerId: string) => gameState ? getCardsInZone(gameState, playerId, 'exile') : [], [gameState]);
  const getCommandZoneCards = useCallback((playerId: string) => gameState ? getCardsInZone(gameState, playerId, 'command') : [], [gameState]);
  const getLibraryCount = useCallback((playerId: string) => gameState ? getCardsInZone(gameState, playerId, 'library').length : 0, [gameState]);
  const getStackItems = useCallback(() => gameState?.stack ?? [], [gameState]);
  const getCardDef = useCallback((definitionId: string) => gameState?.cardDefinitions.get(definitionId), [gameState]);
  const getCardById = useCallback((instanceId: string) => gameState?.cards.get(instanceId), [gameState]);

  const canAffordSpell = useCallback((cardId: string) => {
    if (!gameState) return false;
    return canCastSpell(gameState, 'human', cardId);
  }, [gameState]);

  const getManaInfo = useCallback((cardId: string): ManaInfo => {
    if (!gameState) return { canCast: false, timingOk: false, cost: '', deficit: null };
    const card = gameState.cards.get(cardId);
    const def = card ? gameState.cardDefinitions.get(card.definitionId) : null;
    if (!card || !def) return { canCast: false, timingOk: false, cost: '', deficit: null };
    const timing = canCastTiming(gameState, 'human', cardId);
    const canCast = canCastWithAutoTapCheck(gameState, 'human', cardId);
    let deficit: ManaDeficit | null = null;
    if (timing.ok && !canCast) {
      const result = autoTapForCost(gameState, 'human', cardId);
      deficit = result.deficit;
    }
    return { canCast, timingOk: timing.ok, cost: def.mana_cost, deficit };
  }, [gameState]);

  const canCastWithAutoTap = useCallback((cardId: string): boolean => {
    if (!gameState) return false;
    return canCastWithAutoTapCheck(gameState, 'human', cardId);
  }, [gameState]);

  const getManaFromLand = useCallback((cardId: string): ManaColor | null => {
    if (!gameState) return null;
    const colors = getManaColorsFromCard(gameState, cardId);
    return colors.length > 0 ? colors[0] : null;
  }, [gameState]);

  const startTargeting = useCallback((sourceCardId: string, targetType: 'creature' | 'player' | 'any' | 'permanent', count: number) => {
    if (!gameState) return;
    const validTargets: string[] = [];
    if (targetType === 'player' || targetType === 'any') {
      gameState.players.forEach(p => { if (!p.hasLost) validTargets.push(p.id); });
    }
    if (targetType === 'creature' || targetType === 'any' || targetType === 'permanent') {
      gameState.cards.forEach(card => {
        if (card.zone === 'battlefield') {
          const def = gameState.cardDefinitions.get(card.definitionId);
          if (def && (targetType === 'permanent' || def.card_types.includes('creature'))) {
            validTargets.push(card.instanceId);
          }
        }
      });
    }
    setTargeting({ isTargeting: true, sourceCardId, requiredTargetCount: count, validTargets, selectedTargets: [], targetType });
  }, [gameState]);

  const selectTarget = useCallback((targetId: string) => {
    setTargeting(prev => {
      if (!prev.isTargeting || !prev.validTargets.includes(targetId)) return prev;
      if (prev.selectedTargets.includes(targetId)) return { ...prev, selectedTargets: prev.selectedTargets.filter(t => t !== targetId) };
      if (prev.selectedTargets.length >= prev.requiredTargetCount) return prev;
      return { ...prev, selectedTargets: [...prev.selectedTargets, targetId] };
    });
  }, []);

  const cancelTargeting = useCallback(() => {
    setTargeting({ isTargeting: false, sourceCardId: null, requiredTargetCount: 0, validTargets: [], selectedTargets: [], targetType: null });
  }, []);

  const confirmTargets = useCallback(() => {
    if (!targeting.isTargeting || !targeting.sourceCardId || !gameState) return;
    if (targeting.selectedTargets.length < targeting.requiredTargetCount) return;
    try {
      const card = gameState.cards.get(targeting.sourceCardId);
      const def = card ? gameState.cardDefinitions.get(card.definitionId) : null;
      let stateForCast = gameState;
      let tappedNames: string[] = [];

      // Auto-tap if needed
      const cost = getEffectiveManaCost(gameState, 'human', targeting.sourceCardId);
      const player = gameState.players.find(p => p.id === 'human');
      if (player && !canPayMana(player.manaPool, cost)) {
        const tapResult = autoTapForCost(gameState, 'human', targeting.sourceCardId);
        if (!tapResult.success) {
          addLog(formatManaDeficit(def?.mana_cost || '', tapResult.deficit), 'info');
          cancelTargeting();
          return;
        }
        stateForCast = tapResult.newState;
        tappedNames = tapResult.tappedNames;
      }

      let newState = castSpell(stateForCast, 'human', targeting.sourceCardId, targeting.selectedTargets);
      if (tappedNames.length > 0) {
        addLog(`Auto-tapped ${tappedNames.join(', ')} — Cast ${def?.name ?? 'spell'}`, 'spell');
      } else {
        addLog(`Cast ${def?.name ?? 'spell'}`, 'spell');
      }
      while (newState.stack.length > 0) {
        newState = resolveTopOfStack(newState);
      }
      newState = checkStateBasedActions(newState);
      setGameState(newState);
      setSelectedCard(null);
    } catch (err) {
      addLog(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'info');
    }
    cancelTargeting();
  }, [targeting, gameState, addLog, cancelTargeting]);

  const selectCard = useCallback((cardId: string | null) => setSelectedCard(cardId), []);

  const playLandAction = useCallback((cardId: string) => {
    if (!gameState || !canPlayLand(gameState, 'human', cardId)) {
      addLog('Cannot play land right now.', 'info');
      return;
    }
    const card = gameState.cards.get(cardId);
    const def = card ? gameState.cardDefinitions.get(card.definitionId) : null;
    setGameState(playLand(gameState, 'human', cardId));
    setSelectedCard(null);
    addLog(`Played ${def?.name ?? 'land'}`, 'action');
  }, [gameState, addLog]);

  const tapForMana = useCallback((cardId: string) => {
    if (!gameState) return;
    const card = gameState.cards.get(cardId);
    if (!card || card.tapped) return;
    const def = gameState.cardDefinitions.get(card.definitionId);
    // Summoning sick creatures can't tap for mana (lands are unaffected)
    if (card.summoningSick && def && !def.card_types.includes('land')) {
      addLog(`${def.name} has summoning sickness and can't tap yet.`, 'info');
      return;
    }
    const manaColor = getManaFromLand(cardId);
    if (!manaColor) { addLog('Cannot tap for mana.', 'info'); return; }
    setGameState(tapLandForMana(gameState, 'human', cardId, manaColor));
    addLog(`Tapped ${def?.name ?? 'permanent'} for {${manaColor}}`, 'action');
  }, [gameState, addLog, getManaFromLand]);

  const activateAbility = useCallback((cardId: string, _abilityIndex: number) => {
    if (!gameState) return;
    const card = gameState.cards.get(cardId);
    const def = card ? gameState.cardDefinitions.get(card.definitionId) : null;
    if (!card || !def) return;
    if (def.oracle_text.includes('{T}: Add {')) {
      const match = def.oracle_text.match(/\{T\}: Add \{([WUBRGC])\}/);
      if (match && !card.tapped && card.zone === 'battlefield' && !card.summoningSick) {
        setGameState(tapLandForMana(gameState, 'human', cardId, match[1] as ManaColor));
        addLog(`${def.name} adds {${match[1]}}`, 'action');
        return;
      }
    }
    addLog('Cannot activate ability.', 'info');
  }, [gameState, addLog]);

  const castSpellAction = useCallback((cardId: string, targets: string[] = []) => {
    if (!gameState) return;
    const card = gameState.cards.get(cardId);
    const def = card ? gameState.cardDefinitions.get(card.definitionId) : null;

    // Check timing first
    const timing = canCastTiming(gameState, 'human', cardId);
    if (!timing.ok) {
      addLog(timing.reason, 'info');
      return;
    }

    // Handle targeting
    if (def && targets.length === 0 && def.oracle_text.toLowerCase().includes('target')) {
      // Check mana before entering targeting mode
      const cost = getEffectiveManaCost(gameState, 'human', cardId);
      const player = gameState.players.find(p => p.id === 'human');
      if (player && !canPayMana(player.manaPool, cost)) {
        // Try auto-tap viability check
        if (!canCastWithAutoTapCheck(gameState, 'human', cardId)) {
          const result = autoTapForCost(gameState, 'human', cardId);
          addLog(formatManaDeficit(def.mana_cost, result.deficit), 'info');
          return;
        }
      }
      let targetType: 'creature' | 'player' | 'any' | 'permanent' = 'any';
      if (def.oracle_text.toLowerCase().includes('target creature')) targetType = 'creature';
      else if (def.oracle_text.toLowerCase().includes('target player')) targetType = 'player';
      startTargeting(cardId, targetType, 1);
      addLog(`Select a target for ${def.name}`, 'info');
      return;
    }

    try {
      let stateForCast = gameState;
      const cost = getEffectiveManaCost(gameState, 'human', cardId);
      const player = gameState.players.find(p => p.id === 'human');

      // Auto-tap if pool doesn't cover cost
      let tappedNames: string[] = [];
      if (player && !canPayMana(player.manaPool, cost)) {
        const tapResult = autoTapForCost(gameState, 'human', cardId);
        if (!tapResult.success) {
          addLog(formatManaDeficit(def?.mana_cost || '', tapResult.deficit), 'info');
          return;
        }
        stateForCast = tapResult.newState;
        tappedNames = tapResult.tappedNames;
      }

      let newState = castSpell(stateForCast, 'human', cardId, targets);
      if (tappedNames.length > 0) {
        addLog(`Auto-tapped ${tappedNames.join(', ')} — Cast ${def?.name ?? 'spell'}`, 'spell');
      } else {
        addLog(`Cast ${def?.name ?? 'spell'}`, 'spell');
      }
      while (newState.stack.length > 0) {
        newState = resolveTopOfStack(newState);
      }
      newState = checkStateBasedActions(newState);
      setGameState(newState);
      setSelectedCard(null);
    } catch (err) {
      addLog(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'info');
    }
  }, [gameState, addLog, startTargeting]);

  const passPriorityAction = useCallback(() => {
    if (!gameState) return;
    addLog('You passed priority', 'action');
    let newState = advanceStep(gameState);
    if (newState.step === 'draw') {
      newState = drawCards(newState, gameState.players[gameState.activePlayerIndex].id, 1);
      addLog('Drew a card', 'action');
    }
    newState = checkStateBasedActions(newState);
    addLog(`Advanced to ${newState.step}`, 'info');
    setGameState(newState);
  }, [gameState, addLog]);

  const declareAttackerAction = useCallback((cardId: string, defendingPlayerId?: string) => {
    if (!gameState) return;
    const step = gameState.step === 'declare_attackers' ? gameState : { ...gameState, step: 'declare_attackers' as Step };
    if (!canDeclareAttacker(step, 'human', cardId)) {
      addLog('Cannot attack with this creature.', 'info');
      return;
    }
    const def = gameState.cardDefinitions.get(gameState.cards.get(cardId)?.definitionId ?? '');
    pendingAttackers.current = [...pendingAttackers.current.filter(a => a.cardInstanceId !== cardId),
      { cardInstanceId: cardId, defendingPlayerId: defendingPlayerId || aiPlayers[0]?.id || 'ai1' }];
    addLog(`${def?.name ?? 'Creature'} declared as attacker`, 'combat');
  }, [gameState, aiPlayers, addLog]);

  const confirmAttackers = useCallback(() => {
    if (!gameState) return;
    let newState = { ...gameState, step: 'declare_attackers' as Step };
    if (pendingAttackers.current.length === 0) {
      addLog('No attackers - skipping combat', 'combat');
      newState = { ...newState, step: 'end_of_combat' as Step, phase: 'postcombat_main' };
      setGameState(newState);
      return;
    }
    newState = declareAttackers(newState, 'human', pendingAttackers.current);
    addLog(`${pendingAttackers.current.length} creature(s) attacking!`, 'combat');
    pendingAttackers.current = [];
    newState = { ...newState, step: 'declare_blockers' as Step };
    setGameState(newState);
  }, [gameState, addLog]);

  const declareBlockerAction = useCallback((blockerId: string, attackerId: string) => {
    if (!gameState || !canDeclareBlocker(gameState, 'human', blockerId, attackerId)) {
      addLog('Cannot block with this creature.', 'info');
      return;
    }
    const blockerDef = gameState.cardDefinitions.get(gameState.cards.get(blockerId)?.definitionId ?? '');
    const attackerDef = gameState.cardDefinitions.get(gameState.cards.get(attackerId)?.definitionId ?? '');
    pendingBlockers.current = [...pendingBlockers.current.filter(b => b.cardInstanceId !== blockerId),
      { cardInstanceId: blockerId, blockingAttackerId: attackerId }];
    addLog(`${blockerDef?.name ?? 'Creature'} blocks ${attackerDef?.name ?? 'attacker'}`, 'combat');
  }, [gameState, addLog]);

  const confirmBlockers = useCallback(() => {
    if (!gameState || gameState.step !== 'declare_blockers') return;
    let newState = gameState;
    if (pendingBlockers.current.length > 0) {
      newState = declareBlockers(newState, 'human', pendingBlockers.current);
      pendingBlockers.current = [];
    }
    newState = { ...newState, step: 'combat_damage' as Step };
    newState = resolveCombatDamage(newState);
    addLog('Combat damage dealt!', 'damage');
    newState = checkStateBasedActions(newState);
    newState = { ...newState, step: 'end_of_combat' as Step };
    setGameState(newState);
  }, [gameState, addLog]);

  const respondToStack = useCallback(() => {
    if (!gameState || gameState.stack.length === 0) return;
    let newState = resolveTopOfStack(gameState);
    newState = checkStateBasedActions(newState);
    addLog('Stack item resolved', 'spell');
    setGameState(newState);
  }, [gameState, addLog]);

  const endTurn = useCallback(() => {
    if (!gameState || gameState.gameOver) return;
    let newState = advanceToNextTurn(gameState);
    newState = drawCards(newState, newState.players[newState.activePlayerIndex].id, 1);
    newState = { ...newState, phase: 'precombat_main' as Phase };
    newState = checkStateBasedActions(newState);
    const activePlayer = newState.players[newState.activePlayerIndex];
    addLog(`Turn ${newState.turnNumber} - ${activePlayer.name}'s turn`, 'info');

    if (activePlayer.id !== 'human' && !aiThinkingRef.current) {
      aiThinkingRef.current = true;
      addLog('AI is thinking...', 'ai');
      setTimeout(() => {
        runAITurn(newState, addLog, (finalState) => {
          setGameState(finalState);
          aiThinkingRef.current = false;
        });
      }, 1000);
    }
    setGameState(newState);
  }, [gameState, addLog]);

  const mulliganAction = useCallback(() => {
    if (!gameState) return;
    const newCount = mulliganCount + 1;
    const newState = performMulligan(gameState);
    setGameState(newState);
    setMulliganCount(newCount);
    addLog(`Mulligan #${newCount} — drew 7 new cards`, 'action');
  }, [gameState, mulliganCount, addLog]);

  const keepHandAction = useCallback(() => {
    if (!gameState) return;
    if (mulliganCount > 1) {
      const putBack = mulliganCount - 1;
      setPutBackCount(putBack);
      addLog(`Kept hand — put ${putBack} card${putBack > 1 ? 's' : ''} on bottom`, 'action');
    } else {
      setMulliganActive(false);
      addLog(mulliganCount === 1 ? 'Kept hand after free mulligan' : 'Kept opening hand', 'action');
      addLog('Game started! You have 40 life.', 'info');
      addLog(`Turn 1 - Your turn. Main Phase 1.`, 'info');
      if (gameState) {
        const commander = getCardsInZone(gameState, 'human', 'command')[0];
        if (commander) {
          const def = gameState.cardDefinitions.get(commander.definitionId);
          addLog(`Your commander is ${def?.name}`, 'info');
        }
      }
    }
  }, [gameState, mulliganCount, addLog]);

  const putBackCardAction = useCallback((cardId: string) => {
    if (!gameState) return;
    const newState = putCardOnBottom(gameState, cardId);
    setGameState(newState);
    const remaining = putBackCount - 1;
    setPutBackCount(remaining);
    const card = gameState.cards.get(cardId);
    const def = card ? gameState.cardDefinitions.get(card.definitionId) : null;
    addLog(`Put ${def?.name ?? 'card'} on bottom of library`, 'action');
    if (remaining === 0) {
      setMulliganActive(false);
      addLog('Game started! You have 40 life.', 'info');
      addLog(`Turn 1 - Your turn. Main Phase 1.`, 'info');
      const commander = getCardsInZone(newState, 'human', 'command')[0];
      if (commander) {
        const cDef = newState.cardDefinitions.get(commander.definitionId);
        addLog(`Your commander is ${cDef?.name}`, 'info');
      }
    }
  }, [gameState, putBackCount, addLog]);

  const startGame = useCallback((config: GameConfig) => {
    setIsLoading(true);
    setError(null);
    setGameLog([]);
    pendingAttackers.current = [];
    pendingBlockers.current = [];

    const initState = (state: GameState) => {
      setGameState(state);
      setMulliganActive(true);
      setMulliganCount(0);
      setPutBackCount(0);
      addLog('Opening hand dealt — mulligan or keep?', 'info');
      setIsLoading(false);
    };

    if (config.deckId === 'test-deck') {
      try {
        initState(createTestGameState(config));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start game');
        setIsLoading(false);
      }
    } else {
      fetchDeckGameState(config)
        .then(initState)
        .catch(err => {
          setError(err instanceof Error ? err.message : 'Failed to load deck');
          setIsLoading(false);
        });
    }
  }, [addLog]);

  return {
    gameState, isLoading, error, gameLog, selectedCard, humanPlayer, aiPlayers, targeting,
    mulliganActive, mulliganCount, putBackCount,
    getHandCards, getBattlefieldCards, getGraveyardCards, getExileCards, getCommandZoneCards,
    getLibraryCount, getStackItems, getCardDef, getCardById, canAffordSpell, getManaFromLand,
    getManaInfo, canCastWithAutoTap,
    selectCard, playLandAction, castSpellAction, tapForMana, activateAbility, passPriorityAction,
    startTargeting, selectTarget, cancelTargeting, confirmTargets,
    declareAttacker: declareAttackerAction, declareBlocker: declareBlockerAction, confirmAttackers, confirmBlockers,
    respondToStack, endTurn, startGame,
    mulliganAction, keepHandAction, putBackCardAction,
  };
}

// ============== AI TURN ==============

function runAITurn(state: GameState, addLog: (msg: string, type: LogEntry['type']) => void, onComplete: (finalState: GameState) => void): void {
  let currentState = state;
  const activePlayer = currentState.players[currentState.activePlayerIndex];

  // Play a land
  const aiHand = getCardsInZone(currentState, activePlayer.id, 'hand');
  const land = aiHand.find(c => currentState.cardDefinitions.get(c.definitionId)?.card_types.includes('land'));
  if (land && canPlayLand(currentState, activePlayer.id, land.instanceId)) {
    currentState = playLand(currentState, activePlayer.id, land.instanceId);
    addLog(`AI played ${currentState.cardDefinitions.get(land.definitionId)?.name}`, 'ai');
  }

  // Tap lands for mana
  const aiLands = getCardsInZone(currentState, activePlayer.id, 'battlefield').filter(c => {
    const def = currentState.cardDefinitions.get(c.definitionId);
    return def?.card_types.includes('land') && !c.tapped;
  });
  for (const l of aiLands) {
    const def = currentState.cardDefinitions.get(l.definitionId);
    const match = def?.oracle_text.match(/Add \{([WUBRGC])\}/);
    if (match) currentState = tapLandForMana(currentState, activePlayer.id, l.instanceId, match[1] as ManaColor);
  }

  // Cast a creature
  const aiCreatures = aiHand.filter(c => currentState.cardDefinitions.get(c.definitionId)?.card_types.includes('creature'));
  for (const creature of aiCreatures) {
    if (canCastSpell(currentState, activePlayer.id, creature.instanceId)) {
      currentState = castSpell(currentState, activePlayer.id, creature.instanceId);
      currentState = resolveTopOfStack(currentState);
      addLog(`AI cast ${currentState.cardDefinitions.get(creature.definitionId)?.name}`, 'ai');
      break;
    }
  }

  // Attack
  currentState = { ...currentState, step: 'declare_attackers' };
  const attackers = getCardsInZone(currentState, activePlayer.id, 'battlefield').filter(c => {
    const def = currentState.cardDefinitions.get(c.definitionId);
    return def?.card_types.includes('creature') && !c.summoningSick && !c.tapped;
  });
  const attacks = attackers.filter(c => canDeclareAttacker(currentState, activePlayer.id, c.instanceId))
    .map(c => ({ cardInstanceId: c.instanceId, defendingPlayerId: 'human' }));
  if (attacks.length > 0) {
    currentState = declareAttackers(currentState, activePlayer.id, attacks);
    attacks.forEach(a => {
      const def = currentState.cardDefinitions.get(currentState.cards.get(a.cardInstanceId)?.definitionId ?? '');
      addLog(`AI's ${def?.name} attacks!`, 'ai');
    });
    currentState = { ...currentState, step: 'combat_damage' };
    currentState = resolveCombatDamage(currentState);
    addLog('AI dealt combat damage!', 'damage');
  }

  currentState = checkStateBasedActions(currentState);
  if (currentState.gameOver) {
    addLog(currentState.winnerId === 'human' ? 'YOU WIN!' : 'You lost...', 'info');
    onComplete(currentState);
    return;
  }

  // Pass turn back
  currentState = advanceToNextTurn(currentState);
  currentState = drawCards(currentState, 'human', 1);
  currentState = { ...currentState, phase: 'precombat_main' };
  currentState = checkStateBasedActions(currentState);
  addLog(`Turn ${currentState.turnNumber} - Your turn`, 'info');
  addLog('Drew a card', 'action');
  onComplete(currentState);
}
