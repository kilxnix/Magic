import { useState } from 'react';
import { X, Gamepad2, Users, Gauge } from 'lucide-react';

interface TestDeckModalProps {
  deckId: string;
  deckName: string;
  onClose: () => void;
}

interface LaunchResponse {
  game_id: string;
  player_count: number;
  human_deck: string;
  ai_decks: string[];
  difficulty: number;
  message: string;
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
  const [opponentCount, setOpponentCount] = useState(1);
  const [difficulty, setDifficulty] = useState(3);
  const [personalities, setPersonalities] = useState<Personality[]>(['Balanced']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LaunchResponse | null>(null);

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

  const handleLaunch = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/launch-game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deck_id: deckId,
          opponent_count: opponentCount,
          difficulty,
          ai_personalities: personalities,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to launch game');
      }

      const data: LaunchResponse = await response.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const deepLinkUrl = result ? `mtgcommander://game/${result.game_id}` : '';

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
          {!result ? (
            <>
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

              {/* Error */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
            </>
          ) : (
            /* Success State */
            <div className="text-center space-y-4">
              <div className="text-green-600 text-lg font-medium">Game Ready!</div>
              <div className="text-sm text-stone-600">{result.message}</div>

              {/* Deep Link */}
              <div className="bg-stone-50 rounded-lg p-4">
                <div className="text-xs text-stone-500 mb-2">Game ID</div>
                <code className="text-sm font-mono text-stone-800">{result.game_id}</code>
              </div>

              {/* Open in App Button */}
              <a
                href={deepLinkUrl}
                className="block w-full py-3 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 transition-colors"
              >
                Open in MTG Commander App
              </a>

              {/* QR Code placeholder */}
              <div className="text-xs text-stone-500">
                Or scan the QR code in the mobile app
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!result && (
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
        )}
      </div>
    </div>
  );
}
