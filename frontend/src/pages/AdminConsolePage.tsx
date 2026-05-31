import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  Database,
  Megaphone,
  RefreshCw,
  Shield,
  Trash2,
  UserX,
  XCircle,
} from 'lucide-react';
import {
  adminAuthCheck,
  announceAdminRoom,
  banAdminSeat,
  closeAdminEvent,
  closeAdminRoom,
  deleteAdminEvent,
  deleteAdminRoom,
  fetchAdminOverview,
  kickAdminSeat,
  muteAdminSeat,
  removeAdminChat,
  unmuteAdminSeat,
  type AdminOverview,
  type AdminRoomSummary,
} from '../lib/admin';
import { auditPlaySaveSnapshot } from '../lib/playSaveAudit';
import { auditCanonicalPlayEngineSave } from '../lib/playCanonicalSave';
import {
  getPlaySaveSlots,
  type PlaySaveSlotRecord,
} from '../lib/playSaveStorage';

const ADMIN_TOKEN_STORAGE = 'deckreps_admin_console_token';

function timeAgo(value: string | undefined | null): string {
  if (!value) return 'unknown';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const delta = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusClass(status: string | undefined | null): string {
  if (status === 'closed' || status === 'complete') return 'border-stone-700 bg-stone-900 text-stone-300';
  if (status === 'running' || status === 'in_game' || status === 'playing') return 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200';
  return 'border-amber-500/40 bg-amber-950/40 text-amber-200';
}

function practiceCheckpointCount(record: PlaySaveSlotRecord): number {
  const snapshot = record.snapshot as { engineEventLogSeeds?: Record<number, unknown> } | null | undefined;
  return Object.keys(snapshot?.engineEventLogSeeds || {}).length;
}

export function AdminConsolePage() {
  const [token, setToken] = useState(() => window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE) || '');
  const [tokenInput, setTokenInput] = useState(token);
  const [authed, setAuthed] = useState(Boolean(token));
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [practiceSaves, setPracticeSaves] = useState<(PlaySaveSlotRecord | null)[]>([]);
  const [practiceSaveError, setPracticeSaveError] = useState<string | null>(null);

  const selectedRoom = useMemo(
    () => overview?.rooms.find(room => room.id === selectedRoomId) || overview?.rooms[0] || null,
    [overview, selectedRoomId],
  );
  const practiceSaveCount = practiceSaves.filter(Boolean).length;

  const refreshPracticeSaves = async () => {
    try {
      const slots = await getPlaySaveSlots();
      setPracticeSaves(slots);
      setPracticeSaveError(null);
    } catch (err: any) {
      setPracticeSaveError(err.message || 'Unable to load browser practice saves.');
    }
  };

  const refresh = async (activeToken = token) => {
    if (!activeToken) return;
    setLoading(true);
    setError(null);
    try {
      const [next] = await Promise.all([
        fetchAdminOverview(activeToken),
        refreshPracticeSaves(),
      ]);
      setOverview(next);
      setAuthed(true);
      if (!selectedRoomId && next.rooms[0]) setSelectedRoomId(next.rooms[0].id);
    } catch (err: any) {
      setError(err.message || 'Unable to load admin overview');
      setAuthed(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      refresh(token);
      const id = window.setInterval(() => refresh(token), 30000);
      return () => window.clearInterval(id);
    }
    return undefined;
  }, [token]);

  const handleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      await adminAuthCheck(tokenInput.trim());
      window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE, tokenInput.trim());
      setToken(tokenInput.trim());
      setAuthed(true);
      setNotice('Admin console unlocked.');
    } catch (err: any) {
      setError(err.message || 'Admin token rejected');
      setAuthed(false);
    } finally {
      setLoading(false);
    }
  };

  const runAction = async (label: string, action: () => Promise<unknown>) => {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      await action();
      setNotice(label);
      await refresh(token);
    } catch (err: any) {
      setError(err.message || 'Admin action failed');
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    window.sessionStorage.removeItem(ADMIN_TOKEN_STORAGE);
    setToken('');
    setTokenInput('');
    setAuthed(false);
    setOverview(null);
    setSelectedRoomId(null);
  };

  if (!authed || !token) {
    return (
      <main className="min-h-screen bg-neutral-950 px-4 py-6 text-stone-100">
        <div className="mx-auto max-w-md">
          <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-stone-400 hover:text-amber-200">
            <ArrowLeft className="h-4 w-4" />
            Back to DeckReps
          </Link>
          <section className="rounded-lg border border-stone-800 bg-stone-900 p-5 shadow-2xl shadow-black/30">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-500/50 bg-amber-500/10 text-amber-200">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-black">Admin Console</h1>
                <p className="text-sm text-stone-400">Protected site-wide moderation and operations.</p>
              </div>
            </div>
            <label className="mb-2 block text-xs font-black uppercase tracking-wider text-stone-400">
              Admin Token
            </label>
            <input
              type="password"
              value={tokenInput}
              onChange={event => setTokenInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') handleLogin();
              }}
              className="mb-3 min-h-11 w-full rounded border border-stone-700 bg-neutral-950 px-3 text-sm text-stone-100 outline-none focus:border-amber-400"
              autoComplete="off"
            />
            {error && (
              <p className="mb-3 rounded border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-100">{error}</p>
            )}
            <button
              type="button"
              onClick={handleLogin}
              disabled={!tokenInput.trim() || loading}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded bg-amber-500 px-4 py-2 text-sm font-black text-neutral-950 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
              Unlock Console
            </button>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-5 text-stone-100">
      <div className="mx-auto max-w-7xl">
        <header className="mb-5 flex flex-col gap-3 border-b border-stone-800 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Link to="/" className="mb-2 inline-flex items-center gap-2 text-sm font-bold text-stone-500 hover:text-amber-200">
              <ArrowLeft className="h-4 w-4" />
              Back to DeckReps
            </Link>
            <h1 className="flex items-center gap-2 text-2xl font-black">
              <Shield className="h-6 w-6 text-amber-300" />
              Admin Console
            </h1>
            <p className="text-sm text-stone-400">Rooms, events, client diagnostics, and moderation controls.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => refresh()}
              disabled={loading}
              className="flex min-h-10 items-center gap-2 rounded border border-stone-700 bg-stone-900 px-3 text-sm font-bold text-stone-100 hover:border-amber-500/60 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={logout}
              className="min-h-10 rounded border border-stone-700 px-3 text-sm font-bold text-stone-300 hover:bg-stone-900"
            >
              Lock
            </button>
          </div>
        </header>

        {(error || notice) && (
          <div className={`mb-4 flex items-center gap-2 rounded border px-3 py-2 text-sm ${
            error ? 'border-red-500/40 bg-red-950/40 text-red-100' : 'border-emerald-500/40 bg-emerald-950/40 text-emerald-100'
          }`}>
            {error ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {error || notice}
          </div>
        )}

        {overview && (
          <>
            <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                ['Rooms', overview.room_count, `${overview.active_room_count} active`],
                ['Events', overview.event_count, `${overview.running_event_count} running`],
                ['Diagnostics', overview.client_events.length, 'recent client events'],
                ['Practice Saves', practiceSaveCount, 'browser slots'],
                ['Audit', overview.audit_events.length, 'recent admin actions'],
              ].map(([label, value, sub]) => (
                <div key={label} className="rounded-lg border border-stone-800 bg-stone-900 p-4">
                  <div className="text-xs font-black uppercase tracking-wider text-stone-500">{label}</div>
                  <div className="mt-1 text-2xl font-black text-stone-50">{value}</div>
                  <div className="text-xs text-stone-400">{sub}</div>
                </div>
              ))}
            </section>

            <section className="mb-5 rounded-lg border border-stone-800 bg-stone-900">
              <div className="flex flex-col gap-2 border-b border-stone-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-stone-300">
                    <Database className="h-4 w-4 text-amber-300" />
                    1v1 Practice Saves
                  </h2>
                  <p className="mt-1 text-xs text-stone-500">
                    Browser-local `/play` save slots from this admin browser, including coaching focus and replay audit health.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={refreshPracticeSaves}
                  className="flex min-h-9 items-center justify-center gap-2 rounded border border-stone-700 px-3 text-xs font-bold text-stone-200 hover:border-amber-500/60"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh Saves
                </button>
              </div>
              {practiceSaveError && (
                <div className="m-4 rounded border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-100">
                  {practiceSaveError}
                </div>
              )}
              <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
                {practiceSaves.map((record, index) => {
                  const slot = index + 1;
                  const audit = record ? auditPlaySaveSnapshot(record.snapshot) : null;
                  const canonicalAudit = record?.canonicalEngineSave ? auditCanonicalPlayEngineSave(record.canonicalEngineSave) : null;
                  return (
                    <div key={slot} className="rounded-lg border border-stone-800 bg-neutral-950 p-3">
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-black uppercase tracking-wider text-stone-500">Slot {slot}</div>
                          <div className="font-bold text-stone-100">{record?.commander || 'Empty'}</div>
                        </div>
                        {audit && (
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-black uppercase ${
                            audit.ok
                              ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
                              : 'border-red-500/40 bg-red-950/30 text-red-200'
                          }`}>
                            {audit.message}
                          </span>
                        )}
                        {canonicalAudit && (
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-black uppercase ${
                            canonicalAudit.ok
                              ? 'border-sky-500/40 bg-sky-950/30 text-sky-200'
                              : 'border-red-500/40 bg-red-950/30 text-red-200'
                          }`}>
                            {canonicalAudit.ok ? 'Engine Save OK' : 'Engine Save Missing'}
                          </span>
                        )}
                      </div>
                      {record ? (
                        <>
                          <div className="text-xs text-stone-500">
                            Turn {record.turnNumber} / {record.phase} / {new Date(record.savedAt).toLocaleString()}
                          </div>
                          {record.practice && (
                            <div className="mt-3 rounded border border-amber-500/20 bg-amber-950/20 p-2">
                              <div className="text-xs font-black uppercase tracking-wider text-amber-200">
                                {record.practice.archetype}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1">
                                {record.practice.focusTags.map(tag => (
                                  <span key={tag} className="rounded border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-amber-100">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                              {record.practice.keyCards.length > 0 && (
                                <p className="mt-2 text-xs leading-5 text-stone-400">
                                  Key cards: {record.practice.keyCards.slice(0, 4).join(', ')}
                                </p>
                              )}
                            </div>
                          )}
                          {record.audit && (
                            <div className="mt-2 text-xs text-stone-500">
                              {record.audit.engineEventCount} replay events / {record.audit.seedCount} seeds
                            </div>
                          )}
                          {practiceCheckpointCount(record) > 0 && (
                            <div className="mt-1 text-xs text-stone-500">
                              {practiceCheckpointCount(record)} drill checkpoints available
                            </div>
                          )}
                          {canonicalAudit?.ok && canonicalAudit.fingerprint && (
                            <div className="mt-2 rounded border border-sky-500/20 bg-sky-950/20 p-2 text-xs text-sky-100">
                              Canonical engine state: {canonicalAudit.fingerprint.slice(0, 12)}
                              <span className="mt-1 block text-stone-500">
                                {record.canonicalEngineSave?.metadata.playerCount} players / turn {record.canonicalEngineSave?.metadata.turnNumber}
                              </span>
                            </div>
                          )}
                          {canonicalAudit && !canonicalAudit.ok && (
                            <div className="mt-2 rounded border border-red-500/20 bg-red-950/20 p-2 text-xs text-red-100">
                              {canonicalAudit.message}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-xs text-stone-500">No saved practice game in this slot.</div>
                      )}
                    </div>
                  );
                })}
                {practiceSaves.length === 0 && (
                  <div className="text-sm text-stone-500">No browser save slots found.</div>
                )}
              </div>
            </section>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <section className="min-w-0 rounded-lg border border-stone-800 bg-stone-900">
                <div className="flex items-center justify-between border-b border-stone-800 px-4 py-3">
                  <h2 className="text-sm font-black uppercase tracking-wider text-stone-300">Rooms</h2>
                  <span className="text-xs text-stone-500">Last refresh {timeAgo(overview.generated_at)}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-neutral-950/60 text-xs uppercase tracking-wider text-stone-500">
                      <tr>
                        <th className="px-4 py-2">Room</th>
                        <th className="px-4 py-2">Status</th>
                        <th className="px-4 py-2">Players</th>
                        <th className="px-4 py-2">Modes</th>
                        <th className="px-4 py-2">Updated</th>
                        <th className="px-4 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-800">
                      {overview.rooms.map(room => (
                        <tr key={room.id} className={selectedRoom?.id === room.id ? 'bg-amber-500/5' : ''}>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => setSelectedRoomId(room.id)}
                              className="text-left font-bold text-stone-100 hover:text-amber-200"
                            >
                              {room.name}
                            </button>
                            <div className="font-mono text-xs text-stone-500">{room.id}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`rounded border px-2 py-1 text-xs font-black uppercase ${statusClass(room.status)}`}>
                              {room.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-stone-300">
                            {room.player_count} players
                            <div className="text-xs text-stone-500">{room.spectator_count} spectators</div>
                          </td>
                          <td className="px-4 py-3 text-xs text-stone-400">
                            {room.game_status ? <div>Tracker: {room.game_status}</div> : null}
                            {room.real_game_status ? <div>Engine: {room.real_game_status}</div> : null}
                            {!room.game_status && !room.real_game_status ? 'Lobby' : null}
                          </td>
                          <td className="px-4 py-3 text-stone-400">{timeAgo(room.updated_at)}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => runAction('Room closed.', () => closeAdminRoom(token, room.id, reason))}
                                className="rounded border border-amber-500/40 px-2 py-1 text-xs font-bold text-amber-200 hover:bg-amber-950/40"
                              >
                                Close
                              </button>
                              <button
                                type="button"
                                onClick={() => runAction('Room deleted.', () => deleteAdminRoom(token, room.id, reason))}
                                className="rounded border border-red-500/40 px-2 py-1 text-xs font-bold text-red-200 hover:bg-red-950/40"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {overview.rooms.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-stone-500">No rooms found.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <aside className="space-y-5">
                <section className="rounded-lg border border-stone-800 bg-stone-900 p-4">
                  <h2 className="mb-3 text-sm font-black uppercase tracking-wider text-stone-300">Action Reason</h2>
                  <textarea
                    value={reason}
                    onChange={event => setReason(event.target.value)}
                    placeholder="Optional reason stored in admin audit"
                    className="min-h-20 w-full rounded border border-stone-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-amber-400"
                  />
                </section>

                {selectedRoom && (
                  <RoomAdminCard
                    room={selectedRoom}
                    token={token}
                    reason={reason}
                    announcement={announcement}
                    setAnnouncement={setAnnouncement}
                    runAction={runAction}
                  />
                )}
              </aside>
            </div>

            <section className="mt-5 grid gap-5 lg:grid-cols-2">
              <div className="rounded-lg border border-stone-800 bg-stone-900">
                <div className="border-b border-stone-800 px-4 py-3">
                  <h2 className="text-sm font-black uppercase tracking-wider text-stone-300">Events</h2>
                </div>
                <div className="divide-y divide-stone-800">
                  {overview.events.map(event => (
                    <div key={event.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-bold text-stone-100">{event.name}</div>
                        <div className="text-xs text-stone-500">{event.format} · {event.player_count} players · {timeAgo(event.updated_at)}</div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => runAction('Event closed.', () => closeAdminEvent(token, event.id, reason))}
                          className="rounded border border-amber-500/40 px-2 py-1 text-xs font-bold text-amber-200"
                        >
                          Close
                        </button>
                        <button
                          type="button"
                          onClick={() => runAction('Event deleted.', () => deleteAdminEvent(token, event.id, reason))}
                          className="rounded border border-red-500/40 px-2 py-1 text-xs font-bold text-red-200"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                  {overview.events.length === 0 && <div className="px-4 py-8 text-center text-stone-500">No events found.</div>}
                </div>
              </div>

              <div className="rounded-lg border border-stone-800 bg-stone-900">
                <div className="border-b border-stone-800 px-4 py-3">
                  <h2 className="text-sm font-black uppercase tracking-wider text-stone-300">Diagnostics</h2>
                </div>
                <div className="max-h-96 overflow-y-auto divide-y divide-stone-800">
                  {overview.client_events.slice().reverse().map((event, index) => (
                    <div key={event.id || index} className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className={`rounded px-2 py-0.5 text-[10px] font-black uppercase ${
                          event.severity === 'error' ? 'bg-red-950 text-red-200' : 'bg-stone-800 text-stone-300'
                        }`}>
                          {event.kind || 'event'}
                        </span>
                        <span className="text-xs text-stone-500">{timeAgo(event.created_at)}</span>
                      </div>
                      <p className="mt-1 text-stone-300">{event.message}</p>
                      {event.page && <p className="mt-1 font-mono text-xs text-stone-500">{event.page}</p>}
                    </div>
                  ))}
                  {overview.client_events.length === 0 && <div className="px-4 py-8 text-center text-stone-500">No recent diagnostics.</div>}
                </div>
              </div>
            </section>

            <section className="mt-5 rounded-lg border border-stone-800 bg-stone-900">
              <div className="border-b border-stone-800 px-4 py-3">
                <h2 className="text-sm font-black uppercase tracking-wider text-stone-300">Admin Audit</h2>
              </div>
              <div className="grid gap-2 p-4 md:grid-cols-2 xl:grid-cols-3">
                {overview.audit_events.slice().reverse().map((event, index) => (
                  <div key={event.id || index} className="rounded border border-stone-800 bg-neutral-950 p-3 text-sm">
                    <div className="font-bold text-stone-100">{event.action}</div>
                    <div className="font-mono text-xs text-stone-500">{event.target_type}:{event.target_id}</div>
                    <div className="mt-1 text-xs text-stone-500">{timeAgo(event.created_at)}</div>
                  </div>
                ))}
                {overview.audit_events.length === 0 && <div className="text-stone-500">No admin actions yet.</div>}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function RoomAdminCard({
  room,
  token,
  reason,
  announcement,
  setAnnouncement,
  runAction,
}: {
  room: AdminRoomSummary;
  token: string;
  reason: string;
  announcement: string;
  setAnnouncement: (value: string) => void;
  runAction: (label: string, action: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <section className="rounded-lg border border-stone-800 bg-stone-900 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-black text-stone-50">{room.name}</h2>
          <p className="font-mono text-xs text-stone-500">{room.id}</p>
          {(room.muted_player_count || room.banned_player_count) ? (
            <p className="mt-1 text-xs font-bold text-amber-200">
              {room.muted_player_count || 0} muted / {room.banned_player_count || 0} banned
            </p>
          ) : null}
        </div>
        <span className={`rounded border px-2 py-1 text-xs font-black uppercase ${statusClass(room.status)}`}>{room.status}</span>
      </div>

      <div className="mb-4 space-y-2">
        {room.seats.map(seat => (
          <div key={seat.seat} className="flex flex-wrap items-center justify-between gap-2 rounded border border-stone-800 bg-neutral-950 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate font-bold text-stone-100">
                Seat {seat.seat}: {seat.name || 'Open'}
              </div>
              <div className="truncate text-xs text-stone-500">
                {seat.commander || 'No commander'} {seat.is_host ? ' / host' : ''} {seat.disconnected ? ' / disconnected' : ''} {seat.muted ? ' / muted' : ''} {seat.banned ? ' / banned' : ''}
              </div>
            </div>
            {seat.player_id && (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => runAction(seat.muted ? 'Seat unmuted.' : 'Seat muted.', () => (
                    seat.muted
                      ? unmuteAdminSeat(token, room.id, seat.seat, reason)
                      : muteAdminSeat(token, room.id, seat.seat, reason)
                  ))}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border ${
                    seat.muted
                      ? 'border-emerald-500/40 text-emerald-200 hover:bg-emerald-950/40'
                      : 'border-amber-500/40 text-amber-200 hover:bg-amber-950/40'
                  }`}
                  aria-label={`${seat.muted ? 'Unmute' : 'Mute'} ${seat.name || `seat ${seat.seat}`}`}
                  title={seat.muted ? 'Unmute player chat' : 'Mute player chat'}
                >
                  <Megaphone className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => runAction('Seat removed.', () => kickAdminSeat(token, room.id, seat.seat, reason))}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-red-500/40 text-red-200 hover:bg-red-950/40"
                  aria-label={`Remove ${seat.name || `seat ${seat.seat}`}`}
                  title="Kick player from room"
                >
                  <UserX className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => runAction('Seat banned.', () => banAdminSeat(token, room.id, seat.seat, reason))}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-red-600/50 text-red-100 hover:bg-red-950/60"
                  aria-label={`Ban ${seat.name || `seat ${seat.seat}`}`}
                  title="Ban player from room"
                >
                  <Ban className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mb-4">
        <label className="mb-2 block text-xs font-black uppercase tracking-wider text-stone-500">Room Announcement</label>
        <div className="flex gap-2">
          <input
            value={announcement}
            onChange={event => setAnnouncement(event.target.value)}
            className="min-h-10 min-w-0 flex-1 rounded border border-stone-700 bg-neutral-950 px-3 text-sm outline-none focus:border-amber-400"
            placeholder="Message all room users"
          />
          <button
            type="button"
            disabled={!announcement.trim()}
            onClick={() => runAction('Announcement sent.', () => announceAdminRoom(token, room.id, announcement.trim()).then(result => {
              setAnnouncement('');
              return result;
            }))}
            className="flex h-10 w-10 items-center justify-center rounded bg-amber-500 text-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Send room announcement"
          >
            <Megaphone className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-black uppercase tracking-wider text-stone-500">Recent Chat</h3>
        <div className="max-h-80 overflow-y-auto space-y-2">
          {room.chat.slice().reverse().map(message => (
            <div key={message.id} className="rounded border border-stone-800 bg-neutral-950 p-2 text-sm">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate font-bold text-stone-200">{message.player_name}</span>
                {!message.system && (
                  <button
                    type="button"
                    onClick={() => runAction('Chat message removed.', () => removeAdminChat(token, room.id, message.id, reason))}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-red-500/40 text-red-200 hover:bg-red-950/40"
                    aria-label="Remove chat message"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <p className="break-words text-stone-400">{message.message}</p>
            </div>
          ))}
          {room.chat.length === 0 && (
            <div className="flex items-center gap-2 rounded border border-stone-800 bg-neutral-950 p-3 text-sm text-stone-500">
              <AlertTriangle className="h-4 w-4" />
              No chat yet.
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => runAction('Room closed.', () => closeAdminRoom(token, room.id, reason))}
          className="flex min-h-10 items-center justify-center gap-2 rounded border border-amber-500/40 px-3 text-sm font-bold text-amber-200 hover:bg-amber-950/40"
        >
          <Ban className="h-4 w-4" />
          Close
        </button>
        <button
          type="button"
          onClick={() => runAction('Room deleted.', () => deleteAdminRoom(token, room.id, reason))}
          className="flex min-h-10 items-center justify-center gap-2 rounded border border-red-500/40 px-3 text-sm font-bold text-red-200 hover:bg-red-950/40"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </div>
    </section>
  );
}
