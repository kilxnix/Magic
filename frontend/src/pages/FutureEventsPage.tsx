import { Link } from 'react-router-dom';
import { ArrowLeft, Trophy } from 'lucide-react';

export function FutureEventsPage() {
  return (
    <main className="min-h-screen bg-[#f7f3ea] px-4 py-10 text-stone-950 sm:px-6">
      <div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col justify-center">
        <Link
          to="/"
          className="mb-8 inline-flex min-h-[40px] w-fit items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 text-sm font-bold text-stone-800 transition hover:bg-stone-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back Home
        </Link>

        <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-5 inline-flex items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs font-black uppercase tracking-wide text-amber-900">
            <Trophy className="h-4 w-4" />
            Future Release
          </div>
          <h1 className="font-serif text-4xl font-bold leading-tight text-stone-950 sm:text-5xl">
            Events are not part of the initial launch.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-stone-600">
            DeckReps is launching first around practice games, private rooms, and review tools.
            Organized events will come back when the tournament surface is ready for public use.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/play"
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-stone-950 px-5 text-sm font-black text-white transition hover:bg-stone-800"
            >
              Open Practice
            </Link>
            <Link
              to="/multiplayer"
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-stone-300 bg-white px-5 text-sm font-black text-stone-900 transition hover:bg-stone-50"
            >
              Open Private Rooms
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
