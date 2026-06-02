import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  Download,
  Eye,
  FastForward,
  Lock,
  MessageSquare,
  Plus,
  RefreshCw,
  Shield,
  StickyNote,
  Swords,
  Users,
} from 'lucide-react';
import {
  ChatMessage,
  RoomDetail,
  RoomSummary,
  createRoom,
  getRoom,
  joinRoom,
  leaveRoom,
  addReplayAnnotation,
  getRoomReplay,
  listPublicReplays,
  listRooms,
  rematchRoom,
  sendGameAction,
  sendRoomChat,
  getPendingRealGameActions,
  getRealGameStartPayload,
  getRealGameSpectatorView,
  getRealGameView,
  getEnginePreflight,
  spectateRoom,
  startRoom,
  startRealGame,
  submitRealGameAction,
  publishRealGameSnapshot,
  updateRoomSettings,
  updateSeat,
  type GameAction,
  type EnginePreflightResponse,
  type GamePhase,
  type PublicZone,
  type RealGameAction,
  type RealGameViewResponse,
  type ReplayDecision,
  type ReplayEvent,
  type ReplayReport,
  type ReplaySummary,
} from '../lib/multiplayer';
import { BEGINNER_DECKS } from '../lib/beginnerDecks';
import { parseRoomDeckList } from '../lib/deckListParser';
import { typeLineHasType } from '../lib/typeLine';
import {
  applyPendingRoomAction,
  createRoomEngineState,
  createRoomScopedViews,
} from '../lib/roomEngineBridge';
import type { GameState } from 'commander-engine';

interface RoomSession {
  roomId: string;
  playerId: string;
  playerName: string;
  isHost: boolean;
}

interface SpectatorSession {
  roomId: string;
  spectatorId: string;
  spectatorName: string;
}

const SESSION_KEY = 'magicbrains_multiplayer_session_v1';
const SPECTATOR_SESSION_KEY = 'magicbrains_multiplayer_spectator_v1';
const defaultTags = ['casual', 'precon', 'upgraded', 'cedh', 'no-tutors', 'new-player'];

interface RoomScopedCard {
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
  summoningSick?: boolean;
  castTargetSpecs?: Array<{ id: string; type: string; count: number }>;
  legalTargetIds?: string[];
}

interface RoomScopedStackItem {
  id: string;
  kind: string;
  label: string;
  controllerName: string;
  sourceName: string;
  targetNames: string[];
  order: number;
  resolvesNext: boolean;
  triggerKind?: string;
  why: string;
}

interface RoomScopedPendingTriggerGroup {
  key: string;
  sourceName: string;
  controllerName: string;
  triggerKind: string;
  count: number;
  why: string;
}

interface RoomScopedCombatCard {
  id: string;
  name: string;
  controllerName: string;
  power: number;
  toughness: number;
  keywords: string[];
  damage: number;
}

interface RoomScopedCombatAssignment {
  attacker: RoomScopedCombatCard;
  defenderName: string;
  blockers: RoomScopedCombatCard[];
  unblocked: boolean;
  assignmentHint: string;
}

interface RoomScopedCombatView {
  step: string;
  assignments: RoomScopedCombatAssignment[];
}

interface RoomScopedLegalAction {
  action: string;
  enabled: boolean;
  reason: string;
}

interface RoomScopedComplexity {
  stackCount: number;
  pendingTriggerCount: number;
  battlefieldCardCount: number;
  continuousEffectCount: number;
  largeBoardMode: boolean;
}

interface RoomScopedPlayer {
  id: string;
  name: string;
  life: number;
  manaPool?: Record<'W' | 'U' | 'B' | 'R' | 'G' | 'C', number>;
  isActive: boolean;
  hasPriority: boolean;
  zones: {
    hand: { count: number; cards?: RoomScopedCard[] };
    library: { count: number };
    battlefield: { count: number; cards?: RoomScopedCard[] };
    graveyard: { count: number; cards?: RoomScopedCard[] };
    exile: { count: number; cards?: RoomScopedCard[] };
    command: { count: number; cards?: RoomScopedCard[] };
  };
}

interface RoomScopedView {
  viewerId: string;
  turnNumber: number;
  phase: string;
  step: string;
  activePlayerId: string;
  priorityPlayerId: string;
  stackSize: number;
  stack?: RoomScopedStackItem[];
  pendingTriggerGroups?: RoomScopedPendingTriggerGroup[];
  combat?: RoomScopedCombatView | null;
  legalActions?: RoomScopedLegalAction[];
  teachingNotes?: string[];
  complexity?: RoomScopedComplexity;
  players: RoomScopedPlayer[];
}

