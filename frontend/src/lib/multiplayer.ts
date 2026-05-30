import { reportClientEvent } from './diagnostics';

export type RoomStatus = 'waiting' | 'in_game' | 'closed';
export type RoomTier = 'free' | 'tournament';
export type RoomNamespace = 'public' | 'qa';

export interface SeatInfo {
  seat: number;
  name?: string | null;
  ready: boolean;
  deck_name?: string | null;
  commander?: string | null;
  deck_locked: boolean;
  deck_card_count: number;
  is_host: boolean;
  disconnected: boolean;
}

export interface ChatMessage {
  id: string;
  player_name: string;
  message: string;
  system: boolean;
  created_at: string;
}

export type GameStatus = 'playing' | 'finished';
export type GamePhase = 'beginning' | 'main' | 'combat' | 'ending';
export type GameAction =
  | 'draw_card'
  | 'play_permanent'
  | 'remove_permanent'
  | 'gain_life'
  | 'lose_life'
  | 'set_phase'
  | 'pass_turn'
  | 'concede'
  | 'note'
  | 'player_note'
  | 'commander_damage'
  | 'commander_tax'
  | 'poison'
  | 'adjust_counter'
  | 'set_monarch'
  | 'clear_monarch'
  | 'set_initiative'
  | 'clear_initiative'
  | 'create_token'
  | 'add_board_object'
  | 'add_object_counter'
  | 'tap_object'
  | 'move_to_graveyard'
  | 'move_to_exile'
  | 'move_to_command'
  | 'discard_card'
  | 'exile_from_hand'
  | 'return_to_hand'
  | 'return_to_battlefield'
  | 'undo';

export type PublicZone = 'graveyard' | 'exile' | 'command';

export interface GameBoardObject {
  id: string;
  name: string;
  kind: string;
  count: number;
  counters: Record<string, number>;
  tapped: boolean;
}

export interface GamePlayerState {
  seat: number;
  name: string;
  deck_name?: string | null;
  commander?: string | null;
  life: number;
  hand_count: number;
  library_count: number;
  battlefield_count: number;
  graveyard_count: number;
  exile_count: number;
  command_zone_count: number;
  commander_tax: number;
  poison_count: number;
  commander_damage: Record<string, number>;
  custom_counters: Record<string, number>;
  battlefield_objects: GameBoardObject[];
  notes: string[];
  conceded: boolean;
  is_active: boolean;
}

export interface GameLogEntry {
  id: string;
  player_name: string;
  message: string;
  created_at: string;
}

export interface SharedGameState {
  status: GameStatus;
  turn_number: number;
  active_player_name: string;
  phase: GamePhase;
  players: GamePlayerState[];
  winner_name?: string | null;
  monarch_player_name?: string | null;
  initiative_player_name?: string | null;
  can_undo: boolean;
  log: GameLogEntry[];
  created_at: string;
  updated_at: string;
}

export interface LockedRoomDeck {
  commander: string;
  list: string[];
  colors?: string[];
}

export interface StartRealGamePlayer {
  id: string;
  name: string;
  seat: number;
  deck: LockedRoomDeck;
}

export interface StartRealGamePayload {
  roomId: string;
  players: StartRealGamePlayer[];
  firstPlayerId?: string | null;
  startingLife: number;
  authorityPlayerId: string;
}

export type RealGameAction =
  | { kind: 'pass_priority' }
  | { kind: 'play_land'; payload: { card_instance_id: string } }
  | { kind: 'tap_mana'; payload: { card_instance_id: string; color: 'W' | 'U' | 'B' | 'R' | 'G' | 'C' } }
  | { kind: 'cast_spell'; payload: { card_instance_id: string; targets?: string[]; face_name?: string; x_value?: number } }
  | { kind: 'declare_attackers'; payload: { attackers: Array<{ cardInstanceId: string; defendingPlayerId: string }> } }
  | { kind: 'declare_blockers'; payload: { blockers: Array<{ cardInstanceId: string; blockingAttackerId: string }> } }
  | { kind: 'adjust_counters'; payload: { card_instance_id: string; counter_type: string; delta: number } };

