import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Gamepad2, Users, Gauge } from 'lucide-react';

interface TestDeckModalProps {
  deckId: string;
  deckName: string;
  onClose: () => void;
}

const PERSONALITIES = ['Balanced', 'Aggressive', 'Greedy', 'Political'] as const;
type Personality = typeof PERSONALITIES[number];

const PERSONALITY_DESCRIPTIONS: Record<Personality, string> = {
  Balanced: 'Adapts to the board state',
  Aggressive: 'Attacks early and often',
  Greedy: 'Focuses on ramping and value',
  Political: 'Spreads damage, holds grudges',
};

export function TestDeckModal({ deckId, deckName, onClose }: TestDeckModalProps) {
  const navigate = useNavigate();
  const [opponentCount, setOpponentCount] = useState(1);
  const [difficulty, setDifficulty] = useState(3);
  const [personalities, setPersonalities] = useState<Personality[]>(['Balanced']);
  const [loading, setLoading] = useState(false);

  const handlePersonalityChange = (index: number, value: Personality) => {
    const newPersonalities = [...personalities];
    newPersonalities[index] = value;
    setPersonalities(newPersonalities);
  };

  const handleOpponentCountChange = (count: number) => {
    setOpponentCount(count);
    // Ensure we have the right number of personalities
    const newPersonalities = [...personalities];
    while (newPersonalities.length < count) {
      newPersonalities.push('Balanced');
    }
    setPersonalities(newPersonalities.slice(0, count));
  };

  const handleLaunch = () => {
    setLoading(true);
    // Navigate directly to game page with deck ID and settings
    const params = new URLSearchParams({
      deckId,
      opponents: opponentCount.toString(),
      difficulty: difficulty.toString(),
      personalities: personalities.join(','),
    });
    navigate(`/game?${params.toString()}`);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-stone-200">
          <div className="flex items-center gap-2">
            <Gamepad2 className="w-5 h-5 text-stone-600" />
            <h2 className="text-lg font-semibold text-stone-800">Test This Deck</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-stone-400 hover:text-stone-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6">
          {/* Deck Info */}
              <div className="bg-stone-50 rounded-lg p-3">
                <div className="text-sm text-stone-500">Playing with</div>
                <div className="font-medium text-stone-800">{deckName}</div>
              </div>

              {/* Opponent Count */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-stone-700 mb-2">
                  <Users className="w-4 h-4" />
                  Number of Opponents
                </label>
                <div className="flex gap-2">
                  {[1, 2, 3].map(count => (
                    <button
                      key={count}
                      onClick={() => handleOpponentCountChange(count)}
                      className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                        opponentCount === count
                          ? 'bg-stone-800 text-white'
                          : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                      }`}
                    >
                      {count} AI{count > 1 ? 's' : ''}
                    </button>
                  ))}
                </div>
              </div>

              {/* Difficulty */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-stone-700 mb-2">
                  <Gauge className="w-4 h-4" />
                  AI Difficulty (Bracket)
                </label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map(level => (
                    <button
                      key={level}
                      onClick={() => setDifficulty(level)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                        difficulty === level
                          ? 'bg-stone-800 text-white'
                          : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
                <div className="text-xs text-stone-500 mt-1">
                  {difficulty === 1 && 'Casual - Plays on curve, random attacks'}
                  {difficulty === 2 && 'Precon - Basic threat assessment'}
                  {difficulty === 3 && 'Upgraded - Strategic decisions'}
                  {difficulty === 4 && 'Optimized - Reads open mana, retaliates'}
                  {difficulty === 5 && 'cEDH - Optimal play, combo aware'}
                </div>
              </div>

              {/* AI Personalities */}
              <div>
                <label className="text-sm font-medium text-stone-700 mb-2 block">
                  AI Personalities
                </label>
                <div className="space-y-2">
                  {Array.from({ length: opponentCount }).map((_, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="text-sm text-stone-500 w-12">AI {index + 1}:</span>
                      <select
                        value={personalities[index] || 'Balanced'}
                        onChange={e => handlePersonalityChange(index, e.target.value as Personality)}
                        className="flex-1 px-3 py-2 rounded-lg border border-stone-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-500"
                      >
                        {PERSONALITIES.map(p => (
                          <option key={p} value={p}>
                            {p} - {PERSONALITY_DESCRIPTIONS[p]}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              </div>

        {/* Footer */}
        <div className="flex gap-2 p-4 border-t border-stone-200">
            <button
              onClick={onClose}
              className="flex-1 py-2 px-4 text-sm font-medium text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleLaunch}
              disabled={loading}
              className="flex-1 py-2 px-4 text-sm font-medium text-white bg-stone-800 rounded-lg hover:bg-stone-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Starting...' : 'Start Game'}
            </button>
          </div>
      </div>
    </div>
  );
}
