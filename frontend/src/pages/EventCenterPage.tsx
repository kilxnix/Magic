import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  Eye,
  Lock,
  MessageSquare,
  Plus,
  RefreshCw,
  Shield,
  Swords,
  Users,
} from 'lucide-react';
import {
  EventDetail,
  EventFormat,
  EventMatch,
  EventSummary,
  createEvent,
  createEventMatchRoom,
  getEvent,
  listEvents,
  pairNextEventRound,
  postEventAnnouncement,
  registerEventPlayer,
  reportEventMatch,
  startEvent,
} from '../lib/multiplayer';

const TOKEN_STORAGE_KEY = 'magicbrains_event_organizer_tokens_v1';

const formatLabels: Record<EventFormat, string> = {
  swiss: 'Swiss',
  single_elim: 'Single elimination',
  round_robin: 'Round robin',
  league: 'League',
  draft: 'Draft',
  sealed: 'Sealed',
};

const formatNotes: Record<EventFormat, string> = {
  swiss: 'Score-based pairings with tiebreakers.',
  single_elim: 'Winners advance until one player remains.',
  round_robin: 'Every player is paired through the field.',
  league: 'Open-ended rounds for recurring play.',
  draft: 'Draft pod setup, pairings, tables, and standings.',
  sealed: 'Sealed pool setup, pairings, tables, and standings.',
};

const eventFormats: EventFormat[] = ['swiss', 'single_elim', 'round_robin', 'league', 'draft', 'sealed'];

