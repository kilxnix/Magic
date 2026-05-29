import { Link } from 'react-router-dom';
import {
  Brain,
  BookOpen,
  Swords,
  Sparkles,
  Shield,
  Trophy,
  TrendingDown,
  Users,
} from 'lucide-react';
import { SafeAdBand } from '../components/SafeAdBand';

const manaRunes = ['W', 'U', 'B', 'R', 'G'];

const signalStats = [
  { label: 'Deck sources', value: 'Grab', detail: 'import a list or use a practice deck' },
  { label: 'Beta AI reps', value: '1-3', detail: 'practice against early solo opponents' },
  { label: 'Play-by-play', value: 'Review', detail: 'review with heuristic feedback' },
];

const features = [
  {
    icon: Sparkles,
    title: 'Bring Or Grab A Deck',
    body: 'Paste a deck URL, import list text, or use a platform-supplied practice deck when you just want reps.',
  },
  {
    icon: Swords,
    title: 'Run Practice Sessions',
    body: 'Try practice turns in the browser while rules coverage is still expanding.',
  },
  {
    icon: Brain,
    title: 'Study The Game',
    body: 'After the game, review a play-by-play timeline with early move ratings and coaching notes.',
  },
];

const gradingRows = [
  { turn: 'T2', move: 'Played ramp before threat', grade: 'Good', tone: 'text-sky-200' },
  { turn: 'T4', move: 'Held removal for commander', grade: 'Excellent', tone: 'text-emerald-200' },
  { turn: 'T6', move: 'Attacked into blockers', grade: 'Bad', tone: 'text-red-200' },
];

