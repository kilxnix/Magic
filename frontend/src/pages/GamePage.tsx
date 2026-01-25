import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, SkipForward, Hand, Layers, Heart, Zap } from 'lucide-react';

// Game state types (matching engine types)
interface ManaPool {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  C: number;
}

interface Player {
  id: string;
  name: string;
  life: number;
  manaPool: ManaPool;
  hasPlayedLand: boolean;
  hasPriority: boolean;
  hasLost: boolean;
  commanderDamage: Record<string, number>;
  isAI?: boolean;
  personality?: string;
  difficulty?: number;
}

interface CardInstance {
  instanceId: string;
  definitionId: string;
  ownerId: string;
  zone: string;
  tapped: boolean;
  summoningSick: boolean;
  counters: Record<string, number>;
  damage: number;
  isCommander: boolean;
}

interface CardDefinition {
  id: string;
  name: string;
  type_line: string;
  oracle_text: string;
  mana_cost: string;
  cmc: number;
  colors: string[];
  power?: number;
  toughness?: number;
  card_types: string[];
}

interface GameState {
  players: Player[];
  cards: Map<string, CardInstance>;
  cardDefinitions: Map<string, CardDefinition>;
  activePlayerIndex: number;
  priorityPlayerIndex: number;
  phase: string;
  step: string;
  turnNumber: number;
  stack: any[];
  combat: any;
}

// Phase display names
const PHASE_NAMES: Record<string, string> = {
  beginning: 'Beginning',
  precombat_main: 'Main 1',
  combat: 'Combat',
  postcombat_main: 'Main 2',
  ending: 'End',
};

// Color styling
const MANA_COLORS: Record<string, string> = {
  W: 'bg-amber-100 text-amber-800',
  U: 'bg-blue-100 text-blue-800',
  B: 'bg-gray-300 text-gray-800',
  R: 'bg-red-100 text-red-800',
  G: 'bg-green-100 text-green-800',
  C: 'bg-gray-100 text-gray-600',
};

