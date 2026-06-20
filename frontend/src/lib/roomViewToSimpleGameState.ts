/**
 * Adapter: convert a room's per-player SCOPED view (RoomScopedView, derived from
 * the engine's PlayerScopedView) into the SimpleGameState shape that the 1v1
 * <GameBoard> renders. This lets the multiplayer room reuse the polished visual
 * board instead of a text panel.
 *
 * The scoped view already carries rich per-card data (RoomScopedCard: instanceId,
 * P/T, tapped, counters, isCommander via command zone, etc.) for every player's
 * PUBLIC zones (battlefield/graveyard/command) plus the VIEWER's own hand. Other
 * players' hands are hidden — only their counts are known — which maps naturally
 * onto SimpleGameState's human (you) + ai (opponents) split.
 *
 * This is a presentation adapter only: it does not drive actions. Action handling
 * stays on the room's existing submit path; GameBoard is rendered read-only here.
 */
import type { SimpleGameState, SimpleCard, SimplePlayer } from '../hooks/useShelectorGame';

// Mirrors the RoomScopedCard/RoomScopedPlayer shapes defined in MultiplayerPage.
export interface ScopedCardLike {
  instanceId: string;
  name: string;
  typeLine: string;
  oracleText?: string;
  manaCost: string;
  cardTypes: string[];
  power?: number;
  toughness?: number;
  keywords?: string[];
  counters?: Record<string, number>;
  tapped: boolean;
  isCommander?: boolean;
}

export interface ScopedPlayerLike {
  id: string;
  name: string;
  life: number;
  manaPool?: Record<'W' | 'U' | 'B' | 'R' | 'G' | 'C', number>;
  poisonCounters?: number;
  commanderDamage?: Record<string, number>;
  playerCounters?: Record<string, number>;
  zones: {
    hand: { count: number; cards?: ScopedCardLike[] };
    library: { count: number };
    battlefield: { count: number; cards?: ScopedCardLike[] };
    graveyard: { count: number; cards?: ScopedCardLike[] };
    exile?: { count: number; cards?: ScopedCardLike[] };
    command: { count: number; cards?: ScopedCardLike[] };
  };
}

export interface ScopedViewLike {
  viewerId: string;
  turnNumber: number;
  phase: string;
  step: string;
  activePlayerId: string;
  priorityPlayerId: string;
  players: ScopedPlayerLike[];
  stack?: Array<{ id: string; kind: string; label?: string; controllerName?: string; sourceName?: string; targetNames?: string[] }>;
}

const EMPTY_MANA = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } as const;

function toSimpleCard(card: ScopedCardLike, ownerId: string, zone: SimpleCard['zone']): SimpleCard {
  return {
    instanceId: card.instanceId,
    name: card.name,
    manaCost: card.manaCost || '',
    typeLine: card.typeLine || '',
    oracleText: card.oracleText || '',
    keywords: card.keywords || [],
    power: card.power,
    toughness: card.toughness,
    tapped: Boolean(card.tapped),
    zone,
    ownerId,
    cardTypes: card.cardTypes || [],
    isCommander: Boolean(card.isCommander),
    counters: card.counters || {},
    damage: 0,
    isToken: false,
  };
}

function mapZone(cards: ScopedCardLike[] | undefined, ownerId: string, zone: SimpleCard['zone']): SimpleCard[] {
  return (cards || []).map((card) => toSimpleCard(card, ownerId, zone));
}

function toSimplePlayer(p: ScopedPlayerLike): SimplePlayer {
  return {
    id: p.id,
    name: p.name,
    life: p.life,
    poisonCounters: p.poisonCounters ?? 0,
    commanderDamage: p.commanderDamage ?? {},
    playerCounters: p.playerCounters ?? {},
    handCount: p.zones.hand.count,
    libraryCount: p.zones.library.count,
  };
}

function commanderName(p: ScopedPlayerLike): string {
  const fromZone = (p.zones.command.cards || []).find((c) => c.isCommander) || (p.zones.command.cards || [])[0];
  return fromZone?.name || '';
}

/**
 * Build a SimpleGameState (1v1 board shape) from a room scoped view, centered on
 * the viewer (their hand is visible; opponents' hands are hidden counts only).
 */
export function roomViewToSimpleGameState(view: ScopedViewLike): SimpleGameState {
  const viewer = view.players.find((p) => p.id === view.viewerId) ?? view.players[0];
  const opponents = view.players.filter((p) => p.id !== viewer.id);

  const aiPlayers = opponents.map(toSimplePlayer);
  const aiBattlefields: Record<string, SimpleCard[]> = {};
  const aiGraveyards: Record<string, SimpleCard[]> = {};
  const aiCommandZones: Record<string, SimpleCard[]> = {};
  const aiHands: Record<string, SimpleCard[]> = {};
  const aiCommanderNames: Record<string, string> = {};
  for (const opp of opponents) {
    aiBattlefields[opp.id] = mapZone(opp.zones.battlefield.cards, opp.id, 'battlefield');
    aiGraveyards[opp.id] = mapZone(opp.zones.graveyard.cards, opp.id, 'graveyard');
    aiCommandZones[opp.id] = mapZone(opp.zones.command.cards, opp.id, 'command');
    aiHands[opp.id] = []; // hidden — only counts are known (SimplePlayer.handCount)
    aiCommanderNames[opp.id] = commanderName(opp);
  }

  const firstAi = aiPlayers[0] ?? toSimplePlayer(viewer);
  const firstOppId = opponents[0]?.id;

  return {
    turnNumber: view.turnNumber,
    phase: view.phase,
    step: view.step,
    activePlayerId: view.activePlayerId,
    priorityPlayerId: view.priorityPlayerId,

    humanPlayer: toSimplePlayer(viewer),
    humanCommander: commanderName(viewer),
    humanHand: mapZone(viewer.zones.hand.cards, viewer.id, 'hand'),
    humanBattlefield: mapZone(viewer.zones.battlefield.cards, viewer.id, 'battlefield'),
    humanGraveyard: mapZone(viewer.zones.graveyard.cards, viewer.id, 'graveyard'),
    humanCommandZone: mapZone(viewer.zones.command.cards, viewer.id, 'command'),
    humanExile: [],

    stack: (view.stack || []).map((item) => ({
      id: item.id,
      kind: item.kind as SimpleGameState['stack'][number]['kind'],
      name: item.sourceName || item.label || 'Spell',
      casterId: '',
      targetNames: item.targetNames || [],
    })),

    gameOver: false,
    winnerId: null,
    manaPool: viewer.manaPool ? { ...EMPTY_MANA, ...viewer.manaPool } : { ...EMPTY_MANA },
    diceRolls: [],
    lastDiceRoll: null,

    aiPlayers,
    aiHands,
    aiBattlefields,
    aiGraveyards,
    aiCommandZones,
    aiExiles: {},
    aiCommanderNames,

    // Backward-compatible single-AI aliases (first opponent).
    aiPlayer: firstAi,
    aiCommander: firstOppId ? aiCommanderNames[firstOppId] : '',
    aiHand: [],
    aiBattlefield: firstOppId ? aiBattlefields[firstOppId] : [],
    aiGraveyard: firstOppId ? aiGraveyards[firstOppId] : [],
    aiCommandZone: firstOppId ? aiCommandZones[firstOppId] : [],
    aiExile: [],
  };
}