export function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f7f3ea] text-stone-950">
      <header className="fixed inset-x-0 top-0 z-30 border-b border-white/10 bg-[#14110f]/80 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-3 text-stone-50" aria-label="Magic Brains home">
            <span className="grid h-9 w-9 place-items-center rounded-lg border border-amber-300/40 bg-amber-300/10">
              <Brain className="h-5 w-5 text-amber-200" />
            </span>
            <span className="font-serif text-base font-bold sm:text-lg">Magic Brains</span>
          </Link>

          <div className="flex items-center gap-2">
            <Link
              to="/how-training-works"
              className="hidden min-h-[40px] items-center gap-2 rounded-lg px-3 text-sm font-semibold text-stone-200 transition hover:bg-white/10 md:inline-flex"
            >
              <BookOpen className="h-4 w-4" />
              How It Works
            </Link>
            <Link
              to="/play"
              className="hidden min-h-[40px] items-center gap-2 rounded-lg px-3 text-sm font-semibold text-stone-200 transition hover:bg-white/10 sm:inline-flex"
            >
              <Swords className="h-4 w-4" />
              Practice
            </Link>
            <Link
              to="/multiplayer"
              className="hidden min-h-[40px] items-center gap-2 rounded-lg px-3 text-sm font-semibold text-stone-200 transition hover:bg-white/10 lg:inline-flex"
            >
              <Users className="h-4 w-4" />
              Rooms
            </Link>
            <Link
              to="/events"
              className="hidden min-h-[40px] items-center gap-2 rounded-lg px-3 text-sm font-semibold text-stone-200 transition hover:bg-white/10 lg:inline-flex"
            >
              <Trophy className="h-4 w-4" />
              Events
            </Link>
            <Link
              to="/play"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-amber-300 px-3 text-sm font-bold text-stone-950 transition hover:bg-amber-200 sm:px-4"
            >
              <Swords className="h-4 w-4" />
              <span className="hidden sm:inline">Open Practice</span>
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="relative isolate flex min-h-[88svh] items-start overflow-hidden bg-[#17120f] px-4 pb-10 pt-24 text-stone-50 sm:items-center sm:px-6 sm:pb-16 lg:min-h-[86svh]">
          <div className="absolute inset-0" aria-hidden="true">
            <div className="absolute inset-0 bg-[#1b1511]" />
            <div className="absolute left-1/2 top-1/2 h-[720px] w-[1120px] -translate-x-1/2 -translate-y-1/2 rotate-[-6deg] rounded-[28px] border border-amber-200/10 bg-[#24352b] shadow-2xl shadow-black/40" />
            <div className="absolute left-[8%] top-[20%] hidden h-36 w-24 rotate-[-13deg] rounded-lg border border-amber-200/20 bg-[#f2e7cf] shadow-2xl shadow-black/40 sm:block">
              <div className="m-2 h-16 rounded bg-[#6a2f2a]" />
              <div className="mx-2 mt-2 h-2 rounded bg-stone-900/20" />
              <div className="mx-2 mt-1 h-2 rounded bg-stone-900/20" />
            </div>
            <div className="absolute right-[9%] top-[24%] hidden h-36 w-24 rotate-[12deg] rounded-lg border border-sky-100/20 bg-[#eef4f1] shadow-2xl shadow-black/40 md:block">
              <div className="m-2 h-16 rounded bg-[#315d70]" />
              <div className="mx-2 mt-2 h-2 rounded bg-stone-900/20" />
              <div className="mx-2 mt-1 h-2 rounded bg-stone-900/20" />
            </div>
            <div className="absolute bottom-[9%] left-[12%] hidden h-36 w-24 rotate-[8deg] rounded-lg border border-emerald-100/20 bg-[#edf3e6] shadow-2xl shadow-black/40 lg:block">
              <div className="m-2 h-16 rounded bg-[#426b45]" />
              <div className="mx-2 mt-2 h-2 rounded bg-stone-900/20" />
              <div className="mx-2 mt-1 h-2 rounded bg-stone-900/20" />
            </div>
            <div className="absolute bottom-[16%] right-[16%] hidden h-36 w-24 rotate-[-9deg] rounded-lg border border-red-100/20 bg-[#f2e9df] shadow-2xl shadow-black/40 lg:block">
              <div className="m-2 h-16 rounded bg-[#8b3b2e]" />
              <div className="mx-2 mt-2 h-2 rounded bg-stone-900/20" />
              <div className="mx-2 mt-1 h-2 rounded bg-stone-900/20" />
            </div>

            <div className="absolute inset-x-4 bottom-6 mx-auto hidden max-w-5xl overflow-hidden rounded-lg border border-white/10 bg-stone-950/70 p-3 shadow-2xl shadow-black/50 backdrop-blur sm:block md:bottom-12 md:p-4">
              <div className="grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-lg border border-white/10 bg-stone-900/80 p-3">
                  <div className="mb-3 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-amber-200">Deck Source</div>
                      <div className="mt-1 text-sm font-semibold text-stone-100">Atraxa Superfriends</div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {manaRunes.map((rune) => (
                        <span key={rune} className="grid h-7 w-7 place-items-center rounded-full bg-stone-100 text-xs font-black text-stone-900">
                          {rune}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {['Ramp', 'Draw', 'Removal', 'Wincons'].map((label, index) => (
                      <div key={label} className="rounded border border-white/10 bg-white/[0.06] p-2">
                        <div className="text-[10px] font-semibold uppercase text-stone-400">{label}</div>
                        <div className="mt-2 h-2 rounded bg-amber-200/70" style={{ width: `${72 + index * 6}%` }} />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="hidden rounded-lg border border-white/10 bg-stone-900/80 p-3 md:block">
                  <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">Turn Review</div>
                  <div className="space-y-2">
                    {gradingRows.map((row) => (
                      <div key={row.turn} className="grid grid-cols-[36px_1fr_auto] items-center gap-2 rounded border border-white/10 bg-white/[0.05] px-2 py-2 text-xs">
                        <span className="font-mono text-stone-400">{row.turn}</span>
                        <span className="truncate text-stone-200">{row.move}</span>
                        <span className={`font-bold ${row.tone}`}>{row.grade}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center text-center">
            <div className="mb-5 inline-flex max-w-full items-center gap-2 rounded-lg border border-amber-200/30 bg-stone-950/50 px-3 py-2 text-center text-[10px] font-bold uppercase leading-5 tracking-[0.14em] text-amber-100 backdrop-blur sm:text-xs sm:tracking-[0.18em]">
              <Shield className="h-4 w-4" />
              Deck practice and post-game review
            </div>
            <h1 className="max-w-4xl font-serif text-4xl font-bold leading-tight tracking-normal text-stone-50 sm:text-6xl lg:text-7xl">
              Magic Brains
            </h1>
            <p className="mt-5 max-w-[22rem] text-base leading-7 text-stone-200 sm:max-w-2xl sm:text-lg">
              Practice with your own MTG decks using early AI tools, then review the play-by-play.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
              <Link
                to="/play"
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-amber-300 px-6 text-sm font-black text-stone-950 shadow-xl shadow-black/30 transition hover:bg-amber-200 sm:w-auto"
              >
                <Swords className="h-5 w-5" />
                Practice a Deck
              </Link>
              <Link
                to="/multiplayer"
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-6 text-sm font-black text-stone-50 backdrop-blur transition hover:bg-white/15 sm:w-auto"
              >
                <Users className="h-5 w-5" />
                Host a Room
              </Link>
              <Link
                to="/events"
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg border border-amber-200/40 bg-amber-100/10 px-6 text-sm font-black text-amber-100 backdrop-blur transition hover:bg-amber-100/15 sm:w-auto"
              >
                <Trophy className="h-5 w-5" />
                Run an Event
              </Link>
            </div>

            <div className="mt-7 w-full max-w-sm overflow-hidden rounded-lg border border-white/10 bg-stone-950/70 p-3 text-left shadow-2xl shadow-black/40 backdrop-blur sm:hidden">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200">Deck Source</div>
                  <div className="mt-1 text-sm font-semibold text-stone-100">Atraxa Superfriends</div>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {manaRunes.map((rune) => (
                    <span key={rune} className="grid h-7 w-7 place-items-center rounded-full bg-stone-100 text-xs font-black text-stone-900">
                      {rune}
                    </span>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {['Ramp', 'Draw', 'Removal', 'Wincons'].map((label, index) => (
                  <div key={label} className="rounded border border-white/10 bg-white/[0.06] p-2">
                    <div className="text-[10px] font-semibold uppercase text-stone-400">{label}</div>
                    <div className="mt-2 h-2 rounded bg-amber-200/70" style={{ width: `${72 + index * 6}%` }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-stone-200 bg-[#f7f3ea] px-4 py-8 sm:px-6">
          <div className="mx-auto grid max-w-7xl gap-3 md:grid-cols-3">
            {signalStats.map((stat) => (
              <div key={stat.label} className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
                <div className="text-3xl font-black text-stone-950">{stat.value}</div>
                <div className="mt-2 text-sm font-bold text-stone-800">{stat.label}</div>
                <div className="mt-1 text-sm leading-6 text-stone-600">{stat.detail}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-3xl">
              <div className="text-sm font-black uppercase tracking-[0.18em] text-red-700">Launch Surface</div>
              <h2 className="mt-3 font-serif text-3xl font-bold text-stone-950 sm:text-4xl">
                Bring a deck, run a practice session, then study the turns.
              </h2>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {features.map((feature) => {
                const Icon = feature.icon;
                return (
                  <div key={feature.title} className="rounded-lg border border-stone-200 bg-[#fbfaf7] p-6 shadow-sm">
                    <div className="mb-5 grid h-11 w-11 place-items-center rounded-lg bg-stone-950 text-amber-200">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="text-lg font-black text-stone-950">{feature.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-stone-600">{feature.body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <SafeAdBand />

        <section className="bg-[#17120f] px-4 py-16 text-stone-50 sm:px-6">
          <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <div className="text-sm font-black uppercase tracking-[0.18em] text-emerald-200">Post-game Review</div>
              <h2 className="mt-3 font-serif text-3xl font-bold sm:text-4xl">A play-by-play for your decisions.</h2>
              <p className="mt-4 max-w-xl text-sm leading-7 text-stone-300">
                The current review uses heuristics from mana use, board state, attacks, counterplay, and resource snapshots. It compares decisions against available alternatives the current engine can see.
              </p>
            </div>

            <div className="rounded-lg border border-white/10 bg-stone-950 p-4 shadow-2xl shadow-black/30">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-stone-500">Post-game report</div>
                  <div className="mt-1 text-lg font-bold">Practice table</div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-black text-emerald-300">B</div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Review Confidence 82%</div>
                </div>
              </div>
              <div className="grid gap-2">
                {gradingRows.map((row) => (
                  <div key={row.move} className="grid grid-cols-[42px_1fr_auto] items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm">
                    <span className="font-mono text-stone-500">{row.turn}</span>
                    <span className="min-w-0 truncate text-stone-200">{row.move}</span>
                    <span className={`font-black ${row.tone}`}>{row.grade}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[#f7f3ea] px-4 py-14 sm:px-6">
          <div className="mx-auto flex max-w-7xl flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-stone-500">
                <Trophy className="h-4 w-4 text-amber-600" />
                Commander practice tool
              </div>
              <h2 className="mt-3 font-serif text-3xl font-bold text-stone-950">Bring a deck, run beta reps, study the lines.</h2>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                to="/how-training-works"
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-stone-300 px-5 text-sm font-bold text-stone-800 transition hover:bg-stone-100"
              >
                <BookOpen className="h-4 w-4" />
                How It Works
              </Link>
              <Link
                to="/optimizer"
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-stone-300 px-5 text-sm font-bold text-stone-800 transition hover:bg-stone-100"
              >
                <TrendingDown className="h-4 w-4" />
                Optimize Cards
              </Link>
              <Link
                to="/multiplayer"
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg bg-stone-950 px-5 text-sm font-black text-white transition hover:bg-stone-800"
              >
                <Users className="h-4 w-4" />
                Host a Room
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-stone-200 bg-white px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 text-sm text-stone-500 md:flex-row md:items-center md:justify-between">
          <div>
            <span className="font-semibold text-stone-800">Magic Brains</span> is an independent Commander practice tool.
          </div>
          <div className="flex flex-wrap gap-4">
            <Link to="/how-training-works" className="font-semibold text-stone-600 hover:text-stone-950">How Practice Works</Link>
            <Link to="/privacy" className="font-semibold text-stone-600 hover:text-stone-950">Privacy</Link>
            <Link to="/terms" className="font-semibold text-stone-600 hover:text-stone-950">Terms</Link>
            <Link to="/contact" className="font-semibold text-stone-600 hover:text-stone-950">Contact/About</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
