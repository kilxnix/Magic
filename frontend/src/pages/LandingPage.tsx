import { Link } from 'react-router-dom';
import { Sparkles, Swords } from 'lucide-react';

export function LandingPage() {
  return (
    <div className="min-h-screen bg-stone-900 text-stone-100 flex flex-col items-center justify-center p-4">
      <div className="text-center mb-12">
        <h1 className="text-4xl sm:text-5xl font-bold mb-3 text-amber-100">
          Magic Brains
        </h1>
        <p className="text-stone-400 text-lg">
          MTG Commander deck generation &amp; AI playtesting
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl w-full">
        <Link
          to="/generate"
          className="group bg-stone-800 border border-stone-700 rounded-xl p-8 hover:border-amber-600 hover:bg-stone-800/80 transition-all"
        >
          <div className="flex items-center gap-3 mb-4">
            <Sparkles className="w-8 h-8 text-amber-400 group-hover:text-amber-300" />
            <h2 className="text-2xl font-semibold">Generate a Deck</h2>
          </div>
          <p className="text-stone-400 group-hover:text-stone-300">
            Build a Commander deck tailored to your style, power level, and budget.
          </p>
        </Link>

        <Link
          to="/play"
          className="group bg-stone-800 border border-stone-700 rounded-xl p-8 hover:border-red-600 hover:bg-stone-800/80 transition-all"
        >
          <div className="flex items-center gap-3 mb-4">
            <Swords className="w-8 h-8 text-red-400 group-hover:text-red-300" />
            <h2 className="text-2xl font-semibold">Play a Game</h2>
          </div>
          <p className="text-stone-400 group-hover:text-stone-300">
            Import your deck from Moxfield, Archidekt, or any popular site and battle an AI opponent.
          </p>
        </Link>
      </div>
    </div>
  );
}