function readSession(): RoomSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session: RoomSession | null) {
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function readSpectatorSession(): SpectatorSession | null {
  try {
    const raw = localStorage.getItem(SPECTATOR_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSpectatorSession(session: SpectatorSession | null) {
  if (!session) {
    localStorage.removeItem(SPECTATOR_SESSION_KEY);
    return;
  }
  localStorage.setItem(SPECTATOR_SESSION_KEY, JSON.stringify(session));
}

function splitTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function inferDeckColors(cards: string[], fallback: string[] = []) {
  const colors = new Set(fallback);
  for (const card of cards) {
    if (card.includes('Plains')) colors.add('W');
    if (card.includes('Island')) colors.add('U');
    if (card.includes('Swamp')) colors.add('B');
    if (card.includes('Mountain')) colors.add('R');
    if (card.includes('Forest')) colors.add('G');
  }
  return Array.from(colors);
}

function asRoomScopedView(response: RealGameViewResponse | null): RoomScopedView | null {
  return response?.view ? (response.view as RoomScopedView) : null;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function privateNotesStorageKey(roomId: string, playerId: string) {
  return `magicbrains_room_private_notes_v1:${roomId}:${playerId}`;
}

function buildMatchLog(room: RoomDetail) {
  if (!room.game) return '';
  const playerLines = room.game.players.map((player) => {
    const counters = Object.entries(player.custom_counters || {})
      .filter(([, value]) => value > 0)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ') || 'none';
    const commanderDamage = Object.entries(player.commander_damage || {})
      .map(([source, damage]) => `${source}: ${damage}`)
      .join(', ') || 'none';
    return [
      `${player.name}`,
      `  Commander: ${player.commander || 'not set'}`,
      `  Life: ${player.life}`,
      `  Commander tax: ${player.commander_tax}`,
      `  Poison: ${player.poison_count}`,
      `  Zones: hand ${player.hand_count}, library ${player.library_count}, graveyard ${player.graveyard_count}, exile ${player.exile_count}, command ${player.command_zone_count}`,
      `  Counters: ${counters}`,
      `  Commander damage: ${commanderDamage}`,
      `  Board: ${player.battlefield_objects.map((object) => `${object.count > 1 ? `${object.count}x ` : ''}${object.name}`).join(', ') || 'empty'}`,
    ].join('\n');
  });
  const logLines = room.game.log.map((entry) => `[${formatTime(entry.created_at)}] ${entry.player_name}: ${entry.message}`);
  return [
    `DeckReps shared table: ${room.name}`,
    `Room: ${room.id}`,
    `Status: ${room.game.status}`,
    room.game.winner_name ? `Winner: ${room.game.winner_name}` : `Current turn: ${room.game.active_player_name}`,
    `Turn: ${room.game.turn_number}`,
    `Phase: ${room.game.phase}`,
    '',
    'Players',
    playerLines.join('\n\n'),
    '',
    'Log',
    logLines.join('\n'),
  ].join('\n');
}

function replayRatingTone(rating?: ReplayDecision['rating']) {
  switch (rating) {
    case 'excellent':
      return 'border-emerald-300/30 bg-emerald-300/10 text-emerald-50';
    case 'good':
      return 'border-sky-300/30 bg-sky-300/10 text-sky-50';
    case 'okay':
      return 'border-amber-300/30 bg-amber-300/10 text-amber-50';
    case 'bad':
    case 'blunder':
      return 'border-red-300/30 bg-red-300/10 text-red-50';
    default:
      return 'border-white/10 bg-white/5 text-stone-100';
  }
}

function gradeTone(grade?: string) {
  if (grade === 'A') return 'text-emerald-200';
  if (grade === 'B') return 'text-sky-200';
  if (grade === 'C') return 'text-amber-200';
  if (grade === 'D') return 'text-orange-200';
  return 'text-red-200';
}

function replayEventLabel(event?: ReplayEvent | null) {
  if (!event) return 'No replay event selected';
  return `T${event.turn_number} ${event.phase} - ${event.player_name}`;
}

function preferredReplayEventId(report: ReplayReport, current = '') {
  if (current && report.events.some((event) => event.id === current)) return current;
  const firstDecisionEventId = report.decisions[0]?.event_id;
  if (firstDecisionEventId && report.events.some((event) => event.id === firstDecisionEventId)) return firstDecisionEventId;
  return report.events[0]?.id || '';
}

function nextSharedPhase(phase: GamePhase) {
  const phases: GamePhase[] = ['beginning', 'main', 'combat', 'ending'];
  const index = phases.indexOf(phase);
  return phases[Math.min(index + 1, phases.length - 1)];
}

function isCreatureCard(card: RoomScopedCard) {
  return card.cardTypes.includes('creature') || typeLineHasType(card.typeLine, 'creature');
}

function cardPowerToughness(card: RoomScopedCard) {
  if (card.power == null || card.toughness == null) return '';
  return `${card.power}/${card.toughness}`;
}

function compactCardCounters(card: RoomScopedCard) {
  const counters = Object.entries(card.counters || {})
    .filter(([, value]) => value > 0)
    .slice(0, 3);
  if (counters.length === 0) return '';
  return counters.map(([key, value]) => `${key} ${value}`).join(', ');
}

function canUseVisibleManaSource(card: RoomScopedCard) {
  if (card.tapped) return false;
  if (card.cardTypes.includes('land')) return true;
  if (!/\badd\b/i.test(`${card.typeLine} ${card.oracleText || ''} ${card.name}`)) return false;
  if (card.cardTypes.includes('creature') && card.summoningSick && !(card.keywords || []).includes('Haste')) return false;
  return true;
}

function canUseVisibleAttacker(card: RoomScopedCard) {
  if (!isCreatureCard(card) || card.tapped) return false;
  if (card.summoningSick && !(card.keywords || []).includes('Haste')) return false;
  return true;
}

function requiredSpellTargetCount(card?: RoomScopedCard) {
  return (card?.castTargetSpecs || []).reduce((total, spec) => total + (spec.count || 0), 0);
}

function targetLabel(scopedView: RoomScopedView | null | undefined, targetId: string) {
  const player = scopedView?.players.find((item) => item.id === targetId);
  if (player) return player.name;

  const stackItem = scopedView?.stack?.find((item) => item.id === targetId);
  if (stackItem) return stackItem.label;

  for (const owner of scopedView?.players || []) {
    for (const zone of ['battlefield', 'graveyard', 'exile', 'command', 'hand'] as const) {
      const card = owner.zones[zone].cards?.find((item) => item.instanceId === targetId);
      if (card) return `${card.name} (${owner.name})`;
    }
  }

  return targetId;
}

function compactKeywords(keywords: string[] = [], limit = 4) {
  if (keywords.length === 0) return '';
  const visible = keywords.slice(0, limit).join(', ');
  return keywords.length > limit ? `${visible} +${keywords.length - limit}` : visible;
}

export function MultiplayerPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [session, setSession] = useState<RoomSession | null>(() => readSession());
  const [spectatorSession, setSpectatorSession] = useState<SpectatorSession | null>(() => readSpectatorSession());
  const [selectedRoomId, setSelectedRoomId] = useState(roomId || '');
  const [filterTag, setFilterTag] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [replayReport, setReplayReport] = useState<ReplayReport | null>(null);
  const [publicReplays, setPublicReplays] = useState<ReplaySummary[]>([]);
  const [replaySearch, setReplaySearch] = useState('');
  const [showReplayReview, setShowReplayReview] = useState(false);
  const [selectedReplayEventId, setSelectedReplayEventId] = useState('');
  const [replayAnnotation, setReplayAnnotation] = useState('');
  const [replayLoading, setReplayLoading] = useState(false);

  const [createName, setCreateName] = useState('Commander reps');
  const [hostName, setHostName] = useState(session?.playerName || '');
  const [tagText, setTagText] = useState('casual, precon');
  const [roomPassword, setRoomPassword] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);

  const [joinName, setJoinName] = useState(session?.playerName || '');
  const [joinPassword, setJoinPassword] = useState('');
  const [spectatorName, setSpectatorName] = useState('');
  const [spectatorPassword, setSpectatorPassword] = useState('');
  const [deckName, setDeckName] = useState('');
  const [commander, setCommander] = useState('');
  const [deckListText, setDeckListText] = useState('');
  const [seatDraftTouched, setSeatDraftTouched] = useState(false);
  const [deckColors, setDeckColors] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [chatText, setChatText] = useState('');
  const [gameNote, setGameNote] = useState('');
  const [privateNotes, setPrivateNotes] = useState<string[]>([]);
  const [trackerAmount, setTrackerAmount] = useState(1);
  const [trackerTargetPlayerId, setTrackerTargetPlayerId] = useState('');
  const [trackerCounterType, setTrackerCounterType] = useState('experience');
  const [trackerSourceZone, setTrackerSourceZone] = useState<PublicZone>('graveyard');
  const [selectedPhase, setSelectedPhase] = useState<GamePhase>('main');
  const [realManaColor, setRealManaColor] = useState<'W' | 'U' | 'B' | 'R' | 'G' | 'C'>('G');
  const [teachingEnabled, setTeachingEnabled] = useState(true);
  const [selectedAttackCardId, setSelectedAttackCardId] = useState('');
  const [selectedDefenderPlayerId, setSelectedDefenderPlayerId] = useState('');
  const [selectedBlockerCardId, setSelectedBlockerCardId] = useState('');
  const [selectedBlockedAttackerId, setSelectedBlockedAttackerId] = useState('');
  const [selectedSpellCardId, setSelectedSpellCardId] = useState('');
  const [selectedSpellTargetId, setSelectedSpellTargetId] = useState('');
  const [realGameView, setRealGameView] = useState<RealGameViewResponse | null>(null);
  const [spectatorRealGameView, setSpectatorRealGameView] = useState<RealGameViewResponse | null>(null);
  const [enginePreflight, setEnginePreflight] = useState<EnginePreflightResponse | null>(null);
  const [spectatorsAllowed, setSpectatorsAllowed] = useState(true);
  const [spectatorDelaySeconds, setSpectatorDelaySeconds] = useState(0);
  const [tableNote, setTableNote] = useState('');
  const [engineNotice, setEngineNotice] = useState('');
  const engineStateRef = useRef<GameState | null>(null);
  const engineRoomRef = useRef('');
  const engineRevisionRef = useRef(0);
  const engineProcessingRef = useRef(false);

  const activeSession = session && room && session.roomId === room.id ? session : null;
  const activeSpectator = !activeSession && spectatorSession && room && spectatorSession.roomId === room.id ? spectatorSession : null;
  const isSeatedInRoom = Boolean(activeSession);
  const occupiedSeats = room?.seats.filter((seat) => seat.name) || [];
  const allReady = occupiedSeats.length > 1 && occupiedSeats.every((seat) => seat.ready);
  const allDecksLocked = occupiedSeats.length > 1 && occupiedSeats.every((seat) => seat.deck_locked);
  const canStart = Boolean(activeSession?.isHost && room?.status === 'waiting' && allReady && allDecksLocked);
  const canStartEngineBeta = Boolean(canStart && enginePreflight?.ok);
  const enginePreflightIssues = enginePreflight?.seats
    .flatMap((seat) => [
      ...seat.unsupported_cards.map((card) => `${seat.player_name}: ${card.name} - ${card.reason}`),
      ...seat.issues.filter((issue) => !/unsupported/i.test(issue)).map((issue) => `${seat.player_name}: ${issue}`),
    ]) || [];
  const inviteUrl = room ? `${window.location.origin}/multiplayer/${room.id}` : '';
  const replayShareUrl = replayReport ? `${window.location.origin}${replayReport.share_url_path}` : room ? `${window.location.origin}/multiplayer/${room.id}?review=1` : '';
  const selectedReplayEvent = replayReport?.events.find((event) => event.id === selectedReplayEventId) || replayReport?.events[0] || null;
  const selectedReplayDecision = selectedReplayEvent
    ? replayReport?.decisions.find((decision) => decision.event_id === selectedReplayEvent.id) || null
    : null;
  const selectedReplayIndex = selectedReplayEvent ? replayReport?.events.findIndex((event) => event.id === selectedReplayEvent.id) ?? 0 : 0;
  const selectedReplayAnnotations = selectedReplayEvent
    ? replayReport?.annotations.filter((annotation) => annotation.event_id === selectedReplayEvent.id) || []
    : [];
  const effectiveRealGameView = activeSpectator ? spectatorRealGameView : realGameView;
  const scopedView = asRoomScopedView(effectiveRealGameView);
  const myScopedPlayer = scopedView?.players.find((player) => player.id === activeSession?.playerId);
  const firstLandInHand = myScopedPlayer?.zones.hand.cards?.find((card) => card.cardTypes.includes('land'));
  const playLandActionHint = scopedView?.legalActions?.find((action) => action.action === 'Play Land');
  const canPlayFirstLand = Boolean(
    firstLandInHand &&
    scopedView &&
    activeSession &&
    scopedView.priorityPlayerId === activeSession.playerId &&
    playLandActionHint?.enabled,
  );
  const isAuthority = Boolean(activeSession && room?.real_game?.authority_player_id === activeSession.playerId);
  const currentTrackerPlayer = room?.game?.players.find((player) => player.name === activeSession?.playerName);
  const trackerTargetSeat = trackerTargetPlayerId || String(currentTrackerPlayer?.seat || room?.game?.players[0]?.seat || 1);
  const myBattlefieldCards = myScopedPlayer?.zones.battlefield.cards || [];
  const myCommandCards = myScopedPlayer?.zones.command.cards || [];
  const firstManaSource = myBattlefieldCards.find(canUseVisibleManaSource);
  const spellsInHand = myScopedPlayer?.zones.hand.cards?.filter((card) => !card.cardTypes.includes('land')) || [];
  const firstSpellInHand = spellsInHand[0];
  const selectedSpellInHand = spellsInHand.find((card) => card.instanceId === selectedSpellCardId) || firstSpellInHand;
  const selectedSpellTargetCount = requiredSpellTargetCount(selectedSpellInHand);
  const selectedSpellTargetOptions = (selectedSpellInHand?.legalTargetIds || []).map((targetId) => ({
    id: targetId,
    label: targetLabel(scopedView, targetId),
  }));
  const selectedSpellTarget = selectedSpellTargetOptions.find((target) => target.id === selectedSpellTargetId) || selectedSpellTargetOptions[0];
  const selectedSpellTargets = selectedSpellTargetCount > 0 && selectedSpellTarget ? [selectedSpellTarget.id] : [];
  const canCastSelectedSpell = Boolean(
    activeSession &&
    scopedView?.priorityPlayerId === activeSession.playerId &&
    selectedSpellInHand &&
    (selectedSpellTargetCount === 0 || selectedSpellTargets.length >= selectedSpellTargetCount),
  );
  const firstCommandSpell = myCommandCards[0];
  const firstAttacker = myBattlefieldCards.find(canUseVisibleAttacker);
  const firstOpponent = scopedView?.players.find((player) => player.id !== activeSession?.playerId);
  const largeEngineBoard = Boolean(scopedView?.complexity?.largeBoardMode);
  const availableAttackers = myBattlefieldCards.filter(canUseVisibleAttacker);
  const defenderOptions = scopedView?.players.filter((player) => player.id !== activeSession?.playerId) || [];
  const availableBlockers = myBattlefieldCards.filter((card) => isCreatureCard(card) && !card.tapped);
  const incomingCombatAssignments = scopedView?.combat?.assignments.filter((assignment) => (
    assignment.defenderName === myScopedPlayer?.name
  )) || [];
  const incomingAttackers = incomingCombatAssignments.map((assignment) => assignment.attacker);
  const selectedAttacker = availableAttackers.find((card) => card.instanceId === selectedAttackCardId) || availableAttackers[0];
  const selectedDefender = defenderOptions.find((player) => player.id === selectedDefenderPlayerId) || defenderOptions[0];
  const selectedBlocker = availableBlockers.find((card) => card.instanceId === selectedBlockerCardId) || availableBlockers[0];
  const selectedBlockedAttacker = incomingAttackers.find((attacker) => attacker.id === selectedBlockedAttackerId) || incomingAttackers[0];
  const engineActivePlayer = scopedView?.players.find((player) => player.id === scopedView.activePlayerId);
  const enginePriorityPlayer = scopedView?.players.find((player) => player.id === scopedView.priorityPlayerId);
  const engineActionHelp = useMemo(() => {
    if (!room?.real_game || !scopedView) return [];
    const help: string[] = (scopedView.legalActions || [])
      .filter((action) => !action.enabled)
      .map((action) => `${action.action}: ${action.reason}`);
    if (activeSpectator) {
      help.push('Spectators can watch priority, stack, and board state but cannot submit game actions.');
      return help;
    }
    if (!activeSession) return help;
    if (scopedView.priorityPlayerId !== activeSession.playerId) {
      help.push(`Waiting for ${enginePriorityPlayer?.name || 'the priority player'} to act.`);
    }
    if (firstLandInHand && !canPlayFirstLand) {
      help.push('Land plays unlock during your main phase while you have priority.');
    }
    if (!firstLandInHand) {
      help.push('No visible land is available in your hand.');
    }
    if (!firstManaSource) {
      help.push('No visible mana source is on your battlefield yet.');
    }
    return Array.from(new Set(help)).slice(0, 6);
  }, [room?.real_game, scopedView, activeSession, activeSpectator, enginePriorityPlayer?.name, firstLandInHand, canPlayFirstLand, firstManaSource]);
  const canDeclareAttackers = Boolean(
    activeSession &&
    scopedView?.legalActions?.find((action) => action.action === 'Declare Attackers')?.enabled,
  );
  const canDeclareBlockers = Boolean(
    activeSession &&
    scopedView?.legalActions?.find((action) => action.action === 'Declare Blockers')?.enabled,
  );
  const canPassPriority = Boolean(
    activeSession &&
    scopedView?.legalActions?.find((action) => action.action === 'Pass Priority')?.enabled,
  );

  useEffect(() => {
    if (spellsInHand.length > 0 && !spellsInHand.some((card) => card.instanceId === selectedSpellCardId)) {
      setSelectedSpellCardId(spellsInHand[0].instanceId);
    }
    if (selectedSpellTargetOptions.length > 0 && !selectedSpellTargetOptions.some((target) => target.id === selectedSpellTargetId)) {
      setSelectedSpellTargetId(selectedSpellTargetOptions[0].id);
    }
    if (selectedSpellTargetOptions.length === 0 && selectedSpellTargetId) {
      setSelectedSpellTargetId('');
    }
    if (availableAttackers.length > 0 && !availableAttackers.some((card) => card.instanceId === selectedAttackCardId)) {
      setSelectedAttackCardId(availableAttackers[0].instanceId);
    }
    if (defenderOptions.length > 0 && !defenderOptions.some((player) => player.id === selectedDefenderPlayerId)) {
      setSelectedDefenderPlayerId(defenderOptions[0].id);
    }
    if (availableBlockers.length > 0 && !availableBlockers.some((card) => card.instanceId === selectedBlockerCardId)) {
      setSelectedBlockerCardId(availableBlockers[0].instanceId);
    }
    if (incomingAttackers.length > 0 && !incomingAttackers.some((attacker) => attacker.id === selectedBlockedAttackerId)) {
      setSelectedBlockedAttackerId(incomingAttackers[0].id);
    }
  }, [
    spellsInHand,
    availableAttackers,
    defenderOptions,
    availableBlockers,
    incomingAttackers,
    selectedSpellCardId,
    selectedSpellTargetId,
    selectedSpellTargetOptions,
    selectedAttackCardId,
    selectedDefenderPlayerId,
    selectedBlockerCardId,
    selectedBlockedAttackerId,
  ]);

  async function refreshRooms() {
    const nextRooms = await listRooms(filterTag);
    setRooms(nextRooms);
  }

  async function refreshRoom(id = selectedRoomId || session?.roomId || roomId || '') {
    if (!id) return;
    const nextRoom = await getRoom(id);
    setRoom(nextRoom);
    setSelectedRoomId(nextRoom.id);
  }

  useEffect(() => {
    refreshRooms().catch((err) => setError(err.message));
  }, [filterTag]);

  useEffect(() => {
    let cancelled = false;
    listPublicReplays(replaySearch)
      .then((items) => {
        if (!cancelled) setPublicReplays(items);
      })
      .catch(() => {
        if (!cancelled) setPublicReplays([]);
      });
    return () => {
      cancelled = true;
    };
  }, [replaySearch, room?.game?.status]);

  useEffect(() => {
    const targetRoomId = roomId || session?.roomId;
    if (!targetRoomId) return;
    refreshRoom(targetRoomId).catch((err) => setError(err.message));
  }, [roomId]);

  useEffect(() => {
    if (!room?.id || !room.game) {
      setReplayReport(null);
      setShowReplayReview(false);
      setSelectedReplayEventId('');
      return;
    }
    const shouldOpen = new URLSearchParams(window.location.search).get('review') === '1' || room.game.status === 'finished';
    if (!shouldOpen && !showReplayReview) return;
    setReplayLoading(true);
    getRoomReplay(room.id)
      .then((report) => {
        setReplayReport(report);
        setShowReplayReview(true);
        setSelectedReplayEventId((current) => preferredReplayEventId(report, current));
      })
      .catch((err) => setError(err.message))
      .finally(() => setReplayLoading(false));
  }, [room?.id, room?.game?.updated_at, room?.game?.status]);

  useEffect(() => {
    if (!room?.id) return;
    const interval = window.setInterval(() => {
      refreshRoom(room.id).catch(() => {
        // Poll quietly; explicit actions surface errors.
      });
    }, 2500);
    return () => window.clearInterval(interval);
  }, [room?.id]);

  useEffect(() => {
    if (!activeSession || !room) return;
    const currentSeat = room.seats.find((seat) => seat.name === activeSession.playerName);
    if (!currentSeat) return;
    if (!seatDraftTouched) {
      setReady(currentSeat.ready);
      setDeckName(currentSeat.deck_name || '');
      setCommander(currentSeat.commander || '');
    }
  }, [room?.updated_at, activeSession?.playerId, seatDraftTouched]);

  useEffect(() => {
    if (!activeSession || !room) {
      setPrivateNotes([]);
      return;
    }
    try {
      const raw = localStorage.getItem(privateNotesStorageKey(room.id, activeSession.playerId));
      setPrivateNotes(raw ? JSON.parse(raw) : []);
    } catch {
      setPrivateNotes([]);
    }
  }, [room?.id, activeSession?.playerId]);

  useEffect(() => {
    if (room?.game?.phase) {
      setSelectedPhase(room.game.phase);
    }
  }, [room?.game?.phase]);

  useEffect(() => {
    let cancelled = false;
    if (!room?.id || !activeSession || room.status !== 'waiting' || !allDecksLocked) {
      setEnginePreflight(null);
      return () => {
        cancelled = true;
      };
    }
    getEnginePreflight(room.id, activeSession.playerId)
      .then((preflight) => {
        if (!cancelled) setEnginePreflight(preflight);
      })
      .catch(() => {
        if (!cancelled) setEnginePreflight(null);
      });
    return () => {
      cancelled = true;
    };
  }, [room?.id, room?.updated_at, room?.status, activeSession?.playerId, allDecksLocked]);

  useEffect(() => {
    if (!room?.settings) return;
    setSpectatorsAllowed(room.settings.spectators_allowed);
    setSpectatorDelaySeconds(room.settings.spectator_delay_seconds || 0);
    setTableNote(room.settings.table_note || '');
  }, [room?.id, room?.settings?.spectators_allowed, room?.settings?.spectator_delay_seconds, room?.settings?.table_note]);

  useEffect(() => {
    if (!room?.game || trackerTargetPlayerId) return;
    const ownPlayer = room.game.players.find((player) => player.name === activeSession?.playerName);
    if (ownPlayer) {
      setTrackerTargetPlayerId(String(ownPlayer.seat));
    }
  }, [room?.game?.players.length, activeSession?.playerId, trackerTargetPlayerId]);

  useEffect(() => {
    if (!room?.real_game || !activeSession) {
      setRealGameView(null);
      return;
    }
    let cancelled = false;
    async function pollView() {
      if (!room?.id || !activeSession) return;
      try {
        const view = await getRealGameView(room.id, activeSession.playerId);
        if (!cancelled) setRealGameView(view);
      } catch {
        // The room poll handles user-visible errors; view polling should stay quiet.
      }
    }
    pollView();
    const interval = window.setInterval(pollView, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [room?.id, room?.real_game?.revision, activeSession?.playerId]);

  useEffect(() => {
    if (!room?.real_game || !activeSpectator) {
      setSpectatorRealGameView(null);
      return;
    }
    let cancelled = false;
    async function pollSpectatorView() {
      if (!room?.id || !activeSpectator) return;
      try {
        const view = await getRealGameSpectatorView(room.id, activeSpectator.spectatorId);
        if (!cancelled) setSpectatorRealGameView(view);
      } catch {
        // Room polling and explicit spectator actions surface errors.
      }
    }
    pollSpectatorView();
    const interval = window.setInterval(pollSpectatorView, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [room?.id, room?.real_game?.revision, activeSpectator?.spectatorId]);

  useEffect(() => {
    if (!room?.real_game || !activeSession || !isAuthority) return;
    let cancelled = false;

    async function ensureEngine() {
      if (!room?.id || !activeSession) return;
      if (engineRoomRef.current === room.id && engineStateRef.current) return;
      const payload = await getRealGameStartPayload(room.id, activeSession.playerId);
      if (cancelled) return;
      engineStateRef.current = await createRoomEngineState(payload);
      engineRoomRef.current = room.id;
      engineRevisionRef.current = Math.max(room.real_game?.revision || 0, 0);
      await publishAuthoritySnapshot(room.id, [], {}, ['Engine state initialized with hidden player views.']);
      setEngineNotice('Authority engine is live in this browser.');
    }

    async function processPendingActions() {
      if (!room?.id || !activeSession || engineProcessingRef.current) return;
      engineProcessingRef.current = true;
      try {
        await ensureEngine();
        const state = engineStateRef.current;
        if (!state) return;
        const pending = await getPendingRealGameActions(room.id, activeSession.playerId);
        if (cancelled || pending.length === 0) return;

        const completed: string[] = [];
        const rejected: Record<string, string> = {};
        const events: string[] = [];
        let nextState = state;
        for (const action of pending) {
          try {
            const result = applyPendingRoomAction(nextState, action);
            if (result.ok) {
              nextState = result.state;
              completed.push(action.id);
              events.push(result.event);
            } else {
              rejected[action.id] = result.error;
            }
          } catch (err) {
            rejected[action.id] = err instanceof Error ? err.message : 'Authority engine action failed.';
          }
        }
        engineStateRef.current = nextState;
        await publishAuthoritySnapshot(room.id, completed, rejected, events);
      } catch (err) {
        setEngineNotice(err instanceof Error ? err.message : 'Authority engine sync failed.');
      } finally {
        engineProcessingRef.current = false;
      }
    }

    processPendingActions();
    const interval = window.setInterval(processPendingActions, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [room?.id, room?.real_game?.authority_player_name, activeSession?.playerId, isAuthority]);

  const popularTags = useMemo(
    () => Array.from(new Set([...defaultTags, ...rooms.flatMap((item) => item.tags)])).slice(0, 10),
    [rooms],
  );

  async function runAction(action: () => Promise<void>) {
    setError('');
    setNotice('');
    setLoading(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function storeSession(nextSession: RoomSession) {
    setSession(nextSession);
    saveSession(nextSession);
    setSpectatorSession(null);
    saveSpectatorSession(null);
  }

  function storeSpectatorSession(nextSession: SpectatorSession) {
    setSpectatorSession(nextSession);
    saveSpectatorSession(nextSession);
    setSession(null);
    saveSession(null);
  }

  function resetSeatDraft() {
    setDeckName('');
    setCommander('');
    setDeckListText('');
    setDeckColors([]);
    setReady(false);
    setGameNote('');
    setSeatDraftTouched(false);
  }

  function useStarterDeck(starterId: string) {
    const starter = BEGINNER_DECKS.find((deck) => deck.id === starterId);
    if (!starter) return;
    setSeatDraftTouched(true);
    setDeckName(starter.name);
    setCommander(starter.commander);
    setDeckListText(starter.decklist);
    setDeckColors(starter.colors);
  }

  async function onCreateRoom(event: FormEvent) {
    event.preventDefault();
    await runAction(async () => {
      const result = await createRoom({
        name: createName,
        host_name: hostName,
        tags: splitTags(tagText),
        password: roomPassword || undefined,
        is_private: isPrivate,
        tier: 'free',
      });
      resetSeatDraft();
      storeSession({
        roomId: result.room.id,
        playerId: result.player_id,
        playerName: hostName,
        isHost: true,
      });
      setRoom(result.room);
      setSelectedRoomId(result.room.id);
      navigate(`/multiplayer/${result.room.id}`);
      setNotice('Room created. Send the invite link when your pod is ready.');
      await refreshRooms();
    });
  }

  async function onJoinRoom(event: FormEvent) {
    event.preventDefault();
    if (!selectedRoomId) return;
    await runAction(async () => {
      const result = await joinRoom(selectedRoomId, {
        player_name: joinName,
        password: joinPassword || undefined,
      });
      resetSeatDraft();
      const joinedSeat = result.room.seats.find((seat) => (seat.name || '').toLowerCase() === joinName.trim().toLowerCase());
      storeSession({
        roomId: result.room.id,
        playerId: result.player_id,
        playerName: joinName,
        isHost: Boolean(joinedSeat?.is_host),
      });
      setRoom(result.room);
      navigate(`/multiplayer/${result.room.id}`);
      setNotice('You joined the room.');
      await refreshRooms();
    });
  }

  async function onSpectateRoom(event: FormEvent) {
    event.preventDefault();
    if (!selectedRoomId) return;
    await runAction(async () => {
      const result = await spectateRoom(selectedRoomId, {
        spectator_name: spectatorName,
        password: spectatorPassword || joinPassword || undefined,
      });
      storeSpectatorSession({
        roomId: result.room.id,
        spectatorId: result.spectator_id,
        spectatorName,
      });
      setRoom(result.room);
      navigate(`/multiplayer/${result.room.id}`);
      setNotice('Spectator mode opened. Hidden hands and libraries stay redacted.');
      await refreshRooms();
    });
  }

  async function onUpdateRoomSettings(event: FormEvent) {
    event.preventDefault();
    if (!room || !activeSession?.isHost) return;
    await runAction(async () => {
      const nextRoom = await updateRoomSettings(room.id, {
        player_id: activeSession.playerId,
        spectators_allowed: spectatorsAllowed,
        spectator_delay_seconds: spectatorDelaySeconds,
        table_note: tableNote,
      });
      setRoom(nextRoom);
      setNotice('Room settings saved.');
    });
  }

  async function onSeatUpdate(event: FormEvent) {
    event.preventDefault();
    if (!room || !activeSession) return;
    await runAction(async () => {
      const list = parseRoomDeckList(deckListText, commander);
      if (ready && (!commander.trim() || list.length === 0)) {
        throw new Error('Lock a commander and deck list before readying for a shared table.');
      }
      const nextRoom = await updateSeat(room.id, {
        player_id: activeSession.playerId,
        ready,
        deck_name: deckName || undefined,
        commander: commander || undefined,
        deck: commander.trim() && list.length > 0
          ? {
              commander,
              list,
              colors: inferDeckColors(list, deckColors),
            }
          : undefined,
      });
      setRoom(nextRoom);
      setSeatDraftTouched(false);
      setNotice(ready ? 'Ready state saved.' : 'Seat updated.');
    });
  }

  async function onSendChat(event: FormEvent) {
    event.preventDefault();
    if (!room || !activeSession || !chatText.trim()) return;
    await runAction(async () => {
      const nextRoom = await sendRoomChat(room.id, {
        player_id: activeSession.playerId,
        message: chatText,
      });
      setRoom(nextRoom);
      setChatText('');
    });
  }

  async function onStartSharedTable() {
    if (!room || !activeSession) return;
    await runAction(async () => {
      const nextRoom = await startRoom(room.id, activeSession.playerId);
      setRoom(nextRoom);
      setNotice('Shared table started.');
    });
  }

  async function onStartEngineBeta() {
    if (!room || !activeSession) return;
    await runAction(async () => {
      const preflight = await getEnginePreflight(room.id, activeSession.playerId);
      setEnginePreflight(preflight);
      if (!preflight.ok) {
        throw new Error(preflight.message);
      }
      const nextRoom = await startRealGame(room.id, activeSession.playerId);
      setRoom(nextRoom);
      setNotice('Experimental engine beta starting. The host browser is authority for this slice.');
    });
  }

  async function onRematch() {
    if (!room || !activeSession) return;
    await runAction(async () => {
      const nextRoom = await rematchRoom(room.id, activeSession.playerId);
      setRoom(nextRoom);
      setNotice('New shared table started.');
    });
  }

  async function copyMatchLog() {
    if (!room?.game) return;
    const text = buildMatchLog(room);
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Match log copied.');
    } catch {
      setError('Copy is blocked in this browser. Select the log text manually.');
    }
  }

  async function loadReplayReview(open = true) {
    if (!room?.game) return;
    setReplayLoading(true);
    setError('');
    try {
      const report = await getRoomReplay(room.id);
      setReplayReport(report);
      setShowReplayReview(open);
      setSelectedReplayEventId((current) => preferredReplayEventId(report, current));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Replay review failed to load.');
    } finally {
      setReplayLoading(false);
    }
  }

  async function copyReplayLink() {
    if (!replayShareUrl) return;
    try {
      await navigator.clipboard.writeText(replayShareUrl);
      setNotice('Replay link copied.');
    } catch {
      setError('Copy is blocked in this browser. Select the replay link manually.');
    }
  }

  function exportReplayJson() {
    if (!replayReport) return;
    const blob = new Blob([JSON.stringify(replayReport, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `deckreps-${replayReport.room_id}-replay-review.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice('Replay review exported.');
  }

  async function submitReplayAnnotation() {
    if (!room?.game || !replayAnnotation.trim()) return;
    setReplayLoading(true);
    setError('');
    try {
      const report = await addReplayAnnotation(room.id, {
        player_id: activeSession?.playerId,
        display_name: activeSession?.playerName || activeSpectator?.spectatorName || 'Replay Viewer',
        event_id: selectedReplayEvent?.id || null,
        message: replayAnnotation,
      });
      setReplayReport(report);
      setReplayAnnotation('');
      setNotice('Replay annotation saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Replay annotation failed.');
    } finally {
      setReplayLoading(false);
    }
  }

  function moveReplayStep(delta: number) {
    if (!replayReport?.events.length) return;
    const current = selectedReplayIndex >= 0 ? selectedReplayIndex : 0;
    const decisionEventIds = new Set(replayReport.decisions.map((decision) => decision.event_id));
    const nextDecisionIndex = delta > 0
      ? replayReport.events.findIndex((event, index) => index > current && decisionEventIds.has(event.id))
      : replayReport.events.reduce(
          (last, event, index) => (index < current && decisionEventIds.has(event.id) ? index : last),
          -1,
        );
    const next = nextDecisionIndex >= 0
      ? nextDecisionIndex
      : Math.max(0, Math.min(replayReport.events.length - 1, current + delta));
    setSelectedReplayEventId(replayReport.events[next].id);
  }

  function exportMatchLog() {
    if (!room?.game) return;
    const text = buildMatchLog(room);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `deckreps-${room.id}-match-log.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice('Match log exported.');
  }

  function addPrivateNote() {
    if (!room || !activeSession || !gameNote.trim()) return;
    const nextNotes = [...privateNotes, gameNote.trim()].slice(-20);
    setPrivateNotes(nextNotes);
    localStorage.setItem(privateNotesStorageKey(room.id, activeSession.playerId), JSON.stringify(nextNotes));
    setGameNote('');
    setNotice('Private note saved on this browser.');
  }

  async function publishAuthoritySnapshot(
    roomIdToPublish: string,
    completedActionIds: string[] = [],
    rejectedActions: Record<string, string> = {},
    events: string[] = [],
  ) {
    const state = engineStateRef.current;
    if (!state || !activeSession) return;
    engineRevisionRef.current += 1;
    const nextRoom = await publishRealGameSnapshot(roomIdToPublish, {
      player_id: activeSession.playerId,
      revision: engineRevisionRef.current,
      views: createRoomScopedViews(state),
      completed_action_ids: completedActionIds,
      rejected_actions: rejectedActions,
      events,
    });
    setRoom(nextRoom);
  }

  async function onSubmitRealAction(action: RealGameAction) {
    if (!room || !activeSession) return;
    await runAction(async () => {
      await submitRealGameAction(room.id, {
        player_id: activeSession.playerId,
        action,
        view_revision: realGameView?.revision ?? room.real_game?.revision ?? 0,
      });
      setNotice('Real engine action submitted to the authority browser.');
      await refreshRoom(room.id);
    });
  }

  async function onGameAction(
    action: GameAction,
    options: {
      amount?: number;
      phase?: GamePhase;
      note?: string;
      target_player_id?: string;
      target_seat?: number;
      object_id?: string;
      counter_type?: string;
      tapped?: boolean;
      zone?: PublicZone;
    } = {},
  ) {
    if (!room || !activeSession) return;
    await runAction(async () => {
      const nextRoom = await sendGameAction(room.id, {
        player_id: activeSession.playerId,
        action,
        amount: options.amount,
        phase: options.phase,
        note: options.note,
        target_player_id: options.target_player_id,
        target_seat: options.target_seat,
        object_id: options.object_id,
        counter_type: options.counter_type,
        tapped: options.tapped,
        zone: options.zone,
      });
      setRoom(nextRoom);
      if (['note', 'player_note', 'play_permanent', 'remove_permanent', 'create_token', 'add_board_object', 'move_to_graveyard', 'move_to_exile', 'move_to_command', 'discard_card', 'exile_from_hand', 'return_to_hand', 'return_to_battlefield'].includes(action)) {
        setGameNote('');
      }
    });
  }

  async function onAdvancePhase() {
    if (!room?.game) return;
    if (room.game.phase === 'ending') {
      await onGameAction('pass_turn');
      return;
    }
    await onGameAction('set_phase', { phase: nextSharedPhase(room.game.phase) });
  }

  async function onLeaveRoom() {
    if (activeSpectator) {
      setSpectatorSession(null);
      saveSpectatorSession(null);
      setSpectatorRealGameView(null);
      setNotice('You left spectator mode.');
      navigate('/multiplayer');
      return;
    }
    if (!room || !activeSession) return;
    await runAction(async () => {
      const nextRoom = await leaveRoom(room.id, activeSession.playerId);
      setRoom(nextRoom.status === 'closed' ? null : nextRoom);
      setSession(null);
      saveSession(null);
      resetSeatDraft();
      setNotice('You left the room.');
      await refreshRooms();
      navigate('/multiplayer');
    });
  }

  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setNotice('Invite link copied.');
    } catch {
      setError('Copy is blocked in this browser. Select the invite link and copy it manually.');
    }
  }

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#15110e] text-stone-50">
      <header className="border-b border-white/10 bg-stone-950/80">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold text-stone-200 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Magic Brains
          </Link>
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/events"
              className="hidden min-h-[36px] items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-black uppercase tracking-[0.12em] text-stone-200 hover:bg-white/10 sm:inline-flex"
            >
              <Crown className="h-4 w-4" />
              Event Center
            </Link>
            <div className="flex items-center gap-2 text-right text-xs font-black uppercase tracking-[0.16em] text-amber-200">
              <Users className="h-4 w-4" />
              Private Rooms Beta
            </div>
          </div>
        </nav>
      </header>

      <main className={`mx-auto grid w-full max-w-7xl gap-6 overflow-x-hidden px-4 py-6 sm:px-6 ${
        isSeatedInRoom ? 'lg:grid-cols-[260px_minmax(0,1fr)]' : 'lg:grid-cols-[390px_1fr]'
      }`}>
        <section className="min-w-0 space-y-4">
          {(activeSession || activeSpectator) && room ? (
            <div className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.04] p-4 shadow-xl shadow-black/10">
              <div className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-amber-200">Current Room</div>
              <h1 className="break-words font-serif text-xl font-bold text-stone-50">{room.name}</h1>
              <div className="mt-2 text-sm font-semibold text-stone-400">
                {activeSession
                  ? `${activeSession.playerName} ${activeSession.isHost ? '- host' : '- seated'}`
                  : `${activeSpectator?.spectatorName} - spectator`}
              </div>
              <div className="mt-3 min-w-0 break-words rounded border border-white/10 bg-stone-950 px-3 py-2 text-xs font-bold text-stone-400">
                {room.player_count}/{room.max_players} seated - {room.status.replace('_', ' ')}
              </div>
              <div className="mt-3 grid gap-2 text-xs font-bold text-stone-300">
                <div className="min-w-0 break-words rounded border border-white/10 bg-stone-950 px-3 py-2">
                  Room code: <span className="text-stone-50">{room.id}</span>
                </div>
                <div className="min-w-0 break-words rounded border border-white/10 bg-stone-950 px-3 py-2">
                  Mode: <span className="text-stone-50">
                    {room.real_game ? 'Engine Beta' : room.game ? 'Shared Tracker' : 'Lobby'}
                  </span>
                </div>
                <div className="min-w-0 break-words rounded border border-white/10 bg-stone-950 px-3 py-2">
                  Spectators: <span className="text-stone-50">
                    {room.settings.spectators_allowed ? `${room.spectator_count} watching` : 'Off'}
                  </span>
                </div>
                <div className="min-w-0 break-words rounded border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-emerald-100">
                  This browser will reconnect as {activeSession?.playerName || activeSpectator?.spectatorName} after refresh.
                </div>
              </div>
              {inviteUrl && (
                <div className="mt-3 grid gap-2">
                  <input
                    readOnly
                    value={inviteUrl}
                    className="min-h-[38px] min-w-0 rounded-lg border border-white/10 bg-stone-950 px-3 text-xs text-stone-300 outline-none"
                  />
                  <button
                    type="button"
                    onClick={copyInvite}
                    className="inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg border border-white/10 px-3 text-sm font-bold text-stone-200 transition hover:bg-white/10"
                  >
                    <Copy className="h-4 w-4" />
                    Copy Invite
                  </button>
                </div>
              )}
              {activeSession?.isHost && (
                <form className="mt-3 grid gap-2 rounded-lg border border-white/10 bg-stone-950 p-3" onSubmit={onUpdateRoomSettings}>
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-stone-500">Room Settings</div>
                  <label className="flex items-center gap-2 text-xs font-bold text-stone-300">
                    <input
                      checked={spectatorsAllowed}
                      onChange={(event) => setSpectatorsAllowed(event.target.checked)}
                      type="checkbox"
                      className="h-4 w-4 accent-emerald-300"
                    />
                    Allow spectators
                  </label>
                  <label className="text-xs font-bold text-stone-300">
                    Spectator delay seconds
                    <input
                      value={spectatorDelaySeconds}
                      onChange={(event) => setSpectatorDelaySeconds(Math.max(0, Number(event.target.value) || 0))}
                      type="number"
                      min={0}
                      max={600}
                      className="mt-1 min-h-[36px] w-full rounded border border-white/10 bg-white/5 px-2 text-sm text-white outline-none"
                    />
                  </label>
                  <label className="text-xs font-bold text-stone-300">
                    Table note
                    <input
                      value={tableNote}
                      onChange={(event) => setTableNote(event.target.value)}
                      maxLength={160}
                      className="mt-1 min-h-[36px] w-full rounded border border-white/10 bg-white/5 px-2 text-sm text-white outline-none"
                      placeholder="Persistent lobby note"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={loading}
                    className="min-h-[38px] rounded-lg border border-white/10 px-3 text-xs font-black uppercase tracking-wider text-stone-200 hover:bg-white/10 disabled:opacity-50"
                  >
                    Save Settings
                  </button>
                </form>
              )}
            </div>
          ) : (
          <div className="rounded-lg border border-white/10 bg-white/[0.06] p-4 shadow-2xl shadow-black/20">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.16em] text-amber-200">Start a Room</div>
                <h1 className="mt-1 font-serif text-2xl font-bold">Host a private beta room</h1>
              </div>
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-amber-300 text-stone-950">
                <Crown className="h-5 w-5" />
              </div>
            </div>

            <form className="space-y-3" onSubmit={onCreateRoom}>
              <label className="block text-sm font-bold text-stone-200">
                Host name
                <input
                  value={hostName}
                  onChange={(event) => setHostName(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-stone-950 px-3 py-3 text-sm text-white outline-none transition focus:border-amber-300"
                  placeholder="Your table name"
                  required
                />
              </label>
              <label className="block text-sm font-bold text-stone-200">
                Room name
                <input
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-stone-950 px-3 py-3 text-sm text-white outline-none transition focus:border-amber-300"
                  required
                />
              </label>
              <label className="block text-sm font-bold text-stone-200">
                Tags
                <input
                  value={tagText}
                  onChange={(event) => setTagText(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-stone-950 px-3 py-3 text-sm text-white outline-none transition focus:border-amber-300"
                  placeholder="casual, precon, no-tutors"
                />
              </label>
              <label className="block text-sm font-bold text-stone-200">
                Password
                <input
                  value={roomPassword}
                  onChange={(event) => setRoomPassword(event.target.value)}
                  type="password"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-stone-950 px-3 py-3 text-sm text-white outline-none transition focus:border-amber-300"
                  placeholder="Optional"
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-white/10 bg-stone-950 px-3 py-3 text-sm font-bold text-stone-200">
                Unlisted invite-only room
                <input
                  checked={isPrivate}
                  onChange={(event) => setIsPrivate(event.target.checked)}
                  type="checkbox"
                  className="h-5 w-5 accent-amber-300"
                />
              </label>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-amber-300 px-4 text-sm font-black text-stone-950 transition hover:bg-amber-200 disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                Create Beta Room
              </button>
            </form>
          </div>
          )}

          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
            <div className="mb-3">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-200">Public Replay Database</div>
              <div className="mt-1 text-sm font-semibold text-stone-400">Finished public shared tables with review artifacts.</div>
            </div>
            <input
              value={replaySearch}
              onChange={(event) => setReplaySearch(event.target.value)}
              className="mb-3 min-h-[38px] w-full rounded-lg border border-white/10 bg-stone-950 px-3 text-sm text-white outline-none focus:border-sky-300"
              placeholder="Search replays, players, commanders"
            />
            <div className="grid max-h-72 gap-2 overflow-y-auto pr-1">
              {publicReplays.length === 0 && (
                <div className="rounded border border-dashed border-white/10 px-3 py-4 text-center text-xs font-semibold text-stone-500">
                  No public finished replays found yet.
                </div>
              )}
              {publicReplays.map((item) => (
                <button
                  key={item.room_id}
                  type="button"
                  onClick={() => navigate(`/multiplayer/${item.room_id}?review=1`)}
                  className="rounded-lg border border-white/10 bg-stone-950 p-3 text-left transition hover:border-sky-300/40 hover:bg-sky-300/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-stone-50">{item.room_name}</div>
                      <div className="mt-1 text-[11px] font-semibold text-stone-500">
                        {item.player_names.join(' vs ')}
                      </div>
                    </div>
                    <div className={`text-xl font-black ${gradeTone(item.grade)}`}>{item.grade}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-black uppercase tracking-wider text-stone-400">
                    <span className="rounded bg-white/8 px-2 py-1">{item.event_count} events</span>
                    <span className="rounded bg-white/8 px-2 py-1">{item.review_confidence}%</span>
                    {item.winner_name && <span className="rounded bg-emerald-300/10 px-2 py-1 text-emerald-100">{item.winner_name} won</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>

        </section>

        <section className="space-y-4">
          {(error || notice) && (
            <div
              className={`rounded-lg border px-4 py-3 text-sm font-bold ${
                error
                  ? 'border-red-300/30 bg-red-950/50 text-red-100'
                  : 'border-emerald-300/30 bg-emerald-950/40 text-emerald-100'
              }`}
            >
              {error || notice}
            </div>
          )}

          {!activeSession && (
          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <div className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-200">Room Browser</div>
                  <h2 className="mt-1 font-serif text-2xl font-bold">Find a table</h2>
                </div>
                <button
                  type="button"
                  onClick={() => runAction(refreshRooms)}
                  className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-white/10 px-3 text-sm font-bold text-stone-200 transition hover:bg-white/10"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </button>
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setFilterTag('')}
                  className={`rounded-lg px-3 py-2 text-xs font-black uppercase tracking-wider ${
                    !filterTag ? 'bg-amber-300 text-stone-950' : 'bg-stone-950 text-stone-300'
                  }`}
                >
                  All
                </button>
                {popularTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setFilterTag(tag)}
                    className={`rounded-lg px-3 py-2 text-xs font-black uppercase tracking-wider ${
                      filterTag === tag ? 'bg-amber-300 text-stone-950' : 'bg-stone-950 text-stone-300'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>

              <div className="grid gap-3">
                {rooms.length === 0 && (
                  <div className="rounded-lg border border-dashed border-white/15 p-6 text-center text-sm text-stone-400">
                    No public rooms yet. Start one and invite your pod.
                  </div>
                )}
                {rooms.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedRoomId(item.id);
                      refreshRoom(item.id).catch((err) => setError(err.message));
                      navigate(`/multiplayer/${item.id}`);
                    }}
                    className={`rounded-lg border p-4 text-left transition ${
                      selectedRoomId === item.id
                        ? 'border-amber-300 bg-amber-300/10'
                        : 'border-white/10 bg-stone-950/70 hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-black text-stone-50">{item.name}</h3>
                          {item.has_password && <Lock className="h-4 w-4 text-amber-200" />}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-stone-400">
                          Host: {item.host_name} - {item.player_count}/{item.max_players} seated
                        </div>
                      </div>
                      <span className="rounded bg-emerald-300/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-200">
                        {item.status}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.tags.map((tag) => (
                        <span key={tag} className="rounded bg-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-stone-300">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
              <div className="mb-4">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-200">Join by Invite</div>
                <h2 className="mt-1 font-serif text-2xl font-bold">Take a seat</h2>
              </div>
              <form className="space-y-3" onSubmit={onJoinRoom}>
                <label className="block text-sm font-bold text-stone-200">
                  Room code
                  <input
                    value={selectedRoomId}
                    onChange={(event) => setSelectedRoomId(event.target.value.trim())}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-stone-950 px-3 py-3 text-sm text-white outline-none transition focus:border-sky-300"
                    placeholder="Invite code"
                    required
                  />
                </label>
                <label className="block text-sm font-bold text-stone-200">
                  Your name
                  <input
                    value={joinName}
                    onChange={(event) => setJoinName(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-stone-950 px-3 py-3 text-sm text-white outline-none transition focus:border-sky-300"
                    required
                  />
                </label>
                <label className="block text-sm font-bold text-stone-200">
                  Password
                  <input
                    value={joinPassword}
                    onChange={(event) => setJoinPassword(event.target.value)}
                    type="password"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-stone-950 px-3 py-3 text-sm text-white outline-none transition focus:border-sky-300"
                    placeholder="If required"
                  />
                </label>
                <button
                  type="submit"
                  disabled={loading || !selectedRoomId}
                  className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-sky-200 px-4 text-sm font-black text-stone-950 transition hover:bg-sky-100 disabled:opacity-60"
                >
                  <Users className="h-4 w-4" />
                  Join Room
                </button>
              </form>
              <form className="mt-4 space-y-3 rounded-lg border border-white/10 bg-stone-950 p-3" onSubmit={onSpectateRoom}>
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-emerald-200">
                  <Eye className="h-4 w-4" />
                  Spectate
                </div>
                <input
                  value={spectatorName}
                  onChange={(event) => setSpectatorName(event.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-white outline-none transition focus:border-emerald-300"
                  placeholder="Spectator name"
                  required
                />
                <input
                  value={spectatorPassword}
                  onChange={(event) => setSpectatorPassword(event.target.value)}
                  type="password"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-white outline-none transition focus:border-emerald-300"
                  placeholder="Room password if required"
                />
                <button
                  type="submit"
                  disabled={loading || !selectedRoomId}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-emerald-300/30 px-4 text-sm font-black text-emerald-100 transition hover:bg-emerald-300/10 disabled:opacity-60"
                >
                  <Eye className="h-4 w-4" />
                  Spectate Room
                </button>
              </form>
            </div>
          </div>
          )}

          {room && (
            <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
              <div className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-serif text-3xl font-bold">{room.name}</h2>
                      {room.has_password && <Lock className="h-5 w-5 text-amber-200" />}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {room.tags.map((tag) => (
                        <span key={tag} className="rounded bg-white/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-stone-300">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-stone-950 px-3 py-2 text-sm font-bold text-stone-300">
                    {room.player_count}/{room.max_players} seated - {room.status.replace('_', ' ')} - {room.spectator_count} watching
                  </div>
                </div>

                {(room.settings.table_note || room.settings.scheduled_for || !room.settings.spectators_allowed) && (
                  <div className="mb-4 rounded-lg border border-white/10 bg-stone-950 px-3 py-2 text-sm font-semibold text-stone-300">
                    {room.settings.table_note && <div>{room.settings.table_note}</div>}
                    {room.settings.scheduled_for && <div>Scheduled: {room.settings.scheduled_for}</div>}
                    {!room.settings.spectators_allowed && <div>Spectators are disabled for this room.</div>}
                  </div>
                )}

                {room.status === 'waiting' ? (
                  <>
                    <div className="mb-4 grid gap-2 rounded-lg border border-white/10 bg-stone-950 p-3 md:grid-cols-[1fr_auto]">
                      <input
                        readOnly
                        value={inviteUrl}
                        className="min-h-[40px] min-w-0 rounded bg-white/5 px-3 text-sm text-stone-200 outline-none"
                      />
                      <button
                        type="button"
                        onClick={copyInvite}
                        className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg bg-white/10 px-3 text-sm font-bold text-stone-100 transition hover:bg-white/15"
                      >
                        <Copy className="h-4 w-4" />
                        Copy Invite
                      </button>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      {room.seats.map((seat) => (
                        <div key={seat.seat} className="rounded-lg border border-white/10 bg-stone-950 p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <div className="text-xs font-black uppercase tracking-[0.16em] text-stone-500">Seat {seat.seat}</div>
                            {seat.is_host && (
                              <span className="inline-flex items-center gap-1 rounded bg-amber-300/10 px-2 py-1 text-[10px] font-black uppercase text-amber-200">
                                <Crown className="h-3 w-3" />
                                Host
                              </span>
                            )}
                          </div>
                          {seat.name ? (
                            <div>
                              <div className="flex items-center justify-between gap-3">
                                <div className="font-black text-stone-50">{seat.name}</div>
                                <div className={`rounded px-2 py-1 text-[10px] font-black uppercase ${
                                  seat.disconnected
                                    ? 'bg-amber-300/10 text-amber-200'
                                    : seat.ready
                                      ? 'bg-emerald-300/10 text-emerald-200'
                                      : 'bg-stone-700 text-stone-300'
                                }`}>
                                  {seat.disconnected ? 'Reconnectable' : seat.ready ? 'Ready' : 'Not Ready'}
                                </div>
                              </div>
                              <div className="mt-3 space-y-1 text-sm text-stone-400">
                                <div>Deck: {seat.deck_name || 'Not locked'}</div>
                                <div>Commander: {seat.commander || 'Not set'}</div>
                                <div>List: {seat.deck_locked ? `${seat.deck_card_count} cards locked` : 'No deck list locked'}</div>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded border border-dashed border-white/15 p-4 text-center text-sm text-stone-500">
                              Open seat
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="mb-4 rounded-lg border border-white/10 bg-stone-950 p-3">
                    <div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-stone-500">Players</div>
                    <div className="flex flex-wrap gap-2">
                      {occupiedSeats.map((seat) => (
                        <span
                          key={seat.seat}
                          className="inline-flex min-h-[32px] items-center gap-2 rounded-lg bg-white/8 px-3 text-xs font-bold text-stone-200"
                        >
                          {seat.is_host && <Crown className="h-3 w-3 text-amber-200" />}
                          {seat.name}
                          {seat.disconnected && <span className="text-amber-200">reconnectable</span>}
                          <span className="text-stone-500">{seat.commander || seat.deck_name || 'table seat'}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {activeSession && room.status === 'waiting' && (
                  <form className="mt-4 rounded-lg border border-white/10 bg-stone-950 p-4" onSubmit={onSeatUpdate}>
                    <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-amber-200">
                      <Shield className="h-4 w-4" />
                      Your Seat
                    </div>
                    <div className="mb-3 flex flex-wrap gap-2">
                      {BEGINNER_DECKS.map((starter) => (
                        <button
                          key={starter.id}
                          type="button"
                          onClick={() => useStarterDeck(starter.id)}
                          className="min-h-[36px] rounded-lg border border-amber-300/20 px-3 text-xs font-black uppercase tracking-wider text-amber-100 transition hover:bg-amber-300/10"
                        >
                          {starter.name}
                        </button>
                      ))}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <input
                        value={deckName}
                        onChange={(event) => {
                          setSeatDraftTouched(true);
                          setDeckName(event.target.value);
                        }}
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-white outline-none focus:border-amber-300"
                        placeholder="Deck name"
                      />
                      <input
                        value={commander}
                        onChange={(event) => {
                          setSeatDraftTouched(true);
                          setCommander(event.target.value);
                        }}
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-white outline-none focus:border-amber-300"
                        placeholder="Commander"
                      />
                    </div>
                    <textarea
                      value={deckListText}
                      onChange={(event) => {
                        setSeatDraftTouched(true);
                        setDeckListText(event.target.value);
                      }}
                      className="mt-3 min-h-[180px] w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-white outline-none focus:border-amber-300"
                      placeholder="Paste a Commander decklist here. The commander can be listed too; it will be removed from the library list."
                    />
                    <div className="mt-2 text-xs font-semibold text-stone-400">
                      {parseRoomDeckList(deckListText, commander).length} non-commander cards ready to lock.
                    </div>
                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <label className="inline-flex items-center gap-3 text-sm font-bold text-stone-200">
                        <input
                          checked={ready}
                          onChange={(event) => {
                            setSeatDraftTouched(true);
                            setReady(event.target.checked);
                          }}
                          type="checkbox"
                          className="h-5 w-5 accent-emerald-300"
                        />
                        Ready to play
                      </label>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                          type="submit"
                          disabled={loading}
                          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-black text-stone-950 transition hover:bg-stone-200 disabled:opacity-60"
                        >
                          <Check className="h-4 w-4" />
                          Save Seat
                        </button>
                        {activeSession.isHost && (
                          <>
                            <button
                              type="button"
                              onClick={onStartSharedTable}
                              disabled={!canStart || loading}
                              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-emerald-300 px-4 text-sm font-black text-stone-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Swords className="h-4 w-4" />
                              Start Shared Table
                            </button>
                            <button
                              type="button"
                              onClick={onStartEngineBeta}
                              disabled={!canStartEngineBeta || loading}
                              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-sky-300/30 bg-sky-300/10 px-4 text-sm font-black text-sky-100 transition hover:bg-sky-300/20 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Shield className="h-4 w-4" />
                              Start Engine Beta
                            </button>
                            <div className="text-xs font-semibold text-stone-500 sm:basis-full sm:text-right">
                              Shared Table is the soft-launch path. Engine Beta requires a clean deck preflight.
                            </div>
                            {enginePreflight && (
                              <div className={`rounded-lg border px-3 py-2 text-xs font-bold sm:basis-full ${
                                enginePreflight.ok
                                  ? 'border-sky-300/20 bg-sky-300/10 text-sky-100'
                                  : 'border-amber-300/25 bg-amber-300/10 text-amber-50'
                              }`}>
                                <div>{enginePreflight.message}</div>
                                {enginePreflightIssues.length > 0 && (
                                  <ul className="mt-2 space-y-1">
                                    {enginePreflightIssues.slice(0, 5).map((issue) => (
                                      <li key={issue}>{issue}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </form>
                )}

                {room.status === 'in_game' && room.game && (
                  <div className="mt-4 space-y-4 rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-200">Shared Table</div>
                        <div className="mt-1 text-2xl font-black text-stone-50">
                          {room.game.status === 'finished' ? 'Match Complete' : `Turn ${room.game.turn_number} - ${room.game.phase}`}
                        </div>
                        {room.game.status === 'finished' ? (
                          <div className="mt-1 rounded border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-sm font-bold text-emerald-50">
                            {room.game.winner_name ? `${room.game.winner_name} wins the shared table.` : 'The shared table ended with no winner.'}
                          </div>
                        ) : (
                          <div className="text-sm font-semibold text-emerald-100">
                            Current turn: {room.game.active_player_name}
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-emerald-50">
                          <span className="rounded bg-white/10 px-2 py-1">
                            Monarch: {room.game.monarch_player_name || 'None'}
                          </span>
                          <span className="rounded bg-white/10 px-2 py-1">
                            Initiative: {room.game.initiative_player_name || 'None'}
                          </span>
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 lg:flex">
                        <button
                          type="button"
                          onClick={() => refreshRoom(room.id).catch((err) => setError(err.message))}
                          className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-emerald-300/20 px-3 text-sm font-bold text-emerald-100 transition hover:bg-emerald-300/10"
                        >
                          <RefreshCw className="h-4 w-4" />
                          Sync
                        </button>
                        <button
                          type="button"
                          onClick={() => onGameAction('undo')}
                          disabled={!room.game.can_undo}
                          className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-amber-300/30 px-3 text-sm font-bold text-amber-100 transition hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Undo
                        </button>
                        <button
                          type="button"
                          onClick={copyMatchLog}
                          className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-white/10 px-3 text-sm font-bold text-stone-100 transition hover:bg-white/10"
                        >
                          Copy Log
                        </button>
                        <button
                          type="button"
                          onClick={exportMatchLog}
                          className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-white/10 px-3 text-sm font-bold text-stone-100 transition hover:bg-white/10"
                        >
                          <Download className="h-4 w-4" />
                          Export Log
                        </button>
                        {activeSession?.isHost && room.game.status === 'finished' && (
                          <button
                            type="button"
                            onClick={onRematch}
                            className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-emerald-300 px-3 text-sm font-black text-stone-950 transition hover:bg-emerald-200"
                          >
                            New Game
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => loadReplayReview(true)}
                          disabled={replayLoading}
                          className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-sky-300/30 px-3 text-sm font-black text-sky-100 transition hover:bg-sky-300/10 disabled:opacity-50"
                        >
                          Replay Review
                        </button>
                      </div>
                    </div>

                    {showReplayReview && (
                      <div className="relative z-20 mb-6 rounded-lg border border-sky-300/20 bg-sky-300/10 p-4">
                        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-100">Learning Replay</div>
                            <div className="mt-1 font-serif text-2xl font-bold text-stone-50">
                              {replayReport ? replayReport.room_name : 'Replay review loading'}
                            </div>
                            {replayReport && (
                              <div className="mt-2 flex flex-wrap gap-2 text-xs font-black uppercase tracking-wider text-sky-50">
                                <span className="rounded bg-white/10 px-2 py-1">{replayReport.summary.event_count} replay events</span>
                                <span className="rounded bg-white/10 px-2 py-1">{replayReport.summary.decision_count} reviewed decisions</span>
                                <span className="rounded bg-white/10 px-2 py-1">Confidence {replayReport.summary.review_confidence}%</span>
                                <span className={`rounded bg-stone-950 px-2 py-1 ${gradeTone(replayReport.summary.grade)}`}>
                                  Grade {replayReport.summary.grade}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[430px]">
                            <button
                              type="button"
                              onClick={copyReplayLink}
                              disabled={!replayReport}
                              className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-white/10 px-3 text-sm font-bold text-stone-100 hover:bg-white/10 disabled:opacity-50"
                            >
                              <Copy className="h-4 w-4" />
                              Share Replay
                            </button>
                            <button
                              type="button"
                              onClick={exportReplayJson}
                              disabled={!replayReport}
                              className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-white/10 px-3 text-sm font-bold text-stone-100 hover:bg-white/10 disabled:opacity-50"
                            >
                              <Download className="h-4 w-4" />
                              Export Review
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowReplayReview(false)}
                              className="min-h-[40px] rounded-lg border border-white/10 px-3 text-sm font-bold text-stone-100 hover:bg-white/10"
                            >
                              Collapse
                            </button>
                          </div>
                        </div>

                        {replayLoading && (
                          <div className="rounded border border-white/10 bg-stone-950 px-3 py-2 text-sm font-bold text-sky-100">
                            Loading replay review...
                          </div>
                        )}

                        {replayReport && selectedReplayEvent && (
                          <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
                            <div className="space-y-3">
                              <div className="relative z-30 rounded-lg border border-white/10 bg-stone-950 p-3">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <div className="text-xs font-black uppercase tracking-[0.16em] text-stone-500">Replay Timeline</div>
                                  <div className="text-[10px] font-black uppercase tracking-wider text-stone-600">
                                    {selectedReplayIndex + 1}/{replayReport.events.length}
                                  </div>
                                </div>
                                <div className="mb-3 grid grid-cols-2 gap-2">
                                  <button
                                    type="button"
                                    onClick={() => moveReplayStep(-1)}
                                    disabled={selectedReplayIndex <= 0}
                                    className="min-h-[38px] rounded-lg border border-white/10 px-3 text-xs font-black uppercase tracking-wider text-stone-100 hover:bg-white/10 disabled:opacity-40"
                                  >
                                    Previous
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveReplayStep(1)}
                                    disabled={selectedReplayIndex >= replayReport.events.length - 1}
                                    className="min-h-[38px] rounded-lg border border-white/10 px-3 text-xs font-black uppercase tracking-wider text-stone-100 hover:bg-white/10 disabled:opacity-40"
                                  >
                                    Next Decision
                                  </button>
                                </div>
                                <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
                                  {replayReport.events.map((event) => {
                                    const decision = replayReport.decisions.find((item) => item.event_id === event.id);
                                    return (
                                      <button
                                        key={event.id}
                                        type="button"
                                        onClick={() => setSelectedReplayEventId(event.id)}
                                        className={`w-full rounded border px-3 py-2 text-left text-xs transition ${
                                          selectedReplayEvent.id === event.id
                                            ? 'border-sky-300/50 bg-sky-300/10 text-sky-50'
                                            : 'border-white/10 bg-white/5 text-stone-300 hover:bg-white/10'
                                        }`}
                                      >
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="font-black">{replayEventLabel(event)}</span>
                                          {decision && (
                                            <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${replayRatingTone(decision.rating)}`}>
                                              {decision.rating}
                                            </span>
                                          )}
                                        </div>
                                        <div className="mt-1 line-clamp-2 leading-5">{event.message}</div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              <div className="rounded-lg border border-white/10 bg-stone-950 p-3">
                                <div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-stone-500">Personalized Insights</div>
                                <div className="grid gap-2">
                                  {replayReport.player_insights.length === 0 && (
                                    <div className="rounded border border-dashed border-white/10 px-3 py-4 text-center text-xs font-semibold text-stone-500">
                                      More tracked decisions will create player-specific patterns.
                                    </div>
                                  )}
                                  {replayReport.player_insights.map((insight, index) => (
                                    <div key={`${insight.player_name}-${insight.category}-${index}`} className="rounded border border-violet-300/20 bg-violet-300/10 px-3 py-2 text-xs text-violet-50">
                                      <div className="font-black uppercase tracking-wider text-violet-200">{insight.player_name} - {insight.category}</div>
                                      <div className="mt-1 leading-5">{insight.message}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div className="space-y-3">
                              <div className={`rounded-lg border p-3 ${replayRatingTone(selectedReplayDecision?.rating)}`}>
                                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                                  <div>
                                    <div className="text-xs font-black uppercase tracking-[0.16em] opacity-70">Selected Replay Step</div>
                                    <div className="mt-1 text-lg font-black">{replayEventLabel(selectedReplayEvent)}</div>
                                    <div className="mt-1 text-sm font-semibold leading-6">{selectedReplayEvent.message}</div>
                                  </div>
                                  {selectedReplayDecision && (
                                    <div className="rounded bg-stone-950 px-3 py-2 text-center">
                                      <div className="text-[10px] font-black uppercase tracking-wider text-stone-500">Rating</div>
                                      <div className="text-xl font-black capitalize">{selectedReplayDecision.rating}</div>
                                    </div>
                                  )}
                                </div>
                                {selectedReplayDecision && (
                                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                                    <div className="rounded bg-stone-950/70 p-3">
                                      <div className="mb-1 text-xs font-black uppercase tracking-[0.16em] text-stone-400">What Were My Options?</div>
                                      <div className="grid gap-1 text-xs font-semibold leading-5">
                                        {selectedReplayDecision.available_options.map((option) => (
                                          <div key={option} className="rounded bg-white/8 px-2 py-1">{option}</div>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="rounded bg-stone-950/70 p-3">
                                      <div className="mb-1 text-xs font-black uppercase tracking-[0.16em] text-stone-400">Compare Lines</div>
                                      <div className="text-xs font-semibold leading-5">
                                        <div><span className="font-black">Selected:</span> {selectedReplayDecision.selected_line}</div>
                                        <div className="mt-2"><span className="font-black">Likely stronger line:</span> {selectedReplayDecision.better_line}</div>
                                        <div className="mt-2"><span className="font-black">Coach:</span> {selectedReplayDecision.coaching_note}</div>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>

                              <div className="rounded-lg border border-white/10 bg-stone-950 p-3">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <div className="text-xs font-black uppercase tracking-[0.16em] text-stone-500">State Snapshot</div>
                                  <div className="text-[10px] font-black uppercase tracking-wider text-stone-600">
                                    Active: {selectedReplayEvent.state.active_player_name}
                                  </div>
                                </div>
                                <div className="grid gap-2 md:grid-cols-2">
                                  {selectedReplayEvent.state.players.map((player) => (
                                    <div key={`${selectedReplayEvent.id}-${player.seat}`} className="rounded border border-white/10 bg-white/5 p-3">
                                      <div className="flex items-start justify-between gap-2">
                                        <div>
                                          <div className="font-black text-stone-50">{player.name}</div>
                                          <div className="text-xs font-semibold text-stone-500">{player.commander || 'No commander recorded'}</div>
                                        </div>
                                        <div className="text-right">
                                          <div className="text-2xl font-black text-stone-50">{player.life}</div>
                                          <div className="text-[10px] font-black uppercase text-stone-500">life</div>
                                        </div>
                                      </div>
                                      <div className="mt-3 grid grid-cols-3 gap-1 text-[11px] font-bold text-stone-300">
                                        <span className="rounded bg-white/8 px-2 py-1">Hand {player.hand_count}</span>
                                        <span className="rounded bg-white/8 px-2 py-1">Board {player.battlefield_count}</span>
                                        <span className="rounded bg-white/8 px-2 py-1">GY {player.graveyard_count}</span>
                                        <span className="rounded bg-white/8 px-2 py-1">Exile {player.exile_count}</span>
                                        <span className="rounded bg-white/8 px-2 py-1">Cmd {player.command_zone_count}</span>
                                        <span className="rounded bg-white/8 px-2 py-1">Poison {player.poison_count}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <div className="rounded-lg border border-white/10 bg-stone-950 p-3">
                                <div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-stone-500">Community Annotations</div>
                                <div className="mb-3 grid gap-2">
                                  {selectedReplayAnnotations.length === 0 && (
                                    <div className="rounded border border-dashed border-white/10 px-3 py-4 text-center text-xs font-semibold text-stone-500">
                                      No annotations on this replay step yet.
                                    </div>
                                  )}
                                  {selectedReplayAnnotations.map((annotation) => (
                                    <div key={annotation.id} className="rounded bg-white/5 px-3 py-2 text-sm text-stone-200">
                                      <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-wider text-stone-500">
                                        <span>{annotation.author_name}</span>
                                        <span>{formatTime(annotation.created_at)}</span>
                                      </div>
                                      {annotation.message}
                                    </div>
                                  ))}
                                </div>
                                <div className="relative z-40 grid gap-2 md:grid-cols-[1fr_auto]">
                                  <input
                                    value={replayAnnotation}
                                    onChange={(event) => setReplayAnnotation(event.target.value)}
                                    className="min-h-[42px] rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none focus:border-sky-300"
                                    placeholder="Add a note for this replay step"
                                    maxLength={500}
                                  />
                                  <button
                                    type="button"
                                    onClick={submitReplayAnnotation}
                                    disabled={!replayAnnotation.trim() || replayLoading}
                                    className="min-h-[42px] rounded-lg bg-sky-200 px-4 text-sm font-black text-stone-950 hover:bg-sky-100 disabled:opacity-50"
                                  >
                                    Add Annotation
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="relative z-0 grid gap-3 md:grid-cols-2">
                      {room.game.players.map((player) => (
                        <div
                          key={player.seat}
                          className={`rounded-lg border p-4 ${
                            player.is_active
                              ? 'border-emerald-300/50 bg-emerald-300/10'
                              : 'border-white/10 bg-stone-950'
                          }`}
                        >
                          <div className="mb-3 flex items-start justify-between gap-3">
                            <div>
                              <div className="font-black text-stone-50">{player.name}</div>
                              <div className="text-xs font-semibold text-stone-400">
                                {player.commander || 'Commander not set'}
                              </div>
                            </div>
                            <div className={`rounded px-2 py-1 text-[10px] font-black uppercase ${
                              player.conceded ? 'bg-red-300/10 text-red-200' : 'bg-emerald-300/10 text-emerald-200'
                            }`}>
                              {player.conceded ? 'Out' : player.is_active ? 'Active' : 'Waiting'}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                            <div className="rounded bg-white/5 px-3 py-2">
                              <div className="text-[10px] font-black uppercase tracking-wider text-stone-500">Life</div>
                              <div className="text-2xl font-black text-stone-50">{player.life}</div>
                            </div>
                            <div className="rounded bg-white/5 px-3 py-2">
                              <div className="text-[10px] font-black uppercase tracking-wider text-stone-500">Hand</div>
                              <div className="text-2xl font-black text-stone-50">{player.hand_count}</div>
                            </div>
                            <div className="rounded bg-white/5 px-3 py-2">
                              <div className="text-[10px] font-black uppercase tracking-wider text-stone-500">Board</div>
                              <div className="text-2xl font-black text-stone-50">{player.battlefield_count}</div>
                            </div>
                            <div className="rounded bg-white/5 px-3 py-2">
                              <div className="text-[10px] font-black uppercase tracking-wider text-stone-500">GY / Lib</div>
                              <div className="text-2xl font-black text-stone-50">{player.graveyard_count} / {player.library_count}</div>
                            </div>
                            <div className="rounded bg-white/5 px-3 py-2">
                              <div className="text-[10px] font-black uppercase tracking-wider text-stone-500">Exile</div>
                              <div className="text-2xl font-black text-stone-50">{player.exile_count}</div>
                            </div>
                            <div className="rounded bg-white/5 px-3 py-2">
                              <div className="text-[10px] font-black uppercase tracking-wider text-stone-500">Command</div>
                              <div className="text-2xl font-black text-stone-50">{player.command_zone_count}</div>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                            <div className="rounded bg-white/5 px-3 py-2">
                              <div className="font-black uppercase tracking-wider text-stone-500">Tax</div>
                              <div className="text-lg font-black text-stone-50">{player.commander_tax}</div>
                            </div>
                            <div className="rounded bg-white/5 px-3 py-2">
                              <div className="font-black uppercase tracking-wider text-stone-500">Poison</div>
                              <div className="text-lg font-black text-stone-50">{player.poison_count}</div>
                            </div>
                            <div className="rounded bg-white/5 px-3 py-2">
                              <div className="font-black uppercase tracking-wider text-stone-500">Counters</div>
                              <div className="mt-1 flex flex-wrap gap-1 text-stone-100">
                                {Object.entries(player.custom_counters || {}).filter(([, value]) => value > 0).length === 0 && (
                                  <span className="text-stone-500">None</span>
                                )}
                                {Object.entries(player.custom_counters || {}).filter(([, value]) => value > 0).map(([key, value]) => (
                                  <span key={key} className="rounded bg-white/10 px-2 py-1">{key}: {value}</span>
                                ))}
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 rounded border border-white/10 bg-white/5 p-3">
                            <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-stone-500">Commander Damage</div>
                            <div className="flex flex-wrap gap-1 text-xs">
                              {Object.entries(player.commander_damage || {}).length === 0 && <span className="text-stone-500">None recorded</span>}
                              {Object.entries(player.commander_damage || {}).map(([source, damage]) => (
                                <span key={source} className="rounded bg-red-300/10 px-2 py-1 font-bold text-red-100">
                                  {source}: {damage}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="mt-3 rounded border border-white/10 bg-stone-950 p-3">
                            <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-stone-500">Board Objects</div>
                            <div className="space-y-2">
                              {player.battlefield_objects.length === 0 && <div className="text-xs text-stone-500">No named objects yet.</div>}
                              {player.battlefield_objects.map((object) => (
                                <div key={object.id} className={`rounded border px-3 py-2 text-xs ${
                                  object.tapped ? 'border-amber-300/40 bg-amber-300/10' : 'border-white/10 bg-white/5'
                                }`}>
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <div className="font-black text-stone-100">
                                        {object.count > 1 ? `${object.count}x ` : ''}{object.name}
                                      </div>
                                      <div className="text-stone-500">{object.kind}{object.tapped ? ' - tapped' : ''}</div>
                                    </div>
                                    {player.name === activeSession?.playerName && (
                                      <div className="flex flex-wrap justify-end gap-1">
                                        <button
                                          type="button"
                                          onClick={() => onGameAction('tap_object', { object_id: object.id, tapped: !object.tapped })}
                                          className="rounded bg-white/10 px-2 py-1 font-bold text-stone-100 hover:bg-white/15"
                                        >
                                          {object.tapped ? 'Untap' : 'Tap'}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => onGameAction('add_object_counter', { object_id: object.id, counter_type: '+1/+1' })}
                                          className="rounded bg-emerald-300/20 px-2 py-1 font-bold text-emerald-100 hover:bg-emerald-300/30"
                                        >
                                          +1/+1
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => onGameAction('move_to_graveyard', { object_id: object.id })}
                                          className="rounded bg-white/10 px-2 py-1 font-bold text-stone-100 hover:bg-white/15"
                                        >
                                          GY
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => onGameAction('move_to_exile', { object_id: object.id })}
                                          className="rounded bg-white/10 px-2 py-1 font-bold text-stone-100 hover:bg-white/15"
                                        >
                                          Exile
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => onGameAction('move_to_command', { object_id: object.id })}
                                          className="rounded bg-white/10 px-2 py-1 font-bold text-stone-100 hover:bg-white/15"
                                        >
                                          Command
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  {Object.entries(object.counters || {}).filter(([, value]) => value > 0).length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                      {Object.entries(object.counters || {}).filter(([, value]) => value > 0).map(([key, value]) => (
                                        <span key={key} className="rounded bg-white/10 px-2 py-1 text-stone-100">{key}: {value}</span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                          {player.notes.length > 0 && (
                            <div className="mt-3 rounded border border-sky-300/20 bg-sky-300/10 p-3 text-xs text-sky-50">
                              <div className="mb-1 font-black uppercase tracking-wider text-sky-200">Notes</div>
                              {player.notes.map((note, index) => <div key={`${note}-${index}`}>{note}</div>)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {activeSession && room.game.status === 'playing' && (
                      <div className="rounded-lg border border-white/10 bg-stone-950 p-3">
                        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                          <div>
                            <div className="text-xs font-black uppercase tracking-[0.16em] text-amber-200">Table Controls</div>
                            <div className="mt-1 text-xs font-semibold text-stone-500">Target, counters, tokens, and turn flow stay in this tray.</div>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-4">
                            <label className="text-xs font-bold text-stone-400">
                              Target
                              <select
                                aria-label="Target"
                                value={trackerTargetSeat}
                                onChange={(event) => setTrackerTargetPlayerId(event.target.value)}
                                className="mt-1 min-h-[40px] w-full rounded-lg border border-white/10 bg-stone-900 px-3 text-sm font-bold text-stone-100 outline-none"
                              >
                                {room.game.players.map((player) => (
                                  <option key={player.seat} value={String(player.seat)}>{player.name}</option>
                                ))}
                              </select>
                            </label>
                            <label className="text-xs font-bold text-stone-400">
                              Amount
                              <input
                                value={trackerAmount}
                                onChange={(event) => setTrackerAmount(Math.max(1, Math.min(99, Number(event.target.value) || 1)))}
                                type="number"
                                min={1}
                                max={99}
                                className="mt-1 min-h-[40px] w-full rounded-lg border border-white/10 bg-stone-900 px-3 text-sm font-bold text-stone-100 outline-none"
                              />
                            </label>
                            <label className="text-xs font-bold text-stone-400">
                              Counter
                              <input
                                value={trackerCounterType}
                                onChange={(event) => setTrackerCounterType(event.target.value)}
                                className="mt-1 min-h-[40px] w-full rounded-lg border border-white/10 bg-stone-900 px-3 text-sm font-bold text-stone-100 outline-none"
                              />
                            </label>
                            <label className="text-xs font-bold text-stone-400">
                              Source Zone
                              <select
                                aria-label="Source Zone"
                                value={trackerSourceZone}
                                onChange={(event) => setTrackerSourceZone(event.target.value as PublicZone)}
                                className="mt-1 min-h-[40px] w-full rounded-lg border border-white/10 bg-stone-900 px-3 text-sm font-bold text-stone-100 outline-none"
                              >
                                <option value="graveyard">Graveyard</option>
                                <option value="exile">Exile</option>
                                <option value="command">Command</option>
                              </select>
                            </label>
                          </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <button type="button" onClick={() => onGameAction('draw_card')} className="min-h-[42px] rounded-lg bg-sky-200 px-3 text-sm font-black text-stone-950 hover:bg-sky-100">Draw</button>
                          <button type="button" onClick={() => onGameAction('play_permanent', { note: gameNote })} className="min-h-[42px] rounded-lg bg-emerald-300 px-3 text-sm font-black text-stone-950 hover:bg-emerald-200">Play Permanent</button>
                          <button type="button" onClick={() => onGameAction('create_token', { amount: trackerAmount, note: gameNote })} className="min-h-[42px] rounded-lg bg-emerald-300/20 px-3 text-sm font-black text-emerald-100 hover:bg-emerald-300/30">Create Token</button>
                          <button type="button" onClick={() => onGameAction('add_board_object', { amount: trackerAmount, note: gameNote })} className="min-h-[42px] rounded-lg bg-white/10 px-3 text-sm font-bold text-stone-100 hover:bg-white/15">Add Board Entry</button>
                          <button type="button" onClick={() => onGameAction('remove_permanent', { note: gameNote })} className="min-h-[42px] rounded-lg border border-red-300/30 px-3 text-sm font-black text-red-100 hover:bg-red-950/50">Remove Last</button>
                          <button type="button" onClick={() => onGameAction('move_to_exile', { note: gameNote })} className="min-h-[42px] rounded-lg border border-sky-300/30 px-3 text-sm font-black text-sky-100 hover:bg-sky-950/40">Move Last to Exile</button>
                          <button type="button" onClick={() => onGameAction('move_to_command', { note: gameNote })} className="min-h-[42px] rounded-lg border border-amber-300/30 px-3 text-sm font-black text-amber-100 hover:bg-amber-950/40">Move Last to Command</button>
                          <button type="button" onClick={() => onGameAction('discard_card', { amount: trackerAmount, note: gameNote })} className="min-h-[42px] rounded-lg bg-white/10 px-3 text-sm font-bold text-stone-100 hover:bg-white/15">Discard to GY</button>
                          <button type="button" onClick={() => onGameAction('exile_from_hand', { amount: trackerAmount, note: gameNote })} className="min-h-[42px] rounded-lg bg-white/10 px-3 text-sm font-bold text-stone-100 hover:bg-white/15">Exile from Hand</button>
                          <button type="button" onClick={() => onGameAction('return_to_hand', { amount: trackerAmount, note: gameNote, zone: trackerSourceZone })} className="min-h-[42px] rounded-lg bg-white/10 px-3 text-sm font-bold text-stone-100 hover:bg-white/15">Return to Hand</button>
                          <button type="button" onClick={() => onGameAction('return_to_battlefield', { amount: trackerAmount, note: gameNote, zone: trackerSourceZone })} className="min-h-[42px] rounded-lg bg-white/10 px-3 text-sm font-bold text-stone-100 hover:bg-white/15">Return to Board</button>
                          <button type="button" onClick={() => onGameAction('pass_turn')} className="min-h-[42px] rounded-lg bg-amber-300 px-3 text-sm font-black text-stone-950 hover:bg-amber-200">Pass Turn</button>
                          <button type="button" onClick={onAdvancePhase} className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg bg-amber-300/20 px-3 text-sm font-black text-amber-100 hover:bg-amber-300/30"><FastForward className="h-4 w-4" />Next Phase</button>
                          <button type="button" onClick={() => onGameAction('lose_life', { amount: trackerAmount, target_seat: Number(trackerTargetSeat) })} className="min-h-[42px] rounded-lg bg-white/10 px-3 text-sm font-bold text-stone-100 hover:bg-white/15">Lose Life</button>
                          <button type="button" onClick={() => onGameAction('gain_life', { amount: trackerAmount, target_seat: Number(trackerTargetSeat) })} className="min-h-[42px] rounded-lg bg-white/10 px-3 text-sm font-bold text-stone-100 hover:bg-white/15">Gain Life</button>
                          <button type="button" onClick={() => onGameAction('commander_damage', { amount: trackerAmount, target_seat: Number(trackerTargetSeat) })} className="min-h-[42px] rounded-lg bg-red-300/20 px-3 text-sm font-black text-red-100 hover:bg-red-300/30">Commander Damage</button>
                          <button type="button" onClick={() => onGameAction('poison', { amount: trackerAmount, target_seat: Number(trackerTargetSeat) })} className="min-h-[42px] rounded-lg bg-lime-300/20 px-3 text-sm font-black text-lime-100 hover:bg-lime-300/30">Poison</button>
                          <button type="button" onClick={() => onGameAction('adjust_counter', { amount: trackerAmount, target_seat: Number(trackerTargetSeat), counter_type: trackerCounterType })} className="min-h-[42px] rounded-lg bg-violet-300/20 px-3 text-sm font-black text-violet-100 hover:bg-violet-300/30">Add Counter</button>
                          <button type="button" onClick={() => onGameAction('commander_tax', { amount: 2 })} className="min-h-[42px] rounded-lg bg-white/10 px-3 text-sm font-bold text-stone-100 hover:bg-white/15">Tax +2</button>
                          <button type="button" onClick={() => onGameAction('set_monarch', { target_seat: Number(trackerTargetSeat) })} className="min-h-[42px] rounded-lg bg-amber-300/20 px-3 text-sm font-black text-amber-100 hover:bg-amber-300/30">Set Monarch</button>
                          <button type="button" onClick={() => onGameAction('set_initiative', { target_seat: Number(trackerTargetSeat) })} className="min-h-[42px] rounded-lg bg-sky-300/20 px-3 text-sm font-black text-sky-100 hover:bg-sky-300/30">Set Initiative</button>
                          <select
                            aria-label="Phase"
                            value={selectedPhase}
                            onChange={(event) => {
                              const phase = event.target.value as GamePhase;
                              setSelectedPhase(phase);
                              onGameAction('set_phase', { phase });
                            }}
                            className="min-h-[42px] rounded-lg border border-white/10 bg-stone-900 px-3 text-sm font-bold text-stone-100 outline-none"
                          >
                            <option value="beginning">Beginning</option>
                            <option value="main">Main</option>
                            <option value="combat">Combat</option>
                            <option value="ending">Ending</option>
                          </select>
                          <button type="button" onClick={() => onGameAction('concede')} className="min-h-[42px] rounded-lg border border-red-300/30 px-3 text-sm font-black text-red-100 hover:bg-red-950/50">Concede</button>
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto_auto]">
                          <input
                            value={gameNote}
                            onChange={(event) => setGameNote(event.target.value)}
                            className="min-h-[42px] rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none focus:border-amber-300"
                            placeholder="Optional note, spell name, or shortcut"
                            maxLength={160}
                          />
                          <button
                            type="button"
                            onClick={() => onGameAction('note', { note: gameNote })}
                            disabled={!gameNote.trim()}
                            className="min-h-[42px] rounded-lg bg-white px-4 text-sm font-black text-stone-950 hover:bg-stone-200 disabled:opacity-50"
                          >
                            Log Note
                          </button>
                          <button
                            type="button"
                            onClick={() => onGameAction('player_note', { note: gameNote })}
                            disabled={!gameNote.trim()}
                            className="min-h-[42px] rounded-lg border border-sky-300/30 px-4 text-sm font-black text-sky-100 hover:bg-sky-300/10 disabled:opacity-50"
                          >
                            Player Note
                          </button>
                          <button
                            type="button"
                            onClick={addPrivateNote}
                            disabled={!gameNote.trim()}
                            className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg border border-violet-300/30 px-4 text-sm font-black text-violet-100 hover:bg-violet-300/10 disabled:opacity-50"
                          >
                            <StickyNote className="h-4 w-4" />
                            Private Note
                          </button>
                        </div>
                        {privateNotes.length > 0 && (
                          <div className="mt-3 rounded-lg border border-violet-300/20 bg-violet-300/10 p-3 text-xs text-violet-50">
                            <div className="mb-2 flex items-center gap-2 font-black uppercase tracking-wider text-violet-200">
                              <StickyNote className="h-4 w-4" />
                              Private Notes
                            </div>
                            <div className="grid gap-1">
                              {privateNotes.map((note, index) => (
                                <div key={`${note}-${index}`} className="rounded bg-stone-950/60 px-3 py-2">{note}</div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="rounded-lg border border-white/10 bg-stone-950 p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-xs font-black uppercase tracking-[0.16em] text-stone-500">Game Log</div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-stone-600">{room.game.log.length} entries</div>
                      </div>
                      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                        {room.game.log.map((entry) => (
                          <div
                            key={entry.id}
                            className={`rounded px-3 py-2 text-sm ${
                              entry.player_name === 'System' ? 'bg-amber-300/10 text-amber-100' : 'bg-white/5 text-stone-200'
                            }`}
                          >
                            <div className="mb-1 grid grid-cols-[7rem_1fr_auto] items-center gap-2 text-[10px] font-black uppercase tracking-wider text-stone-500">
                              <span className="truncate">{entry.player_name}</span>
                              <span className="h-px bg-white/10" />
                              <span>{formatTime(entry.created_at)}</span>
                            </div>
                            <div className="leading-5">{entry.message}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {room.status === 'in_game' && room.real_game && (
                  <div className="mt-4 space-y-4 rounded-lg border border-sky-300/20 bg-sky-300/10 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-200">Experimental Real Engine</div>
                        <div className="mt-1 text-2xl font-black text-stone-50">
                          {scopedView ? `Turn ${scopedView.turnNumber} - ${scopedView.phase} / ${scopedView.step}` : 'Waiting for authority snapshot'}
                        </div>
                        <div className="text-sm font-semibold text-sky-100">
                          Authority: {room.real_game.authority_player_name}
                          {room.real_game.pending_action_count > 0 ? ` - ${room.real_game.pending_action_count} pending` : ''}
                        </div>
                        {scopedView && (
                          <div className="mt-2 flex flex-wrap gap-2 text-xs font-black uppercase tracking-wider text-sky-100">
                            <span className="rounded bg-sky-300/10 px-2 py-1">Active: {engineActivePlayer?.name || 'Unknown'}</span>
                            <span className="rounded bg-amber-300/10 px-2 py-1 text-amber-100">Priority: {enginePriorityPlayer?.name || 'Unknown'}</span>
                            <span className="rounded bg-white/10 px-2 py-1">Stack: {scopedView.stackSize}</span>
                            <span className="rounded bg-white/10 px-2 py-1">Scoped hidden views</span>
                            {activeSpectator && <span className="rounded bg-emerald-300/10 px-2 py-1 text-emerald-100">Spectator Mode</span>}
                          </div>
                        )}
                        {activeSpectator && (
                          <div className="mt-2 rounded border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs font-bold text-emerald-50">
                            Spectator Mode: hidden hands and libraries are redacted. Priority, stack, public zones, and logs remain visible.
                          </div>
                        )}
                        {(engineNotice || !scopedView) && (
                          <div className="mt-2 text-xs font-bold text-sky-100">
                            {engineNotice || 'Experimental engine is starting. This may fail on unsupported cards.'}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          refreshRoom(room.id).catch((err) => setError(err.message));
                          if (activeSession) {
                            getRealGameView(room.id, activeSession.playerId)
                              .then(setRealGameView)
                              .catch((err) => setError(err.message));
                          } else if (activeSpectator) {
                            getRealGameSpectatorView(room.id, activeSpectator.spectatorId)
                              .then(setSpectatorRealGameView)
                              .catch((err) => setError(err.message));
                          }
                        }}
                        className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-sky-300/20 px-3 text-sm font-bold text-sky-100 transition hover:bg-sky-300/10"
                      >
                        <RefreshCw className="h-4 w-4" />
                        Sync
                      </button>
                    </div>

                    {scopedView && (
                      <div className="rounded-lg border border-cyan-200/20 bg-stone-950 p-3">
                        <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100">Complex Turn Lens</div>
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-wider text-stone-300">
                              <span className="rounded bg-white/8 px-2 py-1">Stack {scopedView.complexity?.stackCount ?? scopedView.stackSize}</span>
                              <span className="rounded bg-white/8 px-2 py-1">Triggers {scopedView.complexity?.pendingTriggerCount ?? scopedView.pendingTriggerGroups?.length ?? 0}</span>
                              <span className="rounded bg-white/8 px-2 py-1">Board {scopedView.complexity?.battlefieldCardCount ?? 0}</span>
                              <span className="rounded bg-white/8 px-2 py-1">Layers {scopedView.complexity?.continuousEffectCount ?? 0}</span>
                              {largeEngineBoard && <span className="rounded bg-amber-300/15 px-2 py-1 text-amber-100">Large board mode</span>}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setTeachingEnabled((value) => !value)}
                            className="inline-flex min-h-[38px] items-center justify-center rounded-lg border border-cyan-100/20 px-3 text-xs font-black uppercase tracking-wider text-cyan-50 transition hover:bg-cyan-300/10"
                            aria-pressed={teachingEnabled}
                          >
                            Teaching {teachingEnabled ? 'On' : 'Off'}
                          </button>
                        </div>

                        {teachingEnabled && (scopedView.teachingNotes || []).length > 0 && (
                          <div className="mb-3 grid gap-2 md:grid-cols-2">
                            {(scopedView.teachingNotes || []).slice(0, 4).map((note) => (
                              <div key={note} className="rounded border border-cyan-100/10 bg-cyan-300/10 px-3 py-2 text-xs font-semibold leading-5 text-cyan-50">
                                {note}
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
                          <div className="space-y-3">
                            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                              <div className="mb-2 flex items-center justify-between gap-3">
                                <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-100">Trigger Stack</div>
                                <div className="text-[10px] font-black uppercase tracking-wider text-stone-500">Top resolves first</div>
                              </div>
                              <div className="grid max-h-72 gap-2 overflow-y-auto pr-1">
                                {(scopedView.stack || []).length === 0 ? (
                                  <div className="rounded border border-dashed border-white/10 px-3 py-4 text-center text-sm font-semibold text-stone-500">
                                    Stack is empty.
                                  </div>
                                ) : (scopedView.stack || []).map((item) => (
                                  <div
                                    key={item.id}
                                    className={`rounded-lg border px-3 py-2 ${
                                      item.resolvesNext
                                        ? 'border-amber-300/50 bg-amber-300/10'
                                        : 'border-white/10 bg-stone-900/70'
                                    }`}
                                  >
                                    <div className="flex flex-wrap items-center gap-2">
                                      {item.resolvesNext && (
                                        <span className="rounded bg-amber-300 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-stone-950">
                                          Resolves Next
                                        </span>
                                      )}
                                      <span className="rounded bg-white/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-stone-200">
                                        #{item.order} {item.kind}
                                      </span>
                                      <span className="text-sm font-black text-stone-50">{item.label}</span>
                                    </div>
                                    <div className="mt-2 grid gap-1 text-xs font-semibold leading-5 text-stone-300">
                                      <div>Controller: {item.controllerName}</div>
                                      {item.targetNames.length > 0 && <div>Targets: {item.targetNames.join(', ')}</div>}
                                      <div><span className="font-black text-cyan-100">Why did this trigger?</span> {item.why}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                              <div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-violet-100">Pending Triggers</div>
                              <div className="grid gap-2">
                                {(scopedView.pendingTriggerGroups || []).length === 0 ? (
                                  <div className="rounded border border-dashed border-white/10 px-3 py-4 text-center text-sm font-semibold text-stone-500">
                                    No grouped triggers waiting.
                                  </div>
                                ) : (scopedView.pendingTriggerGroups || []).map((group) => (
                                  <div key={group.key} className="rounded-lg border border-violet-200/20 bg-violet-300/10 px-3 py-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="rounded bg-violet-200 px-2 py-1 text-[10px] font-black uppercase text-stone-950">
                                        x{group.count}
                                      </span>
                                      <span className="text-sm font-black text-violet-50">{group.sourceName}</span>
                                      <span className="text-xs font-bold text-violet-100">{group.triggerKind}</span>
                                    </div>
                                    <div className="mt-1 text-xs font-semibold leading-5 text-violet-50">
                                      {group.controllerName}: {group.why}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                              <div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-red-100">Combat Assignment</div>
                              <div className="grid max-h-72 gap-2 overflow-y-auto pr-1">
                                {!scopedView.combat || scopedView.combat.assignments.length === 0 ? (
                                  <div className="rounded border border-dashed border-white/10 px-3 py-4 text-center text-sm font-semibold text-stone-500">
                                    No combat assignment yet.
                                  </div>
                                ) : scopedView.combat.assignments.map((assignment) => (
                                  <div key={`${assignment.attacker.id}-${assignment.defenderName}`} className="rounded-lg border border-red-200/20 bg-red-300/10 px-3 py-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="rounded bg-red-200 px-2 py-1 text-[10px] font-black uppercase text-stone-950">
                                        {assignment.unblocked ? 'Unblocked' : 'Blocked'}
                                      </span>
                                      <span className="text-sm font-black text-red-50">
                                        {assignment.attacker.name} {assignment.attacker.power}/{assignment.attacker.toughness}
                                      </span>
                                    </div>
                                    <div className="mt-1 text-xs font-bold text-red-100">
                                      Attacking {assignment.defenderName}
                                      {assignment.attacker.keywords.length > 0 ? ` - ${compactKeywords(assignment.attacker.keywords)}` : ''}
                                    </div>
                                    {assignment.blockers.length > 0 && (
                                      <div className="mt-2 flex flex-wrap gap-1">
                                        {assignment.blockers.map((blocker) => (
                                          <span key={blocker.id} className="rounded bg-white/10 px-2 py-1 text-[11px] font-bold text-stone-100">
                                            {blocker.name} {blocker.power}/{blocker.toughness}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    <div className="mt-2 rounded bg-stone-950/70 px-3 py-2 text-xs font-semibold leading-5 text-red-50">
                                      <span className="font-black">Damage Assignment Preview:</span> {assignment.assignmentHint}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                              <div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-emerald-100">What Are My Options?</div>
                              <div className="grid gap-2">
                                {(scopedView.legalActions || []).map((action) => (
                                  <div
                                    key={action.action}
                                    className={`rounded-lg border px-3 py-2 ${
                                      action.enabled
                                        ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-50'
                                        : 'border-white/10 bg-stone-900/60 text-stone-400'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="text-sm font-black">{action.action}</span>
                                      <span className="text-[10px] font-black uppercase tracking-wider">
                                        {action.enabled ? 'Available' : 'Blocked'}
                                      </span>
                                    </div>
                                    <div className="mt-1 text-xs font-semibold leading-5">{action.reason}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {scopedView && (
                      <div className="grid gap-3 md:grid-cols-2">
                        {scopedView.players.map((player) => (
                          <div
                            key={player.id}
                            className={`rounded-lg border p-4 ${
                              player.hasPriority
                                ? 'border-amber-300/60 bg-amber-300/10'
                                : player.isActive
                                  ? 'border-sky-300/50 bg-sky-300/10'
                                  : 'border-white/10 bg-stone-950'
                            }`}
                          >
                            <div className="mb-3 flex items-start justify-between gap-3">
                              <div>
                                <div className="font-black text-stone-50">{player.name}</div>
                                <div className="text-xs font-semibold text-stone-400">
                                  {player.zones.command.cards?.map((card) => card.name).join(' / ') || 'Commander hidden'}
                                </div>
                              </div>
                              <div className="rounded bg-white/10 px-2 py-1 text-[10px] font-black uppercase text-stone-200">
                                {player.hasPriority ? 'Priority' : player.isActive ? 'Active' : 'Waiting'}
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div className="rounded bg-white/5 px-3 py-2">
                                <div className="text-[10px] font-black uppercase tracking-wider text-stone-500">Life</div>
                                <div className="text-2xl font-black text-stone-50">{player.life}</div>
                              </div>
                              <div className="rounded bg-white/5 px-3 py-2">
                                <div className="text-[10px] font-black uppercase tracking-wider text-stone-500">Hand</div>
                                <div className="text-2xl font-black text-stone-50">{player.zones.hand.count}</div>
                              </div>
                              <div className="rounded bg-white/5 px-3 py-2">
                                <div className="text-[10px] font-black uppercase tracking-wider text-stone-500">Board</div>
                                <div className="text-2xl font-black text-stone-50">{player.zones.battlefield.count}</div>
                              </div>
                              <div className="rounded bg-white/5 px-3 py-2">
                                <div className="text-[10px] font-black uppercase tracking-wider text-stone-500">GY / Lib</div>
                                <div className="text-2xl font-black text-stone-50">{player.zones.graveyard.count} / {player.zones.library.count}</div>
                              </div>
                            </div>
                            {player.id === activeSession?.playerId && player.manaPool && (
                              <div className="mt-3 flex flex-wrap gap-1 text-xs">
                                {(['W', 'U', 'B', 'R', 'G', 'C'] as const).map((color) => (
                                  <span key={color} className="rounded bg-white/10 px-2 py-1 font-black text-stone-100">
                                    {color}: {player.manaPool?.[color] || 0}
                                  </span>
                                ))}
                              </div>
                            )}
                            {player.id === activeSession?.playerId && player.zones.hand.cards && (
                              <div className="mt-3 rounded border border-white/10 bg-white/5 p-2 text-xs text-stone-300">
                                {player.zones.hand.cards.slice(0, 8).map((card) => card.name).join(', ')}
                              </div>
                            )}
                            {player.zones.battlefield.cards && player.zones.battlefield.cards.length > 0 && (
                              <div className="mt-3 rounded-lg border border-white/10 bg-stone-900/80 p-2">
                                <div className="mb-2 flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-wider text-stone-500">
                                  <span>Battlefield</span>
                                  <span>{player.zones.battlefield.count}</span>
                                </div>
                                <div className={`grid gap-1 overflow-y-auto pr-1 ${largeEngineBoard ? 'max-h-28' : 'max-h-44'}`}>
                                  {player.zones.battlefield.cards.slice(0, largeEngineBoard ? 12 : 24).map((card) => (
                                    <div
                                      key={card.instanceId}
                                      className={`rounded border px-2 py-1 text-xs ${
                                        card.tapped
                                          ? 'border-amber-300/20 bg-amber-300/10 text-amber-50'
                                          : 'border-white/10 bg-white/5 text-stone-200'
                                      }`}
                                    >
                                      <div className="flex min-w-0 items-center justify-between gap-2">
                                        <span className="truncate font-bold">{card.name}</span>
                                        <span className="shrink-0 font-black text-stone-400">
                                          {cardPowerToughness(card) || (card.tapped ? 'Tapped' : '')}
                                        </span>
                                      </div>
                                      {(card.keywords?.length || compactCardCounters(card)) && (
                                        <div className="mt-1 truncate text-[10px] font-semibold text-stone-500">
                                          {[compactKeywords(card.keywords || [], 3), compactCardCounters(card)].filter(Boolean).join(' - ')}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                  {player.zones.battlefield.count > (largeEngineBoard ? 12 : 24) && (
                                    <div className="rounded border border-dashed border-white/10 px-2 py-1 text-center text-[11px] font-bold text-stone-500">
                                      {player.zones.battlefield.count - (largeEngineBoard ? 12 : 24)} more public permanents
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {activeSession && scopedView && (
                      <div className="rounded-lg border border-white/10 bg-stone-950 p-3">
                        <div className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-amber-200">Real Actions</div>
                        <div className="mb-3 grid gap-2 sm:grid-cols-3">
                          <label className="text-xs font-bold text-stone-400">
                            Mana Color
                            <select
                              aria-label="Mana Color"
                              value={realManaColor}
                              onChange={(event) => setRealManaColor(event.target.value as typeof realManaColor)}
                              className="mt-1 min-h-[40px] w-full rounded-lg border border-white/10 bg-stone-900 px-3 text-sm font-bold text-stone-100 outline-none"
                            >
                              {(['W', 'U', 'B', 'R', 'G', 'C'] as const).map((color) => (
                                <option key={color} value={color}>{color}</option>
                              ))}
                            </select>
                          </label>
                          <label className="text-xs font-bold text-stone-400 sm:col-span-2">
                            Spell
                            <select
                              aria-label="Selected spell"
                              value={selectedSpellInHand?.instanceId || ''}
                              onChange={(event) => {
                                setSelectedSpellCardId(event.target.value);
                                setSelectedSpellTargetId('');
                              }}
                              className="mt-1 min-h-[40px] w-full rounded-lg border border-white/10 bg-stone-900 px-3 text-sm font-bold text-stone-100 outline-none"
                            >
                              {spellsInHand.length === 0 && <option value="">No spell in hand</option>}
                              {spellsInHand.map((card) => (
                                <option key={card.instanceId} value={card.instanceId}>
                                  {card.name}{card.manaCost ? ` ${card.manaCost}` : ''}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        {selectedSpellTargetCount > 0 && (
                          <div className="mb-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                            <label className="text-xs font-bold text-stone-400">
                              Target
                              <select
                                aria-label="Selected spell target"
                                value={selectedSpellTarget?.id || ''}
                                onChange={(event) => setSelectedSpellTargetId(event.target.value)}
                                className="mt-1 min-h-[40px] w-full rounded-lg border border-white/10 bg-stone-900 px-3 text-sm font-bold text-stone-100 outline-none"
                              >
                                {selectedSpellTargetOptions.length === 0 && <option value="">No legal visible target</option>}
                                {selectedSpellTargetOptions.map((target) => (
                                  <option key={target.id} value={target.id}>{target.label}</option>
                                ))}
                              </select>
                            </label>
                          </div>
                        )}
                        {(canDeclareAttackers || canDeclareBlockers) && (
                          <div className="mb-3 grid gap-3 lg:grid-cols-2">
                            {canDeclareAttackers && (
                              <div className="rounded-lg border border-red-300/20 bg-red-300/10 p-3">
                                <div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-red-100">Declare Attackers</div>
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <label className="text-xs font-bold text-red-50">
                                    Attacker
                                    <select
                                      aria-label="Selected attacker"
                                      value={selectedAttackCardId}
                                      onChange={(event) => setSelectedAttackCardId(event.target.value)}
                                      className="mt-1 min-h-[40px] w-full rounded-lg border border-white/10 bg-stone-900 px-3 text-sm font-bold text-stone-100 outline-none"
                                    >
                                      {availableAttackers.map((card) => (
                                        <option key={card.instanceId} value={card.instanceId}>
                                          {card.name}{cardPowerToughness(card) ? ` ${cardPowerToughness(card)}` : ''}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="text-xs font-bold text-red-50">
                                    Defender
                                    <select
                                      aria-label="Selected defender"
                                      value={selectedDefenderPlayerId}
                                      onChange={(event) => setSelectedDefenderPlayerId(event.target.value)}
                                      className="mt-1 min-h-[40px] w-full rounded-lg border border-white/10 bg-stone-900 px-3 text-sm font-bold text-stone-100 outline-none"
                                    >
                                      {defenderOptions.map((player) => (
                                        <option key={player.id} value={player.id}>{player.name}</option>
                                      ))}
                                    </select>
                                  </label>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => selectedAttacker && selectedDefender && onSubmitRealAction({
                                    kind: 'declare_attackers',
                                    payload: { attackers: [{ cardInstanceId: selectedAttacker.instanceId, defendingPlayerId: selectedDefender.id }] },
                                  })}
                                  disabled={loading || !selectedAttacker || !selectedDefender}
                                  className="mt-3 min-h-[42px] w-full rounded-lg bg-red-300 px-3 text-sm font-black text-stone-950 hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  Declare Selected Attacker
                                </button>
                              </div>
                            )}

                            {canDeclareBlockers && (
                              <div className="rounded-lg border border-indigo-300/20 bg-indigo-300/10 p-3">
                                <div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-indigo-100">Declare Blockers</div>
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <label className="text-xs font-bold text-indigo-50">
                                    Blocker
                                    <select
                                      aria-label="Selected blocker"
                                      value={selectedBlockerCardId}
                                      onChange={(event) => setSelectedBlockerCardId(event.target.value)}
                                      className="mt-1 min-h-[40px] w-full rounded-lg border border-white/10 bg-stone-900 px-3 text-sm font-bold text-stone-100 outline-none"
                                    >
                                      {availableBlockers.map((card) => (
                                        <option key={card.instanceId} value={card.instanceId}>
                                          {card.name}{cardPowerToughness(card) ? ` ${cardPowerToughness(card)}` : ''}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="text-xs font-bold text-indigo-50">
                                    Incoming attacker
                                    <select
                                      aria-label="Selected incoming attacker"
                                      value={selectedBlockedAttackerId}
                                      onChange={(event) => setSelectedBlockedAttackerId(event.target.value)}
                                      className="mt-1 min-h-[40px] w-full rounded-lg border border-white/10 bg-stone-900 px-3 text-sm font-bold text-stone-100 outline-none"
                                    >
                                      {incomingAttackers.map((attacker) => (
                                        <option key={attacker.id} value={attacker.id}>
                                          {attacker.name} {attacker.power}/{attacker.toughness}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => selectedBlocker && selectedBlockedAttacker && onSubmitRealAction({
                                    kind: 'declare_blockers',
                                    payload: { blockers: [{ cardInstanceId: selectedBlocker.instanceId, blockingAttackerId: selectedBlockedAttacker.id }] },
                                  })}
                                  disabled={loading || !selectedBlocker || !selectedBlockedAttacker}
                                  className="mt-3 min-h-[42px] w-full rounded-lg bg-indigo-300 px-3 text-sm font-black text-stone-950 hover:bg-indigo-200 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  Declare Selected Blocker
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          <button
                            type="button"
                            onClick={() => onSubmitRealAction({ kind: 'pass_priority' })}
                            disabled={loading || !canPassPriority}
                            className="min-h-[42px] rounded-lg bg-amber-300 px-3 text-sm font-black text-stone-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Pass Priority
                          </button>
                          <button
                            type="button"
                            onClick={() => firstLandInHand && onSubmitRealAction({ kind: 'play_land', payload: { card_instance_id: firstLandInHand.instanceId } })}
                            disabled={loading || !canPlayFirstLand}
                            className="min-h-[42px] rounded-lg bg-emerald-300 px-3 text-sm font-black text-stone-950 hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Play First Land
                          </button>
                          <button
                            type="button"
                            onClick={() => firstManaSource && onSubmitRealAction({ kind: 'tap_mana', payload: { card_instance_id: firstManaSource.instanceId, color: realManaColor } })}
                            disabled={loading || scopedView.priorityPlayerId !== activeSession.playerId || !firstManaSource}
                            className="min-h-[42px] rounded-lg bg-sky-300 px-3 text-sm font-black text-stone-950 hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Tap First Mana Source
                          </button>
                          <button
                            type="button"
                            onClick={() => selectedSpellInHand && onSubmitRealAction({ kind: 'cast_spell', payload: { card_instance_id: selectedSpellInHand.instanceId, targets: selectedSpellTargets } })}
                            disabled={loading || !canCastSelectedSpell}
                            className="min-h-[42px] rounded-lg bg-violet-300 px-3 text-sm font-black text-stone-950 hover:bg-violet-200 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Cast Selected Spell
                          </button>
                          <button
                            type="button"
                            onClick={() => firstCommandSpell && onSubmitRealAction({ kind: 'cast_spell', payload: { card_instance_id: firstCommandSpell.instanceId, targets: [] } })}
                            disabled={loading || scopedView.priorityPlayerId !== activeSession.playerId || !firstCommandSpell}
                            className="min-h-[42px] rounded-lg bg-white/10 px-3 text-sm font-black text-stone-100 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Cast Commander
                          </button>
                          <button
                            type="button"
                            onClick={() => onSubmitRealAction({ kind: 'declare_attackers', payload: { attackers: [] } })}
                            disabled={loading || !canDeclareAttackers}
                            className="min-h-[42px] rounded-lg bg-white/10 px-3 text-sm font-black text-stone-100 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            No Attacks
                          </button>
                          <button
                            type="button"
                            onClick={() => firstAttacker && firstOpponent && onSubmitRealAction({
                              kind: 'declare_attackers',
                              payload: { attackers: [{ cardInstanceId: firstAttacker.instanceId, defendingPlayerId: firstOpponent.id }] },
                            })}
                            disabled={loading || !canDeclareAttackers || !firstAttacker || !firstOpponent}
                            className="min-h-[42px] rounded-lg bg-red-300 px-3 text-sm font-black text-stone-950 hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Attack First Creature
                          </button>
                          <button
                            type="button"
                            onClick={() => onSubmitRealAction({ kind: 'declare_blockers', payload: { blockers: [] } })}
                            disabled={loading || !canDeclareBlockers}
                            className="min-h-[42px] rounded-lg bg-white/10 px-3 text-sm font-black text-stone-100 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            No Blocks
                          </button>
                        </div>
                        {engineActionHelp.length > 0 && (
                          <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/10 p-3">
                            <div className="mb-1 text-xs font-black uppercase tracking-[0.16em] text-amber-100">Why Can't I?</div>
                            <div className="grid gap-1 text-xs font-bold text-amber-50">
                              {engineActionHelp.map((item) => (
                                <div key={item}>{item}</div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="rounded-lg border border-white/10 bg-stone-950 p-3">
                      <div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-stone-500">Engine Log</div>
                      <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
                        {(effectiveRealGameView?.log || room.real_game.log).map((entry) => (
                          <div key={entry.id} className="rounded bg-white/5 px-3 py-2 text-sm text-stone-200">
                            <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-wider text-stone-500">
                              <span>{entry.player_name}</span>
                              <span>{formatTime(entry.created_at)}</span>
                            </div>
                            {entry.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
                <div className="mb-4 flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-sky-200" />
                  <h2 className="font-serif text-2xl font-bold">Room Chat</h2>
                  <span className="rounded bg-white/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-stone-400">
                    Secondary
                  </span>
                </div>
                <div className="mb-3 flex h-[360px] flex-col gap-2 overflow-y-auto rounded-lg border border-white/10 bg-stone-950 p-3">
                  {room.chat.length === 0 && (
                    <div className="m-auto text-center text-sm text-stone-500">Room messages appear here.</div>
                  )}
                  {room.chat.map((message: ChatMessage) => (
                    <div
                      key={message.id}
                      className={`rounded-lg px-3 py-2 text-sm ${
                        message.system ? 'bg-amber-300/10 text-amber-100' : 'bg-white/8 text-stone-100'
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-wider text-stone-500">
                        <span>{message.player_name}</span>
                        <span>{formatTime(message.created_at)}</span>
                      </div>
                      <div className="leading-6">{message.message}</div>
                    </div>
                  ))}
                </div>
                {activeSession ? (
                  <form className="space-y-2" onSubmit={onSendChat}>
                    <textarea
                      value={chatText}
                      onChange={(event) => setChatText(event.target.value)}
                      className="min-h-[96px] w-full resize-none rounded-lg border border-white/10 bg-stone-950 px-3 py-3 text-sm text-white outline-none transition focus:border-sky-300"
                      placeholder="Message the room. Links and unsafe content are blocked."
                      maxLength={500}
                    />
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={loading || !chatText.trim()}
                        className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-sky-200 px-4 text-sm font-black text-stone-950 transition hover:bg-sky-100 disabled:opacity-60"
                      >
                        Send
                      </button>
                      <button
                        type="button"
                        onClick={onLeaveRoom}
                        className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-red-300/30 px-4 text-sm font-black text-red-100 transition hover:bg-red-950/50"
                      >
                        Leave
                      </button>
                    </div>
                  </form>
                ) : activeSpectator ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm font-semibold text-emerald-50">
                      Spectator chat is read-only in this beta. Hands and libraries stay hidden.
                    </div>
                    <button
                      type="button"
                      onClick={onLeaveRoom}
                      className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-white/10 px-4 text-sm font-black text-stone-100 transition hover:bg-white/10"
                    >
                      Leave Spectator Mode
                    </button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-white/15 p-4 text-center text-sm text-stone-500">
                    Join the room to chat and ready your seat.
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
