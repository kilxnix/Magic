export interface AdminSeat {
  seat: number;
  player_id: string | null;
  name: string | null;
  ready: boolean;
  commander: string | null;
  deck_locked: boolean;
  disconnected: boolean;
  muted?: boolean;
  banned?: boolean;
  is_host: boolean;
}

export interface AdminChatMessage {
  id: string;
  player_name: string;
  message: string;
  system: boolean;
  created_at: string;
}

export interface AdminRoomSummary {
  id: string;
  name: string;
  status: string;
  namespace: string;
  is_private: boolean;
  has_password: boolean;
  host_player_id: string | null;
  host_name: string | null;
  player_count: number;
  spectator_count: number;
  chat_count: number;
  muted_player_count?: number;
  banned_player_count?: number;
  game_status?: string | null;
  real_game_status?: string | null;
  created_at: string;
  updated_at: string;
  seats: AdminSeat[];
  chat: AdminChatMessage[];
}

export interface AdminEventSummary {
  id: string;
  name: string;
  format: string;
  status: string;
  public: boolean;
  organizer_name: string;
  player_count: number;
  match_count: number;
  created_at: string;
  updated_at: string;
}

export interface AdminOverview {
  status: string;
  generated_at: string;
  room_count: number;
  active_room_count: number;
  event_count: number;
  running_event_count: number;
  rooms: AdminRoomSummary[];
  events: AdminEventSummary[];
  client_events: Record<string, any>[];
  audit_events: Record<string, any>[];
}

function adminHeaders(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'x-admin-token': token,
  };
}

async function adminJson<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...adminHeaders(token),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Admin request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function adminAuthCheck(token: string): Promise<boolean> {
  await adminJson('/api/admin/auth-check', token, { method: 'POST', body: '{}' });
  return true;
}

export function fetchAdminOverview(token: string): Promise<AdminOverview> {
  return adminJson('/api/admin/overview', token);
}

export function closeAdminRoom(token: string, roomId: string, reason = '') {
  return adminJson(`/api/admin/rooms/${roomId}/close`, token, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function deleteAdminRoom(token: string, roomId: string, reason = '') {
  return adminJson(`/api/admin/rooms/${roomId}`, token, {
    method: 'DELETE',
    body: JSON.stringify({ reason }),
  });
}

export function kickAdminSeat(token: string, roomId: string, seat: number, reason = '') {
  return adminJson(`/api/admin/rooms/${roomId}/seats/${seat}/kick`, token, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function muteAdminSeat(token: string, roomId: string, seat: number, reason = '') {
  return adminJson(`/api/admin/rooms/${roomId}/seats/${seat}/mute`, token, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function unmuteAdminSeat(token: string, roomId: string, seat: number, reason = '') {
  return adminJson(`/api/admin/rooms/${roomId}/seats/${seat}/unmute`, token, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function banAdminSeat(token: string, roomId: string, seat: number, reason = '') {
  return adminJson(`/api/admin/rooms/${roomId}/seats/${seat}/ban`, token, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function removeAdminChat(token: string, roomId: string, messageId: string, reason = '') {
  return adminJson(`/api/admin/rooms/${roomId}/chat/${messageId}`, token, {
    method: 'DELETE',
    body: JSON.stringify({ reason }),
  });
}

export function announceAdminRoom(token: string, roomId: string, message: string) {
  return adminJson(`/api/admin/rooms/${roomId}/announce`, token, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export function closeAdminEvent(token: string, eventId: string, reason = '') {
  return adminJson(`/api/admin/events/${eventId}/close`, token, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function deleteAdminEvent(token: string, eventId: string, reason = '') {
  return adminJson(`/api/admin/events/${eventId}`, token, {
    method: 'DELETE',
    body: JSON.stringify({ reason }),
  });
}

// --- Card-support licensing API keys ---------------------------------------

export interface ApiKey {
  keyId: string;
  label: string;
  quota: number | null;
  requestsUsed: number;
  remaining: number | null;
  rateLimitPerMinute: number | null;
  status: string;
  createdAt: string;
  lastUsedAt: string | null;
  createdBy: string | null;
}

// create returns the same shape plus the one-time-visible secret.
export interface CreatedApiKey extends ApiKey {
  secret: string;
}

export function listApiKeys(token: string): Promise<{ keys: ApiKey[] }> {
  return adminJson('/api/admin/api-keys', token);
}

export function createApiKey(
  token: string,
  body: { label: string; quota: number | null; rateLimitPerMinute: number | null },
): Promise<CreatedApiKey> {
  return adminJson('/api/admin/api-keys', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function topupApiKey(token: string, keyId: string, addQuota: number) {
  return adminJson(`/api/admin/api-keys/${keyId}/topup`, token, {
    method: 'POST',
    body: JSON.stringify({ addQuota }),
  });
}

export function revokeApiKey(token: string, keyId: string) {
  return adminJson(`/api/admin/api-keys/${keyId}/revoke`, token, {
    method: 'POST',
    body: '{}',
  });
}
