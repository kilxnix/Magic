import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  Copy,
  Database,
  Download,
  KeyRound,
  Megaphone,
  Plus,
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
  createApiKey,
  deleteAdminEvent,
  deleteAdminRoom,
  fetchAdminOverview,
  kickAdminSeat,
  listApiKeys,
  muteAdminSeat,
  removeAdminChat,
  revokeApiKey,
  topupApiKey,
  unmuteAdminSeat,
  type AdminOverview,
  type AdminRoomSummary,
  type ApiKey,
  type CreatedApiKey,
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
  const bookmarkCount = record.drillBookmarks?.length || 0;
  const attemptCount = record.drillBookmarks?.reduce((sum, bookmark) => sum + (bookmark.attempts?.length || 0), 0) || 0;
  return Object.keys(snapshot?.engineEventLogSeeds || {}).length + bookmarkCount + attemptCount;
}

function recentDrillAttempts(record: PlaySaveSlotRecord, limit = 3) {
  return (record.drillBookmarks || [])
    .flatMap(bookmark => (bookmark.attempts || []).map(attempt => ({ bookmark, attempt })))
    .sort((a, b) => b.attempt.savedAt - a.attempt.savedAt)
    .slice(0, limit);
}

function practiceSlotUrl(slot: number): string {
  return `/play?loadSlot=${slot}`;
}

function practiceBookmarkUrl(slot: number, bookmarkId: string): string {
  return `/play?loadSlot=${slot}&drillBookmark=${encodeURIComponent(bookmarkId)}`;
}

function practiceAttemptUrl(slot: number, bookmarkId: string, attemptId: string): string {
  return `/play?loadSlot=${slot}&drillBookmark=${encodeURIComponent(bookmarkId)}&drillAttempt=${encodeURIComponent(attemptId)}`;
}

function metricFromAttemptSummary(summary: string, label: string): number | null {
  const match = summary.match(new RegExp(`${label}\\s+(-?\\d+)`, 'i'));
  return match ? Number(match[1]) : null;
}