export interface PendingRealGameAction {
  id: string;
  player_id: string;
  player_name: string;
  action: RealGameAction;
  created_at: string;
}

export interface RealGameSummary {
  status: string;
  authority_player_id: string;
  authority_player_name: string;
  authority_last_seen_at?: string | null;
  revision: number;
  pending_action_count: number;
  players: Array<{
    id: string;
    name: string;
    seat: number;
    deck_locked: boolean;
    deck_card_count: number;
    commander?: string | null;
  }>;
  log: GameLogEntry[];
  created_at: string;
  updated_at: string;
}

export interface RealGameViewResponse {
  status: string;
  revision: number;
  authority_player_id: string;
  authority_player_name: string;
  authority_last_seen_at?: string | null;
  view?: unknown;
  pending_action_count: number;
  log: GameLogEntry[];
}

export interface EnginePreflightUnsupportedCard {
  name: string;
  reason: string;
}

export interface EnginePreflightSeat {
  seat: number;
  player_name: string;
  commander?: string | null;
  deck_locked: boolean;
  ready: boolean;
  unsupported_cards: EnginePreflightUnsupportedCard[];
  issues: string[];
}

export interface EnginePreflightResponse {
  ok: boolean;
  message: string;
  seats: EnginePreflightSeat[];
}

export interface RoomSettings {
  spectators_allowed: boolean;
  spectator_delay_seconds: number;
  scheduled_for?: string | null;
  table_note: string;
}

export interface RoomSummary {
  id: string;
  name: string;
  tags: string[];
  namespace: RoomNamespace;
  status: RoomStatus;
  tier: RoomTier;
  player_count: number;
  max_players: number;
  has_password: boolean;
  is_private: boolean;
  host_name: string;
  spectator_count: number;
  settings: RoomSettings;
  created_at: string;
  updated_at: string;
}

export interface RoomDetail extends RoomSummary {
  seats: SeatInfo[];
  chat: ChatMessage[];
  game?: SharedGameState | null;
  real_game?: RealGameSummary | null;
}

export interface ReplayEvent {
  id: string;
  index: number;
  turn_number: number;
  phase: GamePhase;
  active_player_name: string;
  player_name: string;
  message: string;
  created_at: string;
  state: {
    status: GameStatus;
    turn_number: number;
    phase: GamePhase;
    active_player_name: string;
    winner_name?: string | null;
    monarch_player_name?: string | null;
    initiative_player_name?: string | null;
    players: GamePlayerState[];
  };
}

export interface ReplayDecision {
  id: string;
  event_id: string;
  turn_number: number;
  phase: GamePhase;
  player_name: string;
  action_type: string;
  selected_line: string;
  rating: 'excellent' | 'good' | 'okay' | 'bad' | 'blunder';
  score_delta: number;
  confidence: 'high' | 'medium' | 'low';
  coaching_note: string;
  available_options: string[];
  better_line: string;
}

export interface ReplayPlayerInsight {
  player_name: string;
  category: string;
  message: string;
  evidence_event_ids: string[];
}

export interface ReplayAnnotation {
  id: string;
  event_id?: string | null;
  author_name: string;
  message: string;
  created_at: string;
}

export interface ReplayReport {
  schema_version: number;
  room_id: string;
  room_name: string;
  share_url_path: string;
  summary: {
    room_id: string;
    room_name: string;
    status: GameStatus;
    winner_name?: string | null;
    turn_number: number;
    event_count: number;
    decision_count: number;
    annotation_count: number;
    player_names: string[];
    commander_names: string[];
    grade: string;
    review_confidence: number;
    created_at: string;
    updated_at: string;
  };
  events: ReplayEvent[];
  decisions: ReplayDecision[];
  player_insights: ReplayPlayerInsight[];
  annotations: ReplayAnnotation[];
  review: {
    evaluator: string;
    grade: string;
    review_confidence: number;
    review_confidence_label: string;
    llm_assist_status: string;
    coaching_summary: string;
    search_terms: string[];
  };
}

export interface ReplaySummary {
  room_id: string;
  room_name: string;
  status: GameStatus;
  winner_name?: string | null;
  turn_number: number;
  event_count: number;
  annotation_count: number;
  player_names: string[];
  commander_names: string[];
  grade: string;
  review_confidence: number;
  created_at: string;
  updated_at: string;
}