export function GamePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const deckId = searchParams.get('deckId');

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [gameLog, setGameLog] = useState<string[]>([]);

  // Initialize game
  useEffect(() => {
    if (!deckId) {
      setError('No deck specified');
      setLoading(false);
      return;
    }

    initializeGame();
  }, [deckId]);

  const initializeGame = async () => {
    try {
      setLoading(true);

      // Launch the game via API
      const response = await fetch('/api/launch-game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deck_id: deckId,
          opponent_count: 1,
          difficulty: 3,
          ai_personalities: ['Balanced'],
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to launch game');
      }

      const data = await response.json();

      // Create initial game state (simplified for now)
      const initialState = createInitialGameState(data);
      setGameState(initialState);
      addLog(`Game started: ${data.human_deck} vs ${data.ai_decks.join(', ')}`);
      addLog(`Turn 1 - Your turn. Main Phase.`);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start game');
    } finally {
      setLoading(false);
    }
  };

  const createInitialGameState = (launchData: any): GameState => {
    // Create a simplified initial state for testing
    const humanPlayer: Player = {
      id: 'human',
      name: 'You',
      life: 40,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      hasPlayedLand: false,
      hasPriority: true,
      hasLost: false,
      commanderDamage: {},
      isAI: false,
    };

    const aiPlayer: Player = {
      id: 'ai1',
      name: launchData.ai_decks[0] || 'AI Opponent',
      life: 40,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      hasPlayedLand: false,
      hasPriority: false,
      hasLost: false,
      commanderDamage: {},
      isAI: true,
      personality: 'Balanced',
      difficulty: launchData.difficulty,
    };

    // Create some sample cards for testing
    const cards = new Map<string, CardInstance>();
    const cardDefinitions = new Map<string, CardDefinition>();

    // Add sample hand cards
    for (let i = 0; i < 7; i++) {
      const id = `hand_${i}`;
      cards.set(id, {
        instanceId: id,
        definitionId: `def_${i}`,
        ownerId: 'human',
        zone: 'hand',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      cardDefinitions.set(`def_${i}`, {
        id: `def_${i}`,
        name: `Card ${i + 1}`,
        type_line: i < 3 ? 'Basic Land — Forest' : 'Creature — Beast',
        oracle_text: i < 3 ? '({T}: Add {G}.)' : 'Sample creature text',
        mana_cost: i < 3 ? '' : `{${i - 1}}{G}`,
        cmc: i < 3 ? 0 : i - 1,
        colors: ['G'],
        power: i < 3 ? undefined : 2 + i - 3,
        toughness: i < 3 ? undefined : 2 + i - 3,
        card_types: i < 3 ? ['land'] : ['creature'],
      });
    }

    return {
      players: [humanPlayer, aiPlayer],
      cards,
      cardDefinitions,
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'precombat_main',
      step: 'upkeep',
      turnNumber: 1,
      stack: [],
      combat: null,
    };
  };

  const addLog = (message: string) => {
    setGameLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const handlePassPriority = () => {
    addLog('You passed priority.');
    // TODO: Implement actual priority passing
  };

  const handlePlayLand = () => {
    if (selectedCard) {
      addLog(`Played land: ${selectedCard}`);
      setSelectedCard(null);
      // TODO: Implement actual land playing
    }
  };

  const handleCastSpell = () => {
    if (selectedCard) {
      addLog(`Cast spell: ${selectedCard}`);
      setSelectedCard(null);
      // TODO: Implement actual spell casting
    }
  };

  const handleEndTurn = () => {
    addLog('Ending turn...');
    // TODO: Implement turn ending
  };

  const getCardsInZone = (playerId: string, zone: string): [string, CardInstance][] => {
    if (!gameState) return [];
    return Array.from(gameState.cards.entries())
      .filter(([_, card]) => card.ownerId === playerId && card.zone === zone);
  };

  const getCardDef = (definitionId: string): CardDefinition | undefined => {
    return gameState?.cardDefinitions.get(definitionId);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-900 flex items-center justify-center">
        <div className="text-stone-400 text-lg">Starting game...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-stone-900 flex flex-col items-center justify-center gap-4">
        <div className="text-red-500 text-lg">{error}</div>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-stone-700 text-stone-200 rounded hover:bg-stone-600"
        >
          Back to Generator
        </button>
      </div>
    );
  }

  if (!gameState) return null;

  const humanPlayer = gameState.players.find(p => !p.isAI)!;
  const aiPlayers = gameState.players.filter(p => p.isAI);
  const handCards = getCardsInZone('human', 'hand');
  const battlefieldCards = getCardsInZone('human', 'battlefield');
  const aiBattlefieldCards = getCardsInZone('ai1', 'battlefield');

  return (
    <div className="min-h-screen bg-stone-900 text-stone-100 flex flex-col">
      {/* Top Bar - Opponent Info */}
      <div className="bg-stone-800 border-b border-stone-700 p-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-stone-400 hover:text-stone-200"
          >
            <ArrowLeft className="w-4 h-4" />
            Exit Game
          </button>

          {/* Opponent Stats */}
          <div className="flex gap-6">
            {aiPlayers.map(player => (
              <div key={player.id} className="flex items-center gap-3 bg-stone-700/50 px-4 py-2 rounded-lg">
                <div className="text-sm text-stone-400">{player.name}</div>
                <div className="flex items-center gap-1">
                  <Heart className="w-4 h-4 text-red-400" />
                  <span className="font-bold">{player.life}</span>
                </div>
                <div className="text-xs text-stone-500">
                  {player.personality} • Bracket {player.difficulty}
                </div>
              </div>
            ))}
          </div>

          {/* Turn/Phase Info */}
          <div className="flex items-center gap-4">
            <div className="text-sm">
              <span className="text-stone-400">Turn</span>{' '}
              <span className="font-bold text-amber-400">{gameState.turnNumber}</span>
            </div>
            <div className="bg-amber-600/20 text-amber-400 px-3 py-1 rounded text-sm font-medium">
              {PHASE_NAMES[gameState.phase] || gameState.phase}
            </div>
          </div>
        </div>
      </div>

      {/* Main Game Area */}
      <div className="flex-1 flex">
        {/* Battlefield */}
        <div className="flex-1 flex flex-col p-4">
          {/* Opponent Battlefield */}
          <div className="flex-1 bg-stone-800/30 rounded-lg p-4 mb-4 border border-stone-700/50">
            <div className="text-xs text-stone-500 mb-2">Opponent's Battlefield</div>
            <div className="flex flex-wrap gap-2">
              {aiBattlefieldCards.map(([id, card]) => {
                const def = getCardDef(card.definitionId);
                return (
                  <div
                    key={id}
                    className={`w-24 h-32 bg-stone-700 rounded border border-stone-600 p-2 text-xs ${
                      card.tapped ? 'rotate-6 opacity-70' : ''
                    }`}
                  >
                    <div className="font-medium truncate">{def?.name}</div>
                    <div className="text-stone-400 text-[10px] truncate">{def?.type_line}</div>
                    {def?.power !== undefined && (
                      <div className="absolute bottom-1 right-1 bg-stone-600 px-1 rounded text-[10px]">
                        {def.power}/{def.toughness}
                      </div>
                    )}
                  </div>
                );
              })}
              {aiBattlefieldCards.length === 0 && (
                <div className="text-stone-600 text-sm">No permanents</div>
              )}
            </div>
          </div>

          {/* Your Battlefield */}
          <div className="flex-1 bg-stone-800/50 rounded-lg p-4 border border-stone-600/50">
            <div className="text-xs text-stone-500 mb-2">Your Battlefield</div>
            <div className="flex flex-wrap gap-2">
              {battlefieldCards.map(([id, card]) => {
                const def = getCardDef(card.definitionId);
                return (
                  <div
                    key={id}
                    onClick={() => setSelectedCard(id)}
                    className={`w-24 h-32 bg-stone-700 rounded border p-2 text-xs cursor-pointer transition-all ${
                      card.tapped ? 'rotate-6 opacity-70' : ''
                    } ${
                      selectedCard === id ? 'border-amber-500 ring-2 ring-amber-500/50' : 'border-stone-600 hover:border-stone-500'
                    }`}
                  >
                    <div className="font-medium truncate">{def?.name}</div>
                    <div className="text-stone-400 text-[10px] truncate">{def?.type_line}</div>
                    {def?.power !== undefined && (
                      <div className="absolute bottom-1 right-1 bg-stone-600 px-1 rounded text-[10px]">
                        {def.power}/{def.toughness}
                      </div>
                    )}
                  </div>
                );
              })}
              {battlefieldCards.length === 0 && (
                <div className="text-stone-600 text-sm">No permanents - play a land or cast a spell!</div>
              )}
            </div>
          </div>
        </div>

        {/* Right Sidebar - Actions & Log */}
        <div className="w-72 bg-stone-800 border-l border-stone-700 flex flex-col">
          {/* Player Stats */}
          <div className="p-4 border-b border-stone-700">
            <div className="flex items-center justify-between mb-3">
              <span className="text-stone-400">Your Life</span>
              <div className="flex items-center gap-2">
                <Heart className="w-5 h-5 text-red-400" />
                <span className="text-2xl font-bold">{humanPlayer.life}</span>
              </div>
            </div>

            {/* Mana Pool */}
            <div className="flex gap-1">
              {Object.entries(humanPlayer.manaPool).map(([color, amount]) => (
                amount > 0 && (
                  <div key={color} className={`px-2 py-1 rounded text-xs font-medium ${MANA_COLORS[color]}`}>
                    {amount} {color}
                  </div>
                )
              ))}
              {Object.values(humanPlayer.manaPool).every(v => v === 0) && (
                <div className="text-stone-500 text-xs">No mana in pool</div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="p-4 border-b border-stone-700 space-y-2">
            <div className="text-xs text-stone-400 mb-2">Actions</div>
            <button
              onClick={handlePlayLand}
              disabled={humanPlayer.hasPlayedLand}
              className="w-full py-2 px-3 bg-green-700 hover:bg-green-600 disabled:bg-stone-700 disabled:text-stone-500 rounded text-sm font-medium flex items-center justify-center gap-2"
            >
              <Layers className="w-4 h-4" />
              Play Land
            </button>
            <button
              onClick={handleCastSpell}
              className="w-full py-2 px-3 bg-blue-700 hover:bg-blue-600 rounded text-sm font-medium flex items-center justify-center gap-2"
            >
              <Zap className="w-4 h-4" />
              Cast Spell
            </button>
            <button
              onClick={handlePassPriority}
              className="w-full py-2 px-3 bg-stone-700 hover:bg-stone-600 rounded text-sm font-medium flex items-center justify-center gap-2"
            >
              <SkipForward className="w-4 h-4" />
              Pass Priority
            </button>
            <button
              onClick={handleEndTurn}
              className="w-full py-2 px-3 bg-amber-700 hover:bg-amber-600 rounded text-sm font-medium flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4" />
              End Turn
            </button>
          </div>

          {/* Game Log */}
          <div className="flex-1 p-4 overflow-hidden flex flex-col">
            <div className="text-xs text-stone-400 mb-2">Game Log</div>
            <div className="flex-1 overflow-y-auto space-y-1 text-xs text-stone-400">
              {gameLog.map((log, i) => (
                <div key={i} className="py-1 border-b border-stone-700/50">{log}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Hand */}
      <div className="bg-stone-800 border-t border-stone-700 p-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-2 mb-2">
            <Hand className="w-4 h-4 text-stone-400" />
            <span className="text-xs text-stone-400">Your Hand ({handCards.length} cards)</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {handCards.map(([id, card]) => {
              const def = getCardDef(card.definitionId);
              return (
                <div
                  key={id}
                  onClick={() => setSelectedCard(id)}
                  className={`flex-shrink-0 w-32 h-44 bg-stone-700 rounded-lg border p-2 cursor-pointer transition-all hover:-translate-y-2 ${
                    selectedCard === id
                      ? 'border-amber-500 ring-2 ring-amber-500/50 -translate-y-2'
                      : 'border-stone-600 hover:border-stone-500'
                  }`}
                >
                  <div className="text-xs font-medium mb-1">{def?.name}</div>
                  <div className="text-[10px] text-stone-400 mb-1">{def?.mana_cost}</div>
                  <div className="text-[10px] text-stone-500 mb-2">{def?.type_line}</div>
                  <div className="text-[10px] text-stone-400 line-clamp-3">{def?.oracle_text}</div>
                  {def?.power !== undefined && (
                    <div className="absolute bottom-2 right-2 bg-stone-600 px-1.5 py-0.5 rounded text-xs font-medium">
                      {def.power}/{def.toughness}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