function opponentLifeAverageFromSummary(summary: string): number | null {
  const opponentSegment = summary
    .split('/')
    .map(part => part.trim())
    .find(part => part.toLowerCase().startsWith('opponents '));
  if (!opponentSegment) return null;
  const values = [...opponentSegment.matchAll(/\b(-?\d+)\b/g)].map(match => Number(match[1]));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function scorePracticeAttemptSummary(summary: string): { score: number; label: string } {
  const life = metricFromAttemptSummary(summary, 'You') ?? 0;
  const hand = metricFromAttemptSummary(summary, 'hand') ?? 0;
  const board = metricFromAttemptSummary(summary, 'board') ?? 0;
  const graveyard = metricFromAttemptSummary(summary, 'graveyard') ?? 0;
  const stack = metricFromAttemptSummary(summary, 'stack') ?? 0;
  const averageOpponentLife = opponentLifeAverageFromSummary(summary) ?? 40;
  const score = (life * 1.2) + (board * 3) + (hand * 0.8) + (graveyard * 0.15) - (averageOpponentLife * 0.45) - (stack * 0.5);
  return {
    score,
    label: `score ${score.toFixed(1)} / life ${life} / board ${board} / hand ${hand} / opp avg ${averageOpponentLife.toFixed(1)}`,
  };
}

function ApiKeysPanel({ token }: { token: string }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [quota, setQuota] = useState('');
  const [rateLimit, setRateLimit] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = async () => {
    setError(null);
    try {
      const res = await listApiKeys(token);
      setKeys(res.keys);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load API keys');
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const create = async () => {
    setCreating(true);
    setError(null);
    setNewKey(null);
    try {
      const created = await createApiKey(token, {
        label: label.trim(),
        quota: quota.trim() ? Math.max(1, parseInt(quota, 10)) : null,
        rateLimitPerMinute: rateLimit.trim() ? Math.max(1, parseInt(rateLimit, 10)) : null,
      });
      setNewKey(created);
      setLabel('');
      setQuota('');
      setRateLimit('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create key');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (keyId: string) => {
    if (!window.confirm('Revoke this key? It stops authenticating immediately.')) return;
    try {
      await revokeApiKey(token, keyId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke key');
    }
  };

  const topup = async (keyId: string) => {
    const input = window.prompt("Add how many requests to this key's allowance?", '100000');
    if (!input) return;
    const amount = parseInt(input, 10);
    if (!Number.isFinite(amount) || amount < 1) return;
    try {
      await topupApiKey(token, keyId, amount);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to top up key');
    }
  };

  const copySecret = async () => {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable; the secret is still visible to copy manually */
    }
  };

  const fmt = (n: number | null) => (n === null ? '∞' : n.toLocaleString());

  return (
    <section className="mb-5 rounded-lg border border-stone-800 bg-stone-900">
      <div className="flex flex-col gap-2 border-b border-stone-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-stone-300">
            <KeyRound className="h-4 w-4 text-amber-300" />
            Card-Support API Keys
          </h2>
          <p className="mt-1 text-xs text-stone-500">
            Issue licensing keys with a request allowance (quota). Usage depletes the quota and blocks at zero until you top it up.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="flex min-h-9 items-center justify-center gap-2 rounded border border-stone-700 px-3 text-xs font-bold text-stone-200 hover:bg-stone-800"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      <div className="space-y-4 p-4">
        {error && (
          <div className="rounded border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}

        {newKey && (
          <div className="rounded border border-emerald-500/50 bg-emerald-950/40 p-3">
            <div className="text-xs font-bold text-emerald-200">
              Key “{newKey.label || newKey.keyId}” created — copy it now, it will not be shown again.
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="flex-1 break-all rounded bg-stone-950 px-2 py-1.5 text-xs text-emerald-100">
                {newKey.secret}
              </code>
              <button
                type="button"
                onClick={() => void copySecret()}
                className="flex min-h-9 items-center gap-1.5 rounded border border-emerald-500/40 px-3 text-xs font-bold text-emerald-100 hover:bg-emerald-900/40"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {/* Create form */}
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="Label (e.g. acme-bots)"
            className="rounded border border-stone-700 bg-stone-950 px-2 py-1.5 text-xs text-stone-100 placeholder:text-stone-600"
          />
          <input
            value={quota}
            onChange={e => setQuota(e.target.value)}
            type="number"
            min={1}
            placeholder="Quota (blank = ∞)"
            className="w-36 rounded border border-stone-700 bg-stone-950 px-2 py-1.5 text-xs text-stone-100 placeholder:text-stone-600"
          />
          <input
            value={rateLimit}
            onChange={e => setRateLimit(e.target.value)}
            type="number"
            min={1}
            placeholder="Rate/min (blank = default)"
            className="w-40 rounded border border-stone-700 bg-stone-950 px-2 py-1.5 text-xs text-stone-100 placeholder:text-stone-600"
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={creating}
            className="flex min-h-9 items-center justify-center gap-1.5 rounded border border-amber-500/50 px-3 text-xs font-bold text-amber-100 hover:bg-amber-950/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            {creating ? 'Creating…' : 'Create key'}
          </button>
        </div>

        {/* Key table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-stone-500">
              <tr className="border-b border-stone-800">
                <th className="px-2 py-1.5 font-bold uppercase tracking-wider">Label</th>
                <th className="px-2 py-1.5 font-bold uppercase tracking-wider">Used / Quota</th>
                <th className="px-2 py-1.5 font-bold uppercase tracking-wider">Remaining</th>
                <th className="px-2 py-1.5 font-bold uppercase tracking-wider">Rate/min</th>
                <th className="px-2 py-1.5 font-bold uppercase tracking-wider">Status</th>
                <th className="px-2 py-1.5 font-bold uppercase tracking-wider">Last used</th>
                <th className="px-2 py-1.5 font-bold uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="text-stone-300">
              {keys.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-4 text-center text-stone-500">
                    No API keys yet. Create one above.
                  </td>
                </tr>
              )}
              {keys.map(k => (
                <tr key={k.keyId} className="border-b border-stone-800/60">
                  <td className="px-2 py-1.5">
                    <div className="font-bold text-stone-100">{k.label || '—'}</div>
                    <div className="font-mono text-[10px] text-stone-500">{k.keyId}</div>
                  </td>
                  <td className="px-2 py-1.5">{k.requestsUsed.toLocaleString()} / {fmt(k.quota)}</td>
                  <td className="px-2 py-1.5">{fmt(k.remaining)}</td>
                  <td className="px-2 py-1.5">{k.rateLimitPerMinute ?? 'default'}</td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                      k.status === 'active'
                        ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                        : 'border-stone-700 bg-stone-900 text-stone-400'
                    }`}>
                      {k.status}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-stone-400">{timeAgo(k.lastUsedAt)}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => void topup(k.keyId)}
                        className="rounded border border-sky-500/40 px-2 py-0.5 text-[10px] font-bold text-sky-100 hover:bg-sky-950/40"
                      >
                        Top up
                      </button>
                      {k.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => void revoke(k.keyId)}
                          className="flex items-center gap-1 rounded border border-rose-500/40 px-2 py-0.5 text-[10px] font-bold text-rose-200 hover:bg-rose-950/40"
                        >
                          <Ban className="h-3 w-3" />
                          Revoke
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
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
  const [practiceFilter, setPracticeFilter] = useState('');

  const selectedRoom = useMemo(
    () => overview?.rooms.find(room => room.id === selectedRoomId) || overview?.rooms[0] || null,
    [overview, selectedRoomId],
  );
  const practiceSaveCount = practiceSaves.filter(Boolean).length;
  const practiceAggregate = useMemo(() => {
    const records = practiceSaves.filter((record): record is PlaySaveSlotRecord => Boolean(record));
    const focusCounts = new Map<string, number>();
    const archetypeCounts = new Map<string, number>();
    const archetypeTrends = new Map<string, {
      archetype: string;
      saves: number;
      bookmarks: number;
      attempts: number;
      bestScore: number | null;
      latestAt: number;
    }>();
    const scoredAttempts: Array<{
      record: PlaySaveSlotRecord;
      bookmark: NonNullable<PlaySaveSlotRecord['drillBookmarks']>[number];
      attempt: NonNullable<NonNullable<PlaySaveSlotRecord['drillBookmarks']>[number]['attempts']>[number];
      score: number;
      scoreLabel: string;
    }> = [];
    let bookmarkCount = 0;
    let attemptCount = 0;
    let saveManagerOk = 0;
    for (const record of records) {
      if (record.canonicalManager?.status === 'ok') saveManagerOk += 1;
      const archetype = record.practice?.archetype || record.commander || 'Unlabeled practice';
      const trend = archetypeTrends.get(archetype) || {
        archetype,
        saves: 0,
        bookmarks: 0,
        attempts: 0,
        bestScore: null,
        latestAt: 0,
      };
      trend.saves += 1;
      trend.latestAt = Math.max(trend.latestAt, record.savedAt || 0);
      if (record.practice?.archetype) {
        archetypeCounts.set(record.practice.archetype, (archetypeCounts.get(record.practice.archetype) || 0) + 1);
      }
      for (const tag of record.practice?.focusTags || []) {
        focusCounts.set(tag, (focusCounts.get(tag) || 0) + 1);
      }
      bookmarkCount += record.drillBookmarks?.length || 0;
      attemptCount += record.drillBookmarks?.reduce((sum, bookmark) => sum + (bookmark.attempts?.length || 0), 0) || 0;
      for (const bookmark of record.drillBookmarks || []) {
        trend.bookmarks += 1;
        for (const attempt of bookmark.attempts || []) {
          trend.attempts += 1;
          trend.latestAt = Math.max(trend.latestAt, attempt.savedAt || 0);
          const scored = scorePracticeAttemptSummary(attempt.summary || '');
          trend.bestScore = trend.bestScore === null ? scored.score : Math.max(trend.bestScore, scored.score);
          scoredAttempts.push({
            record,
            bookmark,
            attempt,
            score: scored.score,
            scoreLabel: scored.label,
          });
        }
      }
      archetypeTrends.set(archetype, trend);
    }
    return {
      recordCount: records.length,
      saveManagerOk,
      bookmarkCount,
      attemptCount,
      topFocusTags: [...focusCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      archetypes: [...archetypeCounts.entries()].sort((a, b) => b[1] - a[1]),
      archetypeTrends: [...archetypeTrends.values()].sort((a, b) => b.attempts - a.attempts || b.bookmarks - a.bookmarks || b.saves - a.saves),
      recentAttempts: records.flatMap(record => recentDrillAttempts(record, 6).map(entry => ({ ...entry, record })))
        .sort((a, b) => b.attempt.savedAt - a.attempt.savedAt)
        .slice(0, 6),
      topScoredAttempts: scoredAttempts
        .sort((a, b) => (b.score - a.score) || (b.attempt.savedAt - a.attempt.savedAt))
        .slice(0, 6),
    };
  }, [practiceSaves]);
  const filteredPracticeEntries = useMemo(() => {
    const query = practiceFilter.trim().toLowerCase();
    return practiceSaves
      .map((record, index) => ({ record, slot: index + 1 }))
      .filter(({ record }) => {
        if (!query) return true;
        if (!record) return false;
        const haystack = [
          record.commander,
          record.practice?.archetype,
          ...(record.practice?.focusTags || []),
          ...(record.practice?.keyCards || []),
          ...(record.drillBookmarks || []).map(bookmark => `${bookmark.label} ${bookmark.note || ''}`).join(' '),
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(query);
      });
  }, [practiceSaves, practiceFilter]);

  const exportPracticeSaves = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      summary: practiceAggregate,
      slots: practiceSaves.filter(Boolean),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `deckreps-practice-saves-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice('Practice save export downloaded.');
  };

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

            <ApiKeysPanel token={token} />

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
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={exportPracticeSaves}
                    disabled={practiceSaveCount === 0}
                    className="flex min-h-9 items-center justify-center gap-2 rounded border border-sky-500/40 px-3 text-xs font-bold text-sky-100 hover:bg-sky-950/40 disabled:cursor-not-allowed disabled:border-stone-700 disabled:text-stone-500"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export
                  </button>
                  <button
                    type="button"
                    onClick={refreshPracticeSaves}
                    className="flex min-h-9 items-center justify-center gap-2 rounded border border-stone-700 px-3 text-xs font-bold text-stone-200 hover:border-amber-500/60"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Refresh Saves
                  </button>
                </div>
              </div>
              {practiceSaveError && (
                <div className="m-4 rounded border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-100">
                  {practiceSaveError}
                </div>
              )}
              <div className="grid gap-3 border-b border-stone-800 p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="grid gap-2 sm:grid-cols-4">
                  {[
                    ['Slots', practiceAggregate.recordCount],
                    ['Bookmarks', practiceAggregate.bookmarkCount],
                    ['Attempts', practiceAggregate.attemptCount],
                    ['SaveManager OK', `${practiceAggregate.saveManagerOk}/${practiceAggregate.recordCount || 0}`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded border border-stone-800 bg-neutral-950 px-3 py-2">
                      <div className="text-[10px] font-black uppercase tracking-wider text-stone-500">{label}</div>
                      <div className="mt-1 text-lg font-black text-stone-100">{value}</div>
                    </div>
                  ))}
                </div>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-stone-500">Filter Practice Saves</span>
                  <input
                    value={practiceFilter}
                    onChange={event => setPracticeFilter(event.target.value)}
                    placeholder="Xenagos, tutor, branch..."
                    className="min-h-10 w-full rounded border border-stone-700 bg-neutral-950 px-3 text-sm text-stone-100 outline-none focus:border-amber-400"
                  />
                </label>
                {(practiceAggregate.topFocusTags.length > 0 || practiceAggregate.recentAttempts.length > 0 || practiceAggregate.archetypeTrends.length > 0 || practiceAggregate.topScoredAttempts.length > 0) && (
                  <div className="lg:col-span-2 grid gap-3 lg:grid-cols-2">
                    {practiceAggregate.topFocusTags.length > 0 && (
                      <div className="rounded border border-amber-500/20 bg-amber-950/15 p-3">
                        <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-amber-200">Focus Frequency</div>
                        <div className="flex flex-wrap gap-1">
                          {practiceAggregate.topFocusTags.map(([tag, count]) => (
                            <span key={tag} className="rounded border border-amber-500/30 px-2 py-1 text-[10px] font-bold text-amber-100">
                              {tag} x{count}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {practiceAggregate.archetypeTrends.length > 0 && (
                      <div className="rounded border border-fuchsia-500/20 bg-fuchsia-950/15 p-3">
                        <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-fuchsia-200">Practice Trends</div>
                        <div className="grid gap-1">
                          {practiceAggregate.archetypeTrends.slice(0, 4).map(trend => (
                            <div key={trend.archetype} className="rounded border border-fuchsia-500/15 bg-neutral-950/60 px-2 py-1.5 text-xs">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-bold text-fuchsia-100">{trend.archetype}</span>
                                <span className="text-[10px] font-black uppercase tracking-wider text-fuchsia-100/70">
                                  {trend.attempts} attempts
                                </span>
                              </div>
                              <div className="mt-1 text-stone-400">
                                {trend.saves} saves / {trend.bookmarks} drills
                                {trend.bestScore !== null ? ` / best visible ${trend.bestScore.toFixed(1)}` : ''}
                              </div>
                              {trend.latestAt > 0 && (
                                <div className="mt-0.5 text-[10px] text-stone-500">
                                  Latest {new Date(trend.latestAt).toLocaleString()}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {practiceAggregate.recentAttempts.length > 0 && (
                      <div className="rounded border border-sky-500/20 bg-sky-950/15 p-3">
                        <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-sky-200">Recent Practice Attempts</div>
                        <div className="grid gap-1">
                          {practiceAggregate.recentAttempts.slice(0, 3).map(({ record, bookmark, attempt }) => (
                            <div key={`${record.slot}:${bookmark.id}:${attempt.id}`} className="rounded border border-sky-500/20 bg-neutral-950/60 px-2 py-1 text-xs">
                              <div className="font-bold text-sky-100">{record.commander} / {bookmark.label}</div>
                              <div className="truncate text-stone-400">{attempt.label} - {attempt.summary}</div>
                              <Link
                                to={practiceAttemptUrl(record.slot, bookmark.id, attempt.id)}
                                className="mt-1 inline-flex rounded border border-sky-500/30 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-sky-100 hover:bg-sky-950/50"
                              >
                                Load Attempt
                              </Link>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {practiceAggregate.topScoredAttempts.length > 0 && (
                      <div className="rounded border border-emerald-500/20 bg-emerald-950/15 p-3">
                        <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-emerald-200">Best Visible Outcomes</div>
                        <div className="grid gap-1">
                          {practiceAggregate.topScoredAttempts.slice(0, 4).map(({ record, bookmark, attempt, scoreLabel }) => (
                            <div key={`${record.slot}:${bookmark.id}:${attempt.id}:best`} className="rounded border border-emerald-500/20 bg-neutral-950/60 px-2 py-1 text-xs">
                              <div className="font-bold text-emerald-100">{record.practice?.archetype || record.commander}</div>
                              <div className="truncate text-stone-400">{bookmark.label} / {attempt.label}</div>
                              <div className="mt-0.5 text-[10px] font-bold text-emerald-100/80">{scoreLabel}</div>
                              <Link
                                to={practiceAttemptUrl(record.slot, bookmark.id, attempt.id)}
                                className="mt-1 inline-flex rounded border border-emerald-500/30 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-100 hover:bg-emerald-950/50"
                              >
                                Load Best Attempt
                              </Link>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
                {filteredPracticeEntries.map(({ record, slot }) => {
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
                        {record?.canonicalManager && (
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-black uppercase ${
                            record.canonicalManager.status === 'ok'
                              ? 'border-fuchsia-500/40 bg-fuchsia-950/30 text-fuchsia-200'
                              : 'border-red-500/40 bg-red-950/30 text-red-200'
                          }`}>
                            {record.canonicalManager.status === 'ok'
                              ? 'SaveManager OK'
                              : record.canonicalManager.status === 'mismatch'
                              ? 'SaveManager mismatch'
                              : 'SaveManager missing'}
                          </span>
                        )}
                      </div>
                      {record ? (
                        <>
                          <div className="text-xs text-stone-500">
                            Turn {record.turnNumber} / {record.phase} / {new Date(record.savedAt).toLocaleString()}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Link
                              to={practiceSlotUrl(slot)}
                              className="inline-flex min-h-8 items-center rounded border border-amber-500/35 px-2.5 text-[10px] font-black uppercase tracking-wider text-amber-100 hover:bg-amber-950/40"
                            >
                              Open Save
                            </Link>
                            {record.drillBookmarks?.length ? (
                              <Link
                                to={practiceBookmarkUrl(slot, record.drillBookmarks[record.drillBookmarks.length - 1].id)}
                                className="inline-flex min-h-8 items-center rounded border border-fuchsia-500/35 px-2.5 text-[10px] font-black uppercase tracking-wider text-fuchsia-100 hover:bg-fuchsia-950/40"
                              >
                                Load Latest Drill
                              </Link>
                            ) : null}
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
                              {practiceCheckpointCount(record)} drill checkpoints/bookmarks available
                            </div>
                          )}
                          {record.drillBookmarks && record.drillBookmarks.length > 0 && (
                            <div className="mt-2 rounded border border-fuchsia-500/20 bg-fuchsia-950/20 p-2 text-xs text-fuchsia-100">
                              Latest drill: {record.drillBookmarks[record.drillBookmarks.length - 1]?.label}
                              {record.drillBookmarks[record.drillBookmarks.length - 1]?.note && (
                                <span className="mt-1 block text-stone-400">
                                  {record.drillBookmarks[record.drillBookmarks.length - 1]?.note}
                                </span>
                              )}
                              {recentDrillAttempts(record).length > 0 && (
                                <span className="mt-2 block rounded border border-sky-500/20 bg-sky-950/30 p-2 text-sky-100">
                                  Recent attempts
                                  {recentDrillAttempts(record).map(({ bookmark, attempt }) => (
                                    <span key={`${bookmark.id}:${attempt.id}`} className="mt-1 block rounded border border-sky-500/15 bg-neutral-950/50 p-1.5">
                                      <span className="flex flex-wrap items-center justify-between gap-2">
                                        <span>{bookmark.label} / {attempt.label}</span>
                                        <Link
                                          to={practiceAttemptUrl(slot, bookmark.id, attempt.id)}
                                          className="rounded border border-sky-500/30 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-sky-100 hover:bg-sky-950/50"
                                        >
                                          Load
                                        </Link>
                                      </span>
                                      <span className="mt-0.5 block text-stone-400">
                                        {attempt.summary}
                                      </span>
                                    </span>
                                  ))}
                                </span>
                              )}
                            </div>
                          )}
                          {record.canonicalManager && (
                            <div className="mt-2 rounded border border-fuchsia-500/20 bg-fuchsia-950/20 p-2 text-xs text-fuchsia-100">
                              SaveManager primary: {record.canonicalManager.fingerprint.slice(0, 12)}
                              {record.canonicalManager.verifiedFingerprint && (
                                <span className="mt-1 block text-stone-400">
                                  Verified: {record.canonicalManager.verifiedFingerprint.slice(0, 12)}
                                </span>
                              )}
                              {record.canonicalManager.status && record.canonicalManager.status !== 'ok' && (
                                <span className="mt-1 block text-red-200">
                                  Authoritative engine save is {record.canonicalManager.status}.
                                </span>
                              )}
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
                      {audit && !audit.ok && (
                        <div className="mt-2 rounded border border-red-500/20 bg-red-950/20 p-2 text-xs text-red-100">
                          <div className="font-bold">Replay audit diagnostic</div>
                          <div className="mt-1 text-red-100/80">
                            {audit.developerMessage || audit.message}
                          </div>
                          <div className="mt-2 grid gap-1 text-[11px] text-stone-400">
                            {audit.failedEventSequence !== undefined && (
                              <span>Event {audit.failedEventSequence}</span>
                            )}
                            {audit.reason && (
                              <span>Reason: {audit.reason}</span>
                            )}
                            {audit.expectedStateBeforeId && (
                              <span>Before expected {audit.expectedStateBeforeId.slice(0, 12)} / actual {audit.stateBeforeId?.slice(0, 12) || 'unknown'}</span>
                            )}
                            {audit.expectedStateAfterId && (
                              <span>After expected {audit.expectedStateAfterId.slice(0, 12)} / actual {audit.stateAfterId?.slice(0, 12) || 'unknown'}</span>
                            )}
                          </div>
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
                {practiceSaves.length > 0 && filteredPracticeEntries.length === 0 && (
                  <div className="text-sm text-stone-500">No practice saves match this filter.</div>
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