export type EventFormat = 'swiss' | 'single_elim' | 'round_robin' | 'league' | 'draft' | 'sealed';
export type EventStatus = 'setup' | 'running' | 'complete';

export interface EventSettings {
  rounds: number;
  match_wins_required: number;
  round_minutes: number;
  max_players: number;
  allow_spectators: boolean;
  prize_note: string;
  recurring_rule: string;
}

export interface EventPlayer {
  id: string;
  name: string;
  deck_name?: string | null;
  dropped: boolean;
  registered_at: string;
}

export interface EventMatch {
  id: string;
  round: number;
  table: number;
  player1_id: string;
  player2_id?: string | null;
  player1_name: string;
  player2_name?: string | null;
  status: 'open' | 'reported' | string;
  is_bye: boolean;
  game_wins: Record<string, number>;
  game_draws: number;
  winner_id?: string | null;
  room_id?: string | null;
  replay_room_id?: string | null;
  highlight?: string | null;
}

export interface EventStanding {
  rank: number;
  player_id: string;
  player_name: string;
  match_wins: number;
  match_losses: number;
  match_draws: number;
  match_points: number;
  game_wins: number;
  game_losses: number;
  game_draws: number;
  omw: number;
  gwp: number;
  ogw: number;
}

export interface EventSummary {
  id: string;
  name: string;
  format: EventFormat;
  status: EventStatus;
  player_count: number;
  current_round: number;
  total_rounds: number;
  public: boolean;
  organizer_name: string;
  created_at: string;
  updated_at: string;
}

export interface EventAnnouncement {
  id: string;
  message: string;
  created_at: string;
  system?: boolean;
}

export interface DraftPod {
  id: string;
  name: string;
  player_ids: string[];
  player_names: string[];
  status: string;
  packs_per_player: number;
  seeding_note: string;
}

export interface SealedPool {
  player_id: string;
  player_name: string;
  pool_label: string;
  status: string;
}

export interface EventHighlight {
  id: string;
  match_id: string;
  round: number;
  table: number;
  message: string;
  replay_room_id?: string | null;
  created_at: string;
}

export interface EventDetail extends EventSummary {
  settings: EventSettings;
  players: EventPlayer[];
  matches: EventMatch[];
  standings: EventStanding[];
  announcements: EventAnnouncement[];
  draft_pods: DraftPod[];
  sealed_pools: SealedPool[];
  highlights: EventHighlight[];
}

export interface EventWithOrganizer {
  event: EventDetail;
  organizer_token: string;
}

export interface CreateEventInput {
  name: string;
  organizer_name: string;
  format: EventFormat;
  public: boolean;
  settings: Partial<EventSettings>;
}

export interface RoomWithPlayer {
  room: RoomDetail;
  player_id: string;
}

export interface RoomWithSpectator {
  room: RoomDetail;
  spectator_id: string;
}

export interface CreateRoomInput {
  name: string;
  host_name: string;
  tags: string[];
  password?: string;
  is_private: boolean;
  tier: RoomTier;
  namespace?: RoomNamespace;
}

export interface JoinRoomInput {
  player_name: string;
  password?: string;
}

export interface SpectateRoomInput {
  spectator_name: string;
  password?: string;
}

const API_BASE = '/api/multiplayer';
const QA_TOKEN_STORAGE_KEY = 'deckreps_qa_admin_token';

function qaVerificationHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = window.sessionStorage.getItem(QA_TOKEN_STORAGE_KEY);
  if (!token) return {};
  return {
    'x-qa-rate-limit-bypass': '1',
    'x-admin-token': token,
  };
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...qaVerificationHeaders(),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    let detail = `Request failed with ${response.status}`;
    try {
      const data = await response.json();
      detail = data.detail || detail;
    } catch {
      // Keep the generic detail.
    }
    const requestId = response.headers.get('x-request-id') || undefined;
    reportClientEvent({
      kind: 'api_error',
      severity: response.status >= 500 ? 'error' : 'warning',
      message: detail,
      request_id: requestId,
      details: {
        status: response.status,
        path,
      },
    });
    throw new Error(requestId ? `${detail} (request ${requestId})` : detail);
  }

  return response.json();
}