function readOrganizerTokens(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveOrganizerToken(eventId: string, token: string) {
  const tokens = readOrganizerTokens();
  tokens[eventId] = token;
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function eventPath(eventId: string) {
  return `/events/${eventId}`;
}

function roomPath(roomId: string) {
  return `/multiplayer/${roomId}`;
}

function publicUrl(path: string) {
  return `${window.location.origin}${path}`;
}

function copyText(text: string) {
  return navigator.clipboard?.writeText(text);
}

function currentRoundMatches(event: EventDetail) {
  return event.matches
    .filter((match) => match.round === event.current_round)
    .sort((a, b) => a.table - b.table);
}

export function EventCenterPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [organizerToken, setOrganizerToken] = useState('');
  const [tokenEntry, setTokenEntry] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [createForm, setCreateForm] = useState({
    name: '',
    organizer_name: '',
    format: 'swiss' as EventFormat,
    public: true,
    rounds: 3,
    max_players: 16,
    match_wins_required: 2,
    round_minutes: 50,
    allow_spectators: true,
    prize_note: '',
    recurring_rule: '',
  });
  const [registration, setRegistration] = useState({ player_name: '', deck_name: '' });
  const [announcement, setAnnouncement] = useState('');
  const [replayIds, setReplayIds] = useState<Record<string, string>>({});
  const [highlights, setHighlights] = useState<Record<string, string>>({});

  const organizerReady = Boolean(event && organizerToken);
  const roundMatches = useMemo(() => (event ? currentRoundMatches(event) : []), [event]);
  const openMatches = useMemo(() => roundMatches.filter((match) => match.status !== 'reported' && !match.is_bye), [roundMatches]);

  async function loadData(activeEventId = eventId) {
    setLoading(true);
    setError('');
    try {
      const listed = await listEvents({ includePrivate: true });
      setEvents(listed);
      if (activeEventId) {
        const detail = await getEvent(activeEventId);
        setEvent(detail);
        const storedToken = readOrganizerTokens()[activeEventId] || '';
        setOrganizerToken(storedToken);
        setTokenEntry(storedToken);
      } else {
        setEvent(null);
        setOrganizerToken('');
        setTokenEntry('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Event Center failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData(eventId);
  }, [eventId]);

  async function runTask(task: () => Promise<EventDetail | void>, success: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const updated = await task();
      if (updated) setEvent(updated);
      setMessage(success);
      if (eventId) {
        const listed = await listEvents({ includePrivate: true });
        setEvents(listed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function onCreateEvent(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const created = await createEvent({
        name: createForm.name,
        organizer_name: createForm.organizer_name,
        format: createForm.format,
        public: createForm.public,
        settings: {
          rounds: Number(createForm.rounds),
          max_players: Number(createForm.max_players),
          match_wins_required: Number(createForm.match_wins_required),
          round_minutes: Number(createForm.round_minutes),
          allow_spectators: createForm.allow_spectators,
          prize_note: createForm.prize_note,
          recurring_rule: createForm.recurring_rule,
        },
      });
      saveOrganizerToken(created.event.id, created.organizer_token);
      setOrganizerToken(created.organizer_token);
      setEvent(created.event);
      setMessage('Event created. Organizer controls are unlocked in this browser.');
      navigate(eventPath(created.event.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create event');
    } finally {
      setBusy(false);
    }
  }

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    if (!event) return;
    await runTask(
      () => registerEventPlayer(event.id, { player_name: registration.player_name, deck_name: registration.deck_name }),
      'Player registered.',
    );
    setRegistration({ player_name: '', deck_name: '' });
  }

  function unlockOrganizer(e: FormEvent) {
    e.preventDefault();
    if (!event || !tokenEntry.trim()) return;
    saveOrganizerToken(event.id, tokenEntry.trim());
    setOrganizerToken(tokenEntry.trim());
    setMessage('Organizer token saved in this browser.');
    setError('');
  }

  async function onStartEvent() {
    if (!event) return;
    await runTask(() => startEvent(event.id, organizerToken), 'Event started and pairings posted.');
  }

  async function onPairNext() {
    if (!event) return;
    await runTask(() => pairNextEventRound(event.id, organizerToken), 'Next round paired.');
  }

  async function onPostAnnouncement(e: FormEvent) {
    e.preventDefault();
    if (!event) return;
    await runTask(() => postEventAnnouncement(event.id, organizerToken, announcement), 'Announcement posted.');
    setAnnouncement('');
  }

  async function onCreateTable(match: EventMatch) {
    if (!event) return;
    await runTask(async () => {
      const result = await createEventMatchRoom(event.id, match.id, organizerToken);
      setMessage(`Table ${match.table} room ready: ${result.room_id}`);
      return result.event;
    }, 'Table room created.');
  }

  async function onReport(match: EventMatch, p1: number, p2: number) {
    if (!event) return;
    await runTask(
      () =>
        reportEventMatch(event.id, match.id, {
          organizer_token: organizerToken,
          player1_wins: p1,
          player2_wins: p2,
          replay_room_id: replayIds[match.id]?.trim() || undefined,
          highlight: highlights[match.id]?.trim() || undefined,
        }),
      `Result reported for round ${match.round}, table ${match.table}.`,
    );
  }

  const eventList = (
    <section className="border-y border-stone-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-8 sm:px-6 lg:grid-cols-3">
        {events.length === 0 && (
          <div className="rounded-lg border border-dashed border-stone-300 p-5 text-sm text-stone-600 lg:col-span-3">
            No events yet. Create the first one when you are ready to test an organized pod.
          </div>
        )}
        {events.map((item) => (
          <Link
            key={item.id}
            to={eventPath(item.id)}
            className="min-w-0 rounded-lg border border-stone-200 bg-stone-50 p-4 transition hover:border-amber-300 hover:bg-amber-50"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-serif text-xl font-bold text-stone-950">{item.name}</div>
                <div className="mt-1 text-sm font-semibold text-stone-600">
                  {formatLabels[item.format]} · {item.player_count} players
                </div>
              </div>
              <span className="rounded-full border border-stone-300 px-2 py-1 text-xs font-bold uppercase text-stone-600">
                {item.status}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs font-bold text-stone-600">
              <span className="rounded bg-white p-2">R{item.current_round || 0}</span>
              <span className="rounded bg-white p-2">{item.total_rounds} rounds</span>
              <span className="rounded bg-white p-2">{item.public ? 'Public' : 'Private'}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );

  return (
    <div className="min-h-screen bg-[#f5f0e8] text-stone-950">
      <header className="border-b border-stone-800 bg-stone-950 text-stone-50">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-amber-300/40 bg-amber-300/10">
              <Crown className="h-5 w-5 text-amber-200" />
            </span>
            <span className="truncate font-serif text-lg font-bold">Magic Brains Events</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              to="/multiplayer"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg px-3 text-sm font-bold text-stone-200 hover:bg-white/10"
            >
              <Users className="h-4 w-4" />
              Rooms
            </Link>
            {event && (
              <Link
                to="/events"
                className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-amber-300 px-3 text-sm font-black text-stone-950"
              >
                <ArrowLeft className="h-4 w-4" />
                Event List
              </Link>
            )}
          </div>
        </nav>
      </header>

      <main>
        <section className="bg-stone-950 px-4 py-10 text-stone-50 sm:px-6">
          <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_380px] lg:items-end">
            <div>
              <div className="inline-flex items-center gap-2 rounded-lg border border-amber-200/30 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-amber-100">
                <Shield className="h-4 w-4" />
                Events, drafts, and match rooms
              </div>
              <h1 className="mt-5 max-w-3xl font-serif text-4xl font-bold leading-tight sm:text-6xl">
                {event ? event.name : 'Run organized Commander practice without a side spreadsheet.'}
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-stone-300">
                {event
                  ? `${formatLabels[event.format]} event managed by ${event.organizer_name}. Pairings, standings, table rooms, and highlights stay together here.`
                  : 'Create events, seat players, post pairings, open table rooms, report results, and attach replay highlights from one organizer surface.'}
              </p>
            </div>
            {!event ? (
              <form className="rounded-lg border border-white/10 bg-white/[0.06] p-4" onSubmit={onCreateEvent} data-testid="event-create-form">
                <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em] text-amber-100">
                  <Plus className="h-4 w-4" />
                  Create Event
                </div>
                <div className="grid gap-3">
                  <input
                    className="min-h-[42px] rounded-lg border border-white/15 bg-stone-900 px-3 text-sm text-stone-50 outline-none focus:border-amber-300"
                    placeholder="Event name"
                    value={createForm.name}
                    onChange={(e) => setCreateForm((form) => ({ ...form, name: e.target.value }))}
                    required
                  />
                  <input
                    className="min-h-[42px] rounded-lg border border-white/15 bg-stone-900 px-3 text-sm text-stone-50 outline-none focus:border-amber-300"
                    placeholder="Organizer name"
                    value={createForm.organizer_name}
                    onChange={(e) => setCreateForm((form) => ({ ...form, organizer_name: e.target.value }))}
                    required
                  />
                  <select
                    className="min-h-[42px] rounded-lg border border-white/15 bg-stone-900 px-3 text-sm text-stone-50 outline-none focus:border-amber-300"
                    value={createForm.format}
                    onChange={(e) => setCreateForm((form) => ({ ...form, format: e.target.value as EventFormat }))}
                  >
                    {eventFormats.map((format) => (
                      <option key={format} value={format}>
                        {formatLabels[format]}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-bold uppercase tracking-[0.1em] text-stone-300">
                      Rounds
                      <input
                        className="mt-1 min-h-[42px] w-full rounded-lg border border-white/15 bg-stone-900 px-3 text-sm text-stone-50 outline-none focus:border-amber-300"
                        type="number"
                        min={1}
                        max={12}
                        value={createForm.rounds}
                        onChange={(e) => setCreateForm((form) => ({ ...form, rounds: Number(e.target.value) }))}
                      />
                    </label>
                    <label className="text-xs font-bold uppercase tracking-[0.1em] text-stone-300">
                      Max players
                      <input
                        className="mt-1 min-h-[42px] w-full rounded-lg border border-white/15 bg-stone-900 px-3 text-sm text-stone-50 outline-none focus:border-amber-300"
                        type="number"
                        min={2}
                        max={64}
                        value={createForm.max_players}
                        onChange={(e) => setCreateForm((form) => ({ ...form, max_players: Number(e.target.value) }))}
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-bold uppercase tracking-[0.1em] text-stone-300">
                      Match wins
                      <input
                        className="mt-1 min-h-[42px] w-full rounded-lg border border-white/15 bg-stone-900 px-3 text-sm text-stone-50 outline-none focus:border-amber-300"
                        type="number"
                        min={1}
                        max={3}
                        value={createForm.match_wins_required}
                        onChange={(e) => setCreateForm((form) => ({ ...form, match_wins_required: Number(e.target.value) }))}
                      />
                    </label>
                    <label className="text-xs font-bold uppercase tracking-[0.1em] text-stone-300">
                      Minutes
                      <input
                        className="mt-1 min-h-[42px] w-full rounded-lg border border-white/15 bg-stone-900 px-3 text-sm text-stone-50 outline-none focus:border-amber-300"
                        type="number"
                        min={10}
                        max={180}
                        value={createForm.round_minutes}
                        onChange={(e) => setCreateForm((form) => ({ ...form, round_minutes: Number(e.target.value) }))}
                      />
                    </label>
                  </div>
                  <input
                    className="min-h-[42px] rounded-lg border border-white/15 bg-stone-900 px-3 text-sm text-stone-50 outline-none focus:border-amber-300"
                    placeholder="Prize note"
                    value={createForm.prize_note}
                    onChange={(e) => setCreateForm((form) => ({ ...form, prize_note: e.target.value }))}
                  />
                  <input
                    className="min-h-[42px] rounded-lg border border-white/15 bg-stone-900 px-3 text-sm text-stone-50 outline-none focus:border-amber-300"
                    placeholder="Recurring rule, e.g. Weekly Friday league"
                    value={createForm.recurring_rule}
                    onChange={(e) => setCreateForm((form) => ({ ...form, recurring_rule: e.target.value }))}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex min-h-[42px] items-center gap-2 rounded-lg border border-white/15 bg-stone-900 px-3 text-sm font-bold text-stone-200">
                      <input
                        type="checkbox"
                        checked={createForm.allow_spectators}
                        onChange={(e) => setCreateForm((form) => ({ ...form, allow_spectators: e.target.checked }))}
                      />
                      Spectators
                    </label>
                    <label className="flex min-h-[42px] items-center gap-2 rounded-lg border border-white/15 bg-stone-900 px-3 text-sm font-bold text-stone-200">
                      <input
                        type="checkbox"
                        checked={createForm.public}
                        onChange={(e) => setCreateForm((form) => ({ ...form, public: e.target.checked }))}
                      />
                      Public
                    </label>
                  </div>
                  <button
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-amber-300 px-4 text-sm font-black text-stone-950 hover:bg-amber-200 disabled:opacity-50"
                    disabled={busy}
                    type="submit"
                  >
                    <Plus className="h-4 w-4" />
                    Create Event
                  </button>
                </div>
              </form>
            ) : (
              <div className="rounded-lg border border-white/10 bg-white/[0.06] p-4" data-testid="event-hero-summary">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border border-white/10 bg-stone-900 p-3">
                    <div className="text-xs font-black uppercase tracking-[0.12em] text-stone-400">Players</div>
                    <div className="mt-2 text-xl font-black text-stone-50">{event.player_count}/{event.settings.max_players}</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-stone-900 p-3">
                    <div className="text-xs font-black uppercase tracking-[0.12em] text-stone-400">Status</div>
                    <div className="mt-2 text-xl font-black text-stone-50">{event.status}</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-stone-900 p-3">
                    <div className="text-xs font-black uppercase tracking-[0.12em] text-stone-400">Round</div>
                    <div className="mt-2 text-xl font-black text-stone-50">{event.current_round || 0}/{event.total_rounds}</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-stone-900 p-3">
                    <div className="text-xs font-black uppercase tracking-[0.12em] text-stone-400">Tables</div>
                    <div className="mt-2 text-xl font-black text-stone-50">{roundMatches.length}</div>
                  </div>
                </div>
                <button
                  className="mt-3 inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-amber-300 px-3 text-sm font-black text-stone-950"
                  onClick={() => copyText(publicUrl(eventPath(event.id)))}
                  type="button"
                >
                  <Copy className="h-4 w-4" />
                  Copy Event Link
                </button>
              </div>
            )}
          </div>
        </section>

        {(message || error) && (
          <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
            {message && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900" data-testid="event-success">
                {message}
              </div>
            )}
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900" data-testid="event-error">
                {error}
              </div>
            )}
          </div>
        )}

        {!event && eventList}

        {loading && (
          <div className="mx-auto max-w-6xl px-4 py-8 text-sm font-semibold text-stone-600 sm:px-6">Loading Event Center...</div>
        )}

        {event && !loading && (
          <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0 space-y-6">
                <div className="rounded-lg border border-stone-200 bg-white p-5" data-testid="event-detail">
                  <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-stone-950 px-3 py-1 text-xs font-black uppercase text-stone-50">
                          {formatLabels[event.format]}
                        </span>
                        <span className="rounded-full border border-stone-300 px-3 py-1 text-xs font-black uppercase text-stone-600">
                          {event.status}
                        </span>
                        <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-black uppercase text-amber-900">
                          Round {event.current_round || 0}/{event.total_rounds}
                        </span>
                      </div>
                      <h2 className="mt-4 font-serif text-3xl font-bold leading-tight text-stone-950 sm:text-4xl">{event.name}</h2>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">{formatNotes[event.format]}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-stone-300 px-3 text-sm font-bold hover:bg-stone-50"
                        onClick={() => copyText(publicUrl(eventPath(event.id)))}
                        type="button"
                      >
                        <Copy className="h-4 w-4" />
                        Copy Event
                      </button>
                      <button
                        className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-stone-300 px-3 text-sm font-bold hover:bg-stone-50"
                        onClick={() => loadData(event.id)}
                        type="button"
                      >
                        <RefreshCw className="h-4 w-4" />
                        Refresh
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Metric label="Players" value={`${event.player_count}/${event.settings.max_players}`} />
                    <Metric label="Match Target" value={`Best of ${event.settings.match_wins_required * 2 - 1}`} />
                    <Metric label="Round Clock" value={`${event.settings.round_minutes}m`} />
                    <Metric label="Spectators" value={event.settings.allow_spectators ? 'Allowed' : 'Closed'} />
                  </div>

                  {(event.settings.prize_note || event.settings.recurring_rule) && (
                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                      {event.settings.prize_note && <NoteBlock title="Prize Structure" body={event.settings.prize_note} />}
                      {event.settings.recurring_rule && <NoteBlock title="Recurring Event" body={event.settings.recurring_rule} />}
                    </div>
                  )}
                </div>

                {event.format === 'draft' && event.draft_pods.length > 0 && (
                  <EventPanel title="Draft Pods" icon={<Users className="h-4 w-4" />}>
                    <div className="grid gap-3 md:grid-cols-2">
                      {event.draft_pods.map((pod) => (
                        <div key={pod.id} className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-bold text-stone-950">{pod.name}</div>
                            <span className="rounded-full bg-white px-2 py-1 text-xs font-bold uppercase text-stone-600">{pod.status}</span>
                          </div>
                          <div className="mt-2 text-sm text-stone-600">{pod.packs_per_player} packs per player · {pod.seeding_note}</div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {pod.player_names.map((name) => (
                              <span key={name} className="rounded-full border border-stone-300 bg-white px-2 py-1 text-xs font-bold text-stone-700">
                                {name}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </EventPanel>
                )}

                {event.format === 'sealed' && event.sealed_pools.length > 0 && (
                  <EventPanel title="Sealed Pools" icon={<Lock className="h-4 w-4" />}>
                    <div className="grid gap-3 md:grid-cols-3">
                      {event.sealed_pools.map((pool) => (
                        <div key={pool.player_id} className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                          <div className="font-bold text-stone-950">{pool.player_name}</div>
                          <div className="mt-1 text-sm text-stone-600">{pool.pool_label}</div>
                          <div className="mt-3 rounded-full bg-white px-2 py-1 text-xs font-bold uppercase text-stone-600">{pool.status}</div>
                        </div>
                      ))}
                    </div>
                  </EventPanel>
                )}

                <EventPanel title="Pairings And Match Rooms" icon={<Swords className="h-4 w-4" />}>
                  {event.status === 'setup' && (
                    <div className="rounded-lg border border-dashed border-stone-300 p-4 text-sm text-stone-600">
                      Pairings appear here after the organizer starts the event.
                    </div>
                  )}
                  {event.status !== 'setup' && (
                    <div className="space-y-3" data-testid="event-pairings">
                      {roundMatches.map((match) => (
                        <div key={match.id} className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                            <div className="min-w-0">
                              <div className="text-xs font-black uppercase tracking-[0.14em] text-stone-500">
                                Round {match.round} · Table {match.table}
                              </div>
                              <div className="mt-2 text-lg font-black text-stone-950">
                                {match.player1_name} {match.is_bye ? 'has a bye' : `vs ${match.player2_name}`}
                              </div>
                              <div className="mt-1 text-sm text-stone-600">
                                {match.status === 'reported'
                                  ? `Reported ${match.game_wins[match.player1_id] ?? 0}-${match.player2_id ? match.game_wins[match.player2_id] ?? 0 : 0}`
                                  : 'Open result'}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {match.room_id ? (
                                <>
                                  <Link
                                    className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-stone-950 px-3 text-sm font-black text-stone-50 hover:bg-stone-800"
                                    to={roomPath(match.room_id)}
                                  >
                                    <Swords className="h-4 w-4" />
                                    Open Table
                                  </Link>
                                  <button
                                    className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-stone-300 px-3 text-sm font-bold hover:bg-white"
                                    onClick={() => match.room_id && copyText(publicUrl(roomPath(match.room_id)))}
                                    type="button"
                                  >
                                    <Copy className="h-4 w-4" />
                                    Copy Table
                                  </button>
                                </>
                              ) : (
                                organizerReady &&
                                !match.is_bye && (
                                  <button
                                    className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-stone-950 px-3 text-sm font-black text-stone-50 hover:bg-stone-800 disabled:opacity-50"
                                    disabled={busy}
                                    onClick={() => onCreateTable(match)}
                                    type="button"
                                  >
                                    <Plus className="h-4 w-4" />
                                    Create Table
                                  </button>
                                )
                              )}
                            </div>
                          </div>

                          {organizerReady && !match.is_bye && match.status !== 'reported' && (
                            <div className="mt-4 space-y-3">
                              <div className="grid gap-2 sm:grid-cols-2">
                                <input
                                  className="min-h-[40px] rounded-lg border border-stone-300 px-3 text-sm outline-none focus:border-amber-400"
                                  placeholder="Replay room id"
                                  value={replayIds[match.id] || ''}
                                  onChange={(e) => setReplayIds((items) => ({ ...items, [match.id]: e.target.value }))}
                                />
                                <input
                                  className="min-h-[40px] rounded-lg border border-stone-300 px-3 text-sm outline-none focus:border-amber-400"
                                  placeholder="Highlight note"
                                  value={highlights[match.id] || ''}
                                  onChange={(e) => setHighlights((items) => ({ ...items, [match.id]: e.target.value }))}
                                />
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button className="min-h-[40px] rounded-lg bg-emerald-700 px-3 text-sm font-black text-white" onClick={() => onReport(match, 2, 0)} type="button">
                                  {match.player1_name} 2-0
                                </button>
                                <button className="min-h-[40px] rounded-lg bg-emerald-700 px-3 text-sm font-black text-white" onClick={() => onReport(match, 2, 1)} type="button">
                                  {match.player1_name} 2-1
                                </button>
                                <button className="min-h-[40px] rounded-lg bg-sky-700 px-3 text-sm font-black text-white" onClick={() => onReport(match, 1, 1)} type="button">
                                  Draw
                                </button>
                                <button className="min-h-[40px] rounded-lg bg-rose-700 px-3 text-sm font-black text-white" onClick={() => onReport(match, 1, 2)} type="button">
                                  {match.player2_name} 2-1
                                </button>
                                <button className="min-h-[40px] rounded-lg bg-rose-700 px-3 text-sm font-black text-white" onClick={() => onReport(match, 0, 2)} type="button">
                                  {match.player2_name} 2-0
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </EventPanel>

                <EventPanel title="Standings" icon={<Crown className="h-4 w-4" />}>
                  <div className="overflow-x-auto" data-testid="event-standings">
                    <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-stone-200 text-xs font-black uppercase tracking-[0.12em] text-stone-500">
                          <th className="py-2 pr-3">Rank</th>
                          <th className="py-2 pr-3">Player</th>
                          <th className="py-2 pr-3">Match</th>
                          <th className="py-2 pr-3">Games</th>
                          <th className="py-2 pr-3">Points</th>
                          <th className="py-2 pr-3">OMW</th>
                          <th className="py-2 pr-3">GWP</th>
                          <th className="py-2 pr-3">OGW</th>
                        </tr>
                      </thead>
                      <tbody>
                        {event.standings.length === 0 && (
                          <tr>
                            <td className="py-4 text-stone-600" colSpan={8}>
                              Standings appear after players register.
                            </td>
                          </tr>
                        )}
                        {event.standings.map((standing) => (
                          <tr key={standing.player_id} className="border-b border-stone-100">
                            <td className="py-3 pr-3 font-black">{standing.rank}</td>
                            <td className="py-3 pr-3 font-bold">{standing.player_name}</td>
                            <td className="py-3 pr-3">
                              {standing.match_wins}-{standing.match_losses}-{standing.match_draws}
                            </td>
                            <td className="py-3 pr-3">
                              {standing.game_wins}-{standing.game_losses}-{standing.game_draws}
                            </td>
                            <td className="py-3 pr-3 font-black">{standing.match_points}</td>
                            <td className="py-3 pr-3">{percent(standing.omw)}</td>
                            <td className="py-3 pr-3">{percent(standing.gwp)}</td>
                            <td className="py-3 pr-3">{percent(standing.ogw)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </EventPanel>
              </div>

              <aside className="space-y-5 xl:sticky xl:top-4 xl:self-start">
                <EventPanel title="Register Player" icon={<Users className="h-4 w-4" />}>
                  <form className="space-y-3" onSubmit={onRegister} data-testid="event-register-form">
                    <input
                      className="min-h-[42px] w-full rounded-lg border border-stone-300 px-3 text-sm outline-none focus:border-amber-400"
                      placeholder="Player name"
                      value={registration.player_name}
                      onChange={(e) => setRegistration((form) => ({ ...form, player_name: e.target.value }))}
                      disabled={event.status !== 'setup'}
                      required
                    />
                    <input
                      className="min-h-[42px] w-full rounded-lg border border-stone-300 px-3 text-sm outline-none focus:border-amber-400"
                      placeholder="Deck name"
                      value={registration.deck_name}
                      onChange={(e) => setRegistration((form) => ({ ...form, deck_name: e.target.value }))}
                      disabled={event.status !== 'setup'}
                    />
                    <button
                      className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-stone-950 px-3 text-sm font-black text-white disabled:opacity-50"
                      disabled={busy || event.status !== 'setup'}
                      type="submit"
                    >
                      <Plus className="h-4 w-4" />
                      Register
                    </button>
                  </form>
                </EventPanel>

                <EventPanel title="Organizer Controls" icon={<Lock className="h-4 w-4" />}>
                  {!organizerReady && (
                    <form className="space-y-3" onSubmit={unlockOrganizer}>
                      <input
                        className="min-h-[42px] w-full rounded-lg border border-stone-300 px-3 text-sm outline-none focus:border-amber-400"
                        placeholder="Organizer token"
                        value={tokenEntry}
                        onChange={(e) => setTokenEntry(e.target.value)}
                      />
                      <button className="min-h-[42px] w-full rounded-lg border border-stone-300 px-3 text-sm font-black" type="submit">
                        Unlock Organizer
                      </button>
                    </form>
                  )}
                  {organizerReady && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900">
                        <Check className="h-4 w-4" />
                        Organizer unlocked
                      </div>
                      <button
                        className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-amber-300 px-3 text-sm font-black text-stone-950 disabled:opacity-50"
                        disabled={busy || event.status !== 'setup' || event.players.length < 2}
                        onClick={onStartEvent}
                        type="button"
                      >
                        <Swords className="h-4 w-4" />
                        Start Event
                      </button>
                      <button
                        className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-stone-950 px-3 text-sm font-black text-white disabled:opacity-50"
                        disabled={busy || event.status !== 'running' || openMatches.length > 0}
                        onClick={onPairNext}
                        type="button"
                      >
                        <RefreshCw className="h-4 w-4" />
                        Pair Next Round
                      </button>
                      <form className="space-y-2" onSubmit={onPostAnnouncement} data-testid="event-announcement-form">
                        <textarea
                          className="min-h-[88px] w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-amber-400"
                          placeholder="Organizer announcement"
                          value={announcement}
                          onChange={(e) => setAnnouncement(e.target.value)}
                        />
                        <button
                          className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg border border-stone-300 px-3 text-sm font-black disabled:opacity-50"
                          disabled={busy || !announcement.trim()}
                          type="submit"
                        >
                          <MessageSquare className="h-4 w-4" />
                          Post Announcement
                        </button>
                      </form>
                    </div>
                  )}
                </EventPanel>

                <EventPanel title="Players" icon={<Users className="h-4 w-4" />}>
                  <div className="space-y-2">
                    {event.players.map((player) => (
                      <div key={player.id} className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
                        <div className="font-bold text-stone-950">{player.name}</div>
                        <div className="text-sm text-stone-600">{player.deck_name || 'Deck not named'}</div>
                      </div>
                    ))}
                    {event.players.length === 0 && <div className="text-sm text-stone-600">No players registered yet.</div>}
                  </div>
                </EventPanel>

                <EventPanel title="Spectator And Stream Tools" icon={<Eye className="h-4 w-4" />}>
                  <div className="space-y-3 text-sm leading-6 text-stone-600">
                    <p>Share the event link for public pairings and standings. Table links open room pages with spectator access when enabled.</p>
                    <button
                      className="inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg border border-stone-300 px-3 text-sm font-black"
                      onClick={() => copyText(publicUrl(eventPath(event.id)))}
                      type="button"
                    >
                      <Copy className="h-4 w-4" />
                      Copy Public Event Link
                    </button>
                  </div>
                </EventPanel>

                <EventPanel title="Announcements" icon={<MessageSquare className="h-4 w-4" />}>
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1" data-testid="event-announcements">
                    {event.announcements.map((item) => (
                      <div key={item.id} className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
                        <div className="font-semibold text-stone-900">{item.message}</div>
                        <div className="mt-1 text-xs text-stone-500">{new Date(item.created_at).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                </EventPanel>

                <EventPanel title="Replay Highlights" icon={<Shield className="h-4 w-4" />}>
                  <div className="space-y-2" data-testid="event-highlights">
                    {event.highlights.map((highlight) => (
                      <div key={highlight.id} className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
                        <div className="font-bold text-stone-950">R{highlight.round} Table {highlight.table}</div>
                        <div className="mt-1 text-stone-700">{highlight.message}</div>
                        {highlight.replay_room_id && (
                          <Link className="mt-2 inline-flex font-bold text-amber-800" to={`/multiplayer/${highlight.replay_room_id}?review=1`}>
                            Open replay
                          </Link>
                        )}
                      </div>
                    ))}
                    {event.highlights.length === 0 && <div className="text-sm text-stone-600">Highlights appear when results include a note.</div>}
                  </div>
                </EventPanel>
              </aside>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
      <div className="text-xs font-black uppercase tracking-[0.12em] text-stone-500">{label}</div>
      <div className="mt-2 text-lg font-black text-stone-950">{value}</div>
    </div>
  );
}

function NoteBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
      <div className="text-xs font-black uppercase tracking-[0.12em] text-stone-500">{title}</div>
      <div className="mt-2 text-sm leading-6 text-stone-700">{body}</div>
    </div>
  );
}

function EventPanel({ title, icon, children }: { title: string; icon: JSX.Element; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em] text-stone-700">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}