export function listRooms(tag?: string) {
  const params = new URLSearchParams();
  if (tag) params.set('tag', tag);
  return apiRequest<RoomSummary[]>(`/rooms${params.toString() ? `?${params}` : ''}`);
}

export function createRoom(input: CreateRoomInput) {
  return apiRequest<RoomWithPlayer>('/rooms', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getRoom(roomId: string) {
  return apiRequest<RoomDetail>(`/rooms/${encodeURIComponent(roomId)}`);
}

export function listPublicReplays(q = '') {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  return apiRequest<ReplaySummary[]>(`/replays${params.toString() ? `?${params}` : ''}`);
}

export function listEvents(input: { includePrivate?: boolean; status?: EventStatus } = {}) {
  const params = new URLSearchParams();
  if (input.includePrivate) params.set('include_private', 'true');
  if (input.status) params.set('status', input.status);
  return apiRequest<EventSummary[]>(`/events${params.toString() ? `?${params}` : ''}`);
}

export function createEvent(input: CreateEventInput) {
  return apiRequest<EventWithOrganizer>('/events', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getEvent(eventId: string) {
  return apiRequest<EventDetail>(`/events/${encodeURIComponent(eventId)}`);
}

export function registerEventPlayer(eventId: string, input: { player_name: string; deck_name?: string }) {
  return apiRequest<EventDetail>(`/events/${encodeURIComponent(eventId)}/players`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function startEvent(eventId: string, organizerToken: string) {
  return apiRequest<EventDetail>(`/events/${encodeURIComponent(eventId)}/start`, {
    method: 'POST',
    body: JSON.stringify({ organizer_token: organizerToken }),
  });
}

export function pairNextEventRound(eventId: string, organizerToken: string) {
  return apiRequest<EventDetail>(`/events/${encodeURIComponent(eventId)}/pair-next`, {
    method: 'POST',
    body: JSON.stringify({ organizer_token: organizerToken }),
  });
}

export function reportEventMatch(
  eventId: string,
  matchId: string,
  input: {
    organizer_token: string;
    player1_wins: number;
    player2_wins: number;
    game_draws?: number;
    replay_room_id?: string;
    highlight?: string;
  },
) {
  return apiRequest<EventDetail>(`/events/${encodeURIComponent(eventId)}/matches/${encodeURIComponent(matchId)}/result`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function postEventAnnouncement(eventId: string, organizerToken: string, message: string) {
  return apiRequest<EventDetail>(`/events/${encodeURIComponent(eventId)}/announcements`, {
    method: 'POST',
    body: JSON.stringify({ organizer_token: organizerToken, message }),
  });
}

export function createEventMatchRoom(eventId: string, matchId: string, organizerToken: string) {
  return apiRequest<{
    event: EventDetail;
    room: RoomDetail;
    room_id: string;
    host_player_id: string;
    guest_player_id: string;
  }>(`/events/${encodeURIComponent(eventId)}/matches/${encodeURIComponent(matchId)}/room`, {
    method: 'POST',
    body: JSON.stringify({ organizer_token: organizerToken }),
  });
}

export function getRoomReplay(roomId: string) {
  return apiRequest<ReplayReport>(`/rooms/${encodeURIComponent(roomId)}/replay`);
}

export function addReplayAnnotation(
  roomId: string,
  input: { player_id?: string; display_name?: string; event_id?: string | null; message: string },
) {
  return apiRequest<ReplayReport>(`/rooms/${encodeURIComponent(roomId)}/replay/annotations`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function joinRoom(roomId: string, input: JoinRoomInput) {
  return apiRequest<RoomWithPlayer>(`/rooms/${encodeURIComponent(roomId)}/join`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function spectateRoom(roomId: string, input: SpectateRoomInput) {
  return apiRequest<RoomWithSpectator>(`/rooms/${encodeURIComponent(roomId)}/spectate`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateRoomSettings(
  roomId: string,
  input: {
    player_id: string;
    spectators_allowed?: boolean;
    spectator_delay_seconds?: number;
    scheduled_for?: string;
    table_note?: string;
  },
) {
  return apiRequest<RoomDetail>(`/rooms/${encodeURIComponent(roomId)}/settings`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateSeat(
  roomId: string,
  input: { player_id: string; ready: boolean; deck_name?: string; commander?: string; deck?: LockedRoomDeck },
) {
  return apiRequest<RoomDetail>(`/rooms/${encodeURIComponent(roomId)}/seat`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function sendRoomChat(roomId: string, input: { player_id: string; message: string }) {
  return apiRequest<RoomDetail>(`/rooms/${encodeURIComponent(roomId)}/chat`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function startRoom(roomId: string, playerId: string) {
  return apiRequest<RoomDetail>(`/rooms/${encodeURIComponent(roomId)}/start`, {
    method: 'POST',
    body: JSON.stringify({ player_id: playerId }),
  });
}

export function startRealGame(roomId: string, playerId: string) {
  return apiRequest<RoomDetail>(`/rooms/${encodeURIComponent(roomId)}/start-real-game`, {
    method: 'POST',
    body: JSON.stringify({ player_id: playerId }),
  });
}

export function getEnginePreflight(roomId: string, playerId: string) {
  const params = new URLSearchParams({ player_id: playerId });
  return apiRequest<EnginePreflightResponse>(`/rooms/${encodeURIComponent(roomId)}/engine-preflight?${params}`);
}

export function rematchRoom(roomId: string, playerId: string) {
  return apiRequest<RoomDetail>(`/rooms/${encodeURIComponent(roomId)}/rematch`, {
    method: 'POST',
    body: JSON.stringify({ player_id: playerId }),
  });
}

export function getRealGameStartPayload(roomId: string, playerId: string) {
  const params = new URLSearchParams({ player_id: playerId });
  return apiRequest<StartRealGamePayload>(`/rooms/${encodeURIComponent(roomId)}/real-game/start-payload?${params}`);
}

export function getPendingRealGameActions(roomId: string, playerId: string) {
  const params = new URLSearchParams({ player_id: playerId });
  return apiRequest<PendingRealGameAction[]>(`/rooms/${encodeURIComponent(roomId)}/real-game/actions?${params}`);
}

export function submitRealGameAction(roomId: string, input: { player_id: string; action: RealGameAction; view_revision?: number }) {
  return apiRequest<PendingRealGameAction>(`/rooms/${encodeURIComponent(roomId)}/real-game/action`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function publishRealGameSnapshot(
  roomId: string,
  input: {
    player_id: string;
    revision: number;
    views: Record<string, unknown>;
    completed_action_ids?: string[];
    rejected_actions?: Record<string, string>;
    events?: string[];
  },
) {
  return apiRequest<RoomDetail>(`/rooms/${encodeURIComponent(roomId)}/real-game/snapshot`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getRealGameView(roomId: string, playerId: string) {
  const params = new URLSearchParams({ player_id: playerId });
  return apiRequest<RealGameViewResponse>(`/rooms/${encodeURIComponent(roomId)}/real-game/view?${params}`);
}

export function getRealGameSpectatorView(roomId: string, spectatorId: string) {
  const params = new URLSearchParams({ spectator_id: spectatorId });
  return apiRequest<RealGameViewResponse>(`/rooms/${encodeURIComponent(roomId)}/real-game/spectator-view?${params}`);
}

export function leaveRoom(roomId: string, playerId: string) {
  return apiRequest<RoomDetail>(`/rooms/${encodeURIComponent(roomId)}/leave`, {
    method: 'POST',
    body: JSON.stringify({ player_id: playerId }),
  });
}

export function sendGameAction(
  roomId: string,
  input: {
    player_id: string;
    action: GameAction;
    amount?: number;
    phase?: GamePhase;
    note?: string;
    target_player_id?: string;
    target_seat?: number;
    object_id?: string;
    counter_type?: string;
    tapped?: boolean;
    zone?: PublicZone;
  },
) {
  return apiRequest<RoomDetail>(`/rooms/${encodeURIComponent(roomId)}/game/action`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
