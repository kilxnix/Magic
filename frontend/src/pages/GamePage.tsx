import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, SkipForward, Hand, Layers, Heart, Zap, RefreshCw, BookOpen, Skull, Sparkles, Eye, EyeOff, ChevronDown, ChevronUp, Swords, Shield, Trophy, Save, FolderOpen, X, Target, Menu, Check } from 'lucide-react';
import { useCommanderEngine as useGameEngine } from '../hooks/useCommanderEngine';
import { CardDetailModal } from '../components/CardDetailModal';
import { applyFaceToCardDefinition } from 'commander-engine';

// Phase display names
const PHASE_NAMES: Record<string, string> = {
  beginning: 'Beginning',
  precombat_main: 'Main 1',
  combat: 'Combat',
  postcombat_main: 'Main 2',
  ending: 'End',
};

// Step display names (more specific)
const STEP_NAMES: Record<string, string> = {
  untap: 'Untap',
  upkeep: 'Upkeep',
  draw: 'Draw',
  begin_combat: 'Begin Combat',
  declare_attackers: 'Declare Attackers',
  declare_blockers: 'Declare Blockers',
  first_strike_damage: 'First Strike',
  combat_damage: 'Combat Damage',
  end_of_combat: 'End Combat',
  end: 'End Step',
  cleanup: 'Cleanup',
};

// Color styling for mana
const MANA_COLORS: Record<string, string> = {
  W: 'bg-amber-100 text-amber-800',
  U: 'bg-blue-100 text-blue-800',
  B: 'bg-gray-300 text-gray-800',
  R: 'bg-red-100 text-red-800',
  G: 'bg-green-100 text-green-800',
  C: 'bg-gray-100 text-gray-600',
};

// Zone label component with gold styling
function ZoneLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-amber-400/80 text-xs font-semibold tracking-wider uppercase mb-2">
      {children}
    </div>
  );
}

// Zone box component with gold border
function ZoneBox({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`border border-amber-600/40 bg-slate-900/60 rounded ${className}`}>
      {children}
    </div>
  );
}

function getActiveCardDefinition(
  gameState: { cardDefinitions: Map<string, ReturnType<typeof applyFaceToCardDefinition>> },
  card: { definitionId: string; activeFaceName?: string },
) {
  const definition = gameState.cardDefinitions.get(card.definitionId);
  return definition ? applyFaceToCardDefinition(definition, card.activeFaceName) : undefined;
}

// Save/Load types
interface SavedGame {
  id: string;
  name: string;
  timestamp: number;
  turnNumber: number;
  playerLife: number;
  gameState: string; // JSON stringified
}

// LocalStorage Save Manager
function getSavedGames(): SavedGame[] {
  try {
    const data = localStorage.getItem('mtg_saved_games');
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveGameToStorage(name: string, gameState: unknown, turnNumber: number, playerLife: number): SavedGame {
  const saved: SavedGame = {
    id: `save_${Date.now()}`,
    name,
    timestamp: Date.now(),
    turnNumber,
    playerLife,
    gameState: JSON.stringify(gameState, (_, value) => {
      if (value instanceof Map) return { __type: 'Map', entries: Array.from(value.entries()) };
      return value;
    }),
  };
  const games = getSavedGames();
  games.unshift(saved);
  localStorage.setItem('mtg_saved_games', JSON.stringify(games.slice(0, 10))); // Keep last 10
  return saved;
}

function deleteSavedGame(id: string): void {
  const games = getSavedGames().filter(g => g.id !== id);
  localStorage.setItem('mtg_saved_games', JSON.stringify(games));
}

// TODO: Use this when game engine supports restoring state directly
// function parseGameState(jsonStr: string): unknown {
//   return JSON.parse(jsonStr, (_, value) => {
//     if (value && value.__type === 'Map') return new Map(value.entries);
//     return value;
//   });
// }

export function GamePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [showOpponentBoard, setShowOpponentBoard] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [savedGames, setSavedGames] = useState<SavedGame[]>([]);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const deckId = searchParams.get('deckId');
  const opponentCount = parseInt(searchParams.get('opponents') || '1');
  const difficulty = parseInt(searchParams.get('difficulty') || '3');

  const [inspectedCard, setInspectedCard] = useState<string | null>(null);

  const {
    gameState,
    isLoading,
    error,
    gameLog,
    selectedCard,
    humanPlayer,
    aiPlayers,
    targeting,
    mulliganActive,
    mulliganCount,
    putBackCount,
    getHandCards,
    getBattlefieldCards,
    getCardDef,
    getCardById,
    getCardFaces,
    getCommandZoneCards,
    getGraveyardCards,
    getLibraryCount,
    selectCard,
    playLandAction,
    castSpellAction,
    tapForMana,
    activateAbility,
    passPriorityAction,
    selectTarget,
    cancelTargeting,
    confirmTargets,
    declareAttacker,
    confirmAttackers,
    endTurn,
    startGame,
    getManaInfo,
    canCastWithAutoTap,
    mulliganAction,
    keepHandAction,
    putBackCardAction,
  } = useGameEngine();

  // Load saved games list
  useEffect(() => {
    setSavedGames(getSavedGames());
  }, [showLoadModal]);

  // Save game handler
  const handleSaveGame = useCallback(() => {
    if (!gameState || !saveName.trim()) return;
    saveGameToStorage(saveName.trim(), gameState, gameState.turnNumber, humanPlayer?.life ?? 0);
    setSaveName('');
    setShowSaveModal(false);
    setSaveMessage('Game saved!');
    setTimeout(() => setSaveMessage(null), 2000);
  }, [gameState, saveName, humanPlayer]);

  // Quick save
  const handleQuickSave = useCallback(() => {
    if (!gameState) return;
    saveGameToStorage(`Quick Save - Turn ${gameState.turnNumber}`, gameState, gameState.turnNumber, humanPlayer?.life ?? 0);
    setSaveMessage('Quick saved!');
    setTimeout(() => setSaveMessage(null), 2000);
  }, [gameState, humanPlayer]);

  // Load game handler
  // TODO: Integrate with game engine to restore parsed state from parseGameState()
  const handleLoadGame = useCallback((save: SavedGame) => {
    try {
      startGame({
        deckId: deckId || 'test-deck',
        opponentCount: 1,
        difficulty: 3,
        personalities: ['Balanced'],
      });
      setShowLoadModal(false);
      setSaveMessage(`Loaded "${save.name}"`);
      setTimeout(() => setSaveMessage(null), 2000);
    } catch (err) {
      console.error('Failed to load game:', err);
    }
  }, [startGame, deckId]);

  // Delete save handler
  const handleDeleteSave = useCallback((id: string) => {
    deleteSavedGame(id);
    setSavedGames(getSavedGames());
  }, []);

  // Start game on mount
  useEffect(() => {
    if (deckId) {
      startGame({
        deckId,
        opponentCount,
        difficulty,
        personalities: ['Balanced'],
      });
    }
  }, [deckId, opponentCount, difficulty, startGame]);

  // Castability indicators for hand cards + command zone (must be before early returns — Rules of Hooks)
  const castableCards = useMemo(() => {
    const set = new Set<string>();
    if (!gameState || !humanPlayer) return set;
    const hand = gameState ? Array.from(gameState.cards.values()).filter(c => c.ownerId === 'human' && (c.zone === 'hand' || c.zone === 'command')) : [];
    for (const card of hand) {
      const def = getActiveCardDefinition(gameState, card);
      if (!def) continue;
      if (def.card_types.includes('land')) {
        if (!humanPlayer.hasPlayedLand &&
          (gameState.phase === 'precombat_main' || gameState.phase === 'postcombat_main') &&
          gameState.stack.length === 0 &&
          gameState.activePlayerIndex === 0) {
          set.add(card.instanceId);
        }
      } else {
        if (canCastWithAutoTap(card.instanceId)) {
          set.add(card.instanceId);
        }
      }
    }
    return set;
  }, [gameState, humanPlayer, canCastWithAutoTap]);

  // Mana info for currently selected card (for deficit display)
  const selectedManaInfo = useMemo(() => {
    if (!selectedCard || !gameState) return null;
    const inst = gameState.cards.get(selectedCard);
    if (!inst || (inst.zone !== 'hand' && inst.zone !== 'command')) return null;
    const def = getActiveCardDefinition(gameState, inst);
    if (!def || def.card_types.includes('land')) return null;
    return getManaInfo(selectedCard);
  }, [selectedCard, gameState, getManaInfo]);

  if (!deckId) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
        <div className="text-amber-400 text-lg">No deck specified</div>
        <p className="text-slate-400 text-sm max-w-md text-center">
          You can test the game engine with a sample deck, or go back and generate a deck first.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => startGame({
              deckId: 'test-deck',
              opponentCount: 1,
              difficulty: 3,
              personalities: ['Balanced'],
            })}
            className="px-4 py-2 bg-amber-600 text-slate-100 rounded hover:bg-amber-500 font-medium"
          >
            Start Test Game
          </button>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-slate-700 text-slate-200 rounded hover:bg-slate-600"
          >
            Back to Generator
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-amber-400 text-lg">Starting game...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
        <div className="text-red-500 text-lg">{error}</div>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-slate-700 text-slate-200 rounded hover:bg-slate-600"
        >
          Back to Generator
        </button>
      </div>
    );
  }

  if (!gameState || !humanPlayer) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-amber-400 text-lg">Initializing...</div>
      </div>
    );
  }

  const handCards = getHandCards();
  const myBattlefield = getBattlefieldCards('human');
  const aiBattlefield = getBattlefieldCards('ai1');
  const myCommandZone = getCommandZoneCards('human');
  const myGraveyard = getGraveyardCards('human');
  const myLibraryCount = getLibraryCount('human');

  // Separate lands from other permanents
  const myLands = myBattlefield.filter(c => {
    const def = getCardDef(c.definitionId);
    return def?.card_types.includes('land');
  });
  const myCreatures = myBattlefield.filter(c => {
    const def = getCardDef(c.definitionId);
    return !def?.card_types.includes('land');
  });

  // Check if selected card is a land or creature
  const selectedCardInstance = selectedCard ? gameState.cards.get(selectedCard) : null;
  const selectedCardDef = selectedCardInstance ? getCardDef(selectedCardInstance.definitionId) : null;
  const isSelectedLand = selectedCardDef?.card_types.includes('land');
  const isSelectedCreature = selectedCardDef?.card_types.includes('creature');
  const isSelectedOnBattlefield = selectedCardInstance?.zone === 'battlefield';
  const isSelectedInCommandZone = selectedCardInstance?.zone === 'command';

  // Combat phase checks
  const isAttackPhase = gameState.step === 'declare_attackers';
  const isBlockPhase = gameState.step === 'declare_blockers';
  const canSelectedAttack = isAttackPhase && isSelectedCreature && isSelectedOnBattlefield &&
    !selectedCardInstance?.tapped && !selectedCardInstance?.summoningSick && !selectedCardInstance?.isAttacking;

  // Game over check
  const isGameOver = gameState.gameOver;

  // Inspected card data
  const inspectedCardInstance = inspectedCard ? getCardById(inspectedCard) : undefined;
  const inspectedCardDef = inspectedCardInstance ? getCardDef(inspectedCardInstance.definitionId) : undefined;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col pb-52">
      {/* Card Detail Modal */}
      {inspectedCard && inspectedCardInstance && inspectedCardDef && (
        <CardDetailModal
          cardDef={inspectedCardDef}
          card={inspectedCardInstance}
          cardFaces={getCardFaces(inspectedCardDef.name)}
          onClose={() => setInspectedCard(null)}
        />
      )}

      {/* Mulligan Overlay */}
      {mulliganActive && gameState && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center">
          <div className="max-w-5xl w-full px-6">
            {/* Title */}
            <div className="text-center mb-6">
              <h2 className="text-3xl font-bold text-amber-400 mb-2">
                {putBackCount > 0
                  ? `Put ${putBackCount} card${putBackCount > 1 ? 's' : ''} on the bottom of your library`
                  : mulliganCount === 0
                  ? 'Opening Hand'
                  : `Mulligan #${mulliganCount}`}
              </h2>
              {putBackCount === 0 && (
                <p className="text-slate-400 text-sm">
                  {mulliganCount === 0
                    ? 'First mulligan is free (Commander rule)'
                    : mulliganCount === 1
                    ? 'Free mulligan — no cards put back'
                    : `Keep and put ${mulliganCount - 1} card${mulliganCount - 1 > 1 ? 's' : ''} on bottom`}
                </p>
              )}
              {putBackCount > 0 && (
                <p className="text-slate-400 text-sm">Click a card to put it on the bottom</p>
              )}
            </div>

            {/* Hand cards display */}
            {(() => {
              const mulliganHandCards = getHandCards();
              const landCount = mulliganHandCards.filter(c => {
                const def = getCardDef(c.definitionId);
                return def?.card_types.includes('land');
              }).length;
              return (
                <>
                  <div className="text-center mb-3">
                    <span className={`text-sm font-medium ${landCount === 0 ? 'text-red-400' : landCount <= 2 ? 'text-amber-400' : 'text-green-400'}`}>
                      {landCount} land{landCount !== 1 ? 's' : ''} in hand
                    </span>
                    <span className="text-slate-500 text-sm ml-3">({mulliganHandCards.length} cards)</span>
                  </div>
                  <div className="flex gap-3 justify-center flex-wrap">
                    {mulliganHandCards.map(card => {
                      const def = getCardDef(card.definitionId);
                      const isLand = def?.card_types.includes('land');
                      return (
                        <div
                          key={card.instanceId}
                          onClick={() => {
                            if (putBackCount > 0) putBackCardAction(card.instanceId);
                          }}
                          className={`w-36 h-52 rounded-lg border p-3 transition-all relative flex flex-col ${
                            putBackCount > 0
                              ? 'cursor-pointer hover:border-red-400 hover:bg-red-900/20 hover:-translate-y-1'
                              : ''
                          } ${
                            isLand
                              ? 'border-green-500/50 bg-slate-800'
                              : 'border-slate-600 bg-slate-800'
                          }`}
                        >
                          {isLand && (
                            <div className="absolute top-2 right-2 bg-green-700/80 px-1.5 py-0.5 rounded text-[9px] font-medium">
                              Land
                            </div>
                          )}
                          <div className="text-sm font-medium mb-1">{def?.name}</div>
                          <div className="text-xs text-amber-400 mb-1">{def?.mana_cost || ''}</div>
                          <div className="text-[10px] text-slate-400 mb-1.5">{def?.type_line}</div>
                          <div className="text-[10px] text-slate-300 flex-1 overflow-hidden line-clamp-5">{def?.oracle_text}</div>
                          {def?.power !== undefined && (
                            <div className="mt-1 self-end bg-slate-700 px-1.5 py-0.5 rounded text-xs font-bold">
                              {def.power}/{def.toughness}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}

            {/* Action buttons */}
            {putBackCount === 0 && (
              <div className="flex gap-4 justify-center mt-8">
                <button
                  onClick={keepHandAction}
                  className="px-8 py-3 bg-green-700 hover:bg-green-600 rounded-lg text-lg font-bold flex items-center gap-2 border border-green-500/50 transition-colors"
                >
                  <Check className="w-5 h-5" />
                  Keep Hand
                </button>
                <button
                  onClick={mulliganAction}
                  className="px-8 py-3 bg-amber-700 hover:bg-amber-600 rounded-lg text-lg font-bold flex items-center gap-2 border border-amber-500/50 transition-colors"
                >
                  <RefreshCw className="w-5 h-5" />
                  Mulligan
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save message toast */}
      {saveMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg animate-in fade-in slide-in-from-top-2">
          {saveMessage}
        </div>
      )}

      {/* Menu Dropdown */}
      {showMenu && (
        <div className="fixed inset-0 z-50" onClick={() => setShowMenu(false)}>
          <div
            className="absolute top-12 left-24 bg-slate-800 border border-amber-600/40 rounded-lg shadow-xl py-1 min-w-48"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { handleQuickSave(); setShowMenu(false); }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-slate-700 flex items-center gap-2"
            >
              <Save className="w-4 h-4 text-amber-400" />
              Quick Save
            </button>
            <button
              onClick={() => { setShowSaveModal(true); setShowMenu(false); }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-slate-700 flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              Save Game As...
            </button>
            <hr className="border-slate-700 my-1" />
            <button
              onClick={() => { setShowLoadModal(true); setShowMenu(false); }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-slate-700 flex items-center gap-2"
            >
              <FolderOpen className="w-4 h-4" />
              Load Game
            </button>
            <hr className="border-slate-700 my-1" />
            <button
              onClick={() => { setShowMenu(false); navigate('/'); }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-slate-700 text-red-400 flex items-center gap-2"
            >
              <X className="w-4 h-4" />
              Exit to Menu
            </button>
          </div>
        </div>
      )}

      {/* Save Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowSaveModal(false)}>
          <div
            className="bg-slate-800 border border-amber-600/40 rounded-lg shadow-xl p-6 w-96"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-amber-400 mb-4">Save Game</h2>
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Enter save name..."
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white placeholder-slate-500 mb-4"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowSaveModal(false)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveGame}
                disabled={!saveName.trim()}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500 rounded text-sm font-medium"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Modal */}
      {showLoadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowLoadModal(false)}>
          <div
            className="bg-slate-800 border border-amber-600/40 rounded-lg shadow-xl p-6 w-[28rem] max-h-[70vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-amber-400 mb-4">Load Game</h2>
            {savedGames.length === 0 ? (
              <div className="text-slate-400 text-center py-8">No saved games found</div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2 mb-4">
                {savedGames.map((save) => (
                  <div
                    key={save.id}
                    className="flex items-center justify-between p-3 bg-slate-900 rounded border border-slate-700 hover:border-amber-600/50"
                  >
                    <div className="flex-1">
                      <div className="font-medium">{save.name}</div>
                      <div className="text-xs text-slate-400">
                        Turn {save.turnNumber} • {save.playerLife} life • {new Date(save.timestamp).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleLoadGame(save)}
                        className="px-3 py-1 bg-amber-600 hover:bg-amber-500 rounded text-xs font-medium"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => handleDeleteSave(save.id)}
                        className="px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-xs"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => setShowLoadModal(false)}
              className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Targeting Overlay */}
      {targeting.isTargeting && (
        <div className="fixed inset-0 z-40 pointer-events-none">
          <div className="absolute top-20 left-1/2 -translate-x-1/2 pointer-events-auto">
            <div className="bg-slate-800 border-2 border-green-500 rounded-lg shadow-xl px-6 py-4 flex items-center gap-4">
              <Target className="w-6 h-6 text-green-400" />
              <div>
                <div className="font-medium text-green-400">Targeting Mode</div>
                <div className="text-sm text-slate-300">
                  Select {targeting.requiredTargetCount} target{targeting.requiredTargetCount > 1 ? 's' : ''}
                  ({targeting.selectedTargets.length}/{targeting.requiredTargetCount} selected)
                </div>
              </div>
              <div className="flex gap-2 ml-4">
                <button
                  onClick={confirmTargets}
                  disabled={targeting.selectedTargets.length < targeting.requiredTargetCount}
                  className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-slate-700 disabled:text-slate-500 rounded text-sm font-medium flex items-center gap-1"
                >
                  <Check className="w-4 h-4" />
                  Confirm
                </button>
                <button
                  onClick={cancelTargeting}
                  className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded text-sm flex items-center gap-1"
                >
                  <X className="w-4 h-4" />
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top Bar - Game Info */}
      <div className="bg-slate-900 border-b border-amber-600/30 p-2">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-2 text-slate-400 hover:text-amber-400 text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Exit
            </button>
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="flex items-center gap-2 text-slate-400 hover:text-amber-400 text-sm px-2 py-1 rounded hover:bg-slate-800"
            >
              <Menu className="w-4 h-4" />
              Menu
            </button>
          </div>

          {/* Turn/Phase Info */}
          <div className="flex items-center gap-4">
            <div className="text-sm">
              <span className="text-slate-400">Turn</span>{' '}
              <span className="font-bold text-amber-400">{gameState.turnNumber}</span>
            </div>
            <div className="bg-amber-600/20 text-amber-400 px-3 py-1 rounded text-sm font-medium border border-amber-600/30">
              {gameState.phase === 'combat'
                ? (STEP_NAMES[gameState.step] || gameState.step)
                : (PHASE_NAMES[gameState.phase] || gameState.phase)}
            </div>
            {humanPlayer.hasPriority && (
              <div className="bg-green-600/20 text-green-400 px-2 py-1 rounded text-xs border border-green-600/30">
                Your Priority
              </div>
            )}
          </div>

          {/* Player Stats */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Heart className="w-4 h-4 text-red-400" />
              <span className="font-bold text-lg">{humanPlayer.life}</span>
            </div>
            <div className="flex gap-1">
              {Object.entries(humanPlayer.manaPool).map(([color, amount]) => (
                amount > 0 && (
                  <div key={color} className={`px-2 py-0.5 rounded text-xs font-medium ${MANA_COLORS[color]}`}>
                    {amount}
                  </div>
                )
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Game Area */}
      <div className="flex-1 flex p-3 gap-3">
        {/* Opponent Area (simplified) */}
        <div className="flex-1 flex flex-col gap-3">
          {/* Opponent Section - Collapsible */}
          <div
            onClick={() => setShowOpponentBoard(!showOpponentBoard)}
            className="flex items-center justify-between px-4 py-3 bg-slate-900/80 rounded border border-amber-600/20 cursor-pointer hover:bg-slate-800/80 transition-colors"
          >
            <div className="flex items-center gap-4">
              {showOpponentBoard ? (
                <EyeOff className="w-4 h-4 text-amber-400/60" />
              ) : (
                <Eye className="w-4 h-4 text-amber-400/60" />
              )}
              <span className="text-amber-400/80 text-sm font-medium">
                {showOpponentBoard ? 'Hide Opponent\'s Board' : 'View Opponent\'s Board'}
              </span>
              {!showOpponentBoard && aiBattlefield.length > 0 && (
                <span className="text-slate-400 text-xs">
                  ({aiBattlefield.length} permanent{aiBattlefield.length !== 1 ? 's' : ''})
                </span>
              )}
            </div>
            <div className="flex items-center gap-4">
              {aiPlayers.map(player => {
                const isValidTarget = targeting.isTargeting && targeting.validTargets.includes(player.id);
                const isSelectedTarget = targeting.selectedTargets.includes(player.id);
                return (
                  <div
                    key={player.id}
                    onClick={(e) => {
                      if (targeting.isTargeting && isValidTarget) {
                        e.stopPropagation();
                        selectTarget(player.id);
                      }
                    }}
                    className={`flex items-center gap-2 px-3 py-1 rounded transition-all ${
                      isSelectedTarget
                        ? 'bg-yellow-600/40 ring-2 ring-yellow-400 cursor-pointer'
                        : isValidTarget
                        ? 'bg-green-600/30 ring-2 ring-green-400 animate-pulse cursor-pointer'
                        : ''
                    }`}
                  >
                    {isValidTarget && !isSelectedTarget && (
                      <Target className="w-4 h-4 text-green-400" />
                    )}
                    {isSelectedTarget && (
                      <Check className="w-4 h-4 text-yellow-400" />
                    )}
                    <span className="text-slate-400 text-sm">{player.name}</span>
                    <div className="flex items-center gap-1">
                      <Heart className="w-4 h-4 text-red-400" />
                      <span className="font-bold">{player.life}</span>
                    </div>
                  </div>
                );
              })}
              {showOpponentBoard ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </div>
          </div>

          {/* Opponent Battlefield - Expandable */}
          {showOpponentBoard && (
            <ZoneBox className="p-3 animate-in slide-in-from-top-2 duration-200">
              <ZoneLabel>Opponent's Battlefield</ZoneLabel>
              <div className="flex flex-wrap gap-2">
                {aiBattlefield.map(card => {
                  const def = getCardDef(card.definitionId);
                  const isLand = def?.card_types.includes('land');
                  const isValidTarget = targeting.isTargeting && targeting.validTargets.includes(card.instanceId);
                  const isSelectedTarget = targeting.selectedTargets.includes(card.instanceId);
                  return (
                    <div
                      key={card.instanceId}
                      onClick={() => {
                        if (targeting.isTargeting && isValidTarget) {
                          selectTarget(card.instanceId);
                        } else {
                          setInspectedCard(card.instanceId);
                        }
                      }}
                      onDoubleClick={() => setInspectedCard(card.instanceId)}
                      className={`w-24 h-32 bg-slate-800 rounded border p-2 text-xs relative transition-colors cursor-pointer ${
                        card.tapped ? 'rotate-12 opacity-60' : ''
                      } ${
                        isSelectedTarget
                          ? 'border-yellow-400 ring-2 ring-yellow-400/70 bg-yellow-900/30'
                          : isValidTarget
                          ? 'border-green-400 ring-2 ring-green-400/50 bg-green-900/20 animate-pulse'
                          : 'border-slate-600 hover:border-amber-600/50'
                      }`}
                    >
                      {isValidTarget && (
                        <div className="absolute -top-1 -right-1 bg-green-500 rounded-full w-4 h-4 flex items-center justify-center z-10">
                          <Target className="w-3 h-3 text-white" />
                        </div>
                      )}
                      {isSelectedTarget && (
                        <div className="absolute -top-1 -right-1 bg-yellow-500 rounded-full w-4 h-4 flex items-center justify-center z-10">
                          <Check className="w-3 h-3 text-black" />
                        </div>
                      )}
                      <div className="font-medium truncate text-[11px]">{def?.name}</div>
                      <div className="text-slate-400 text-[9px] truncate">{def?.type_line}</div>
                      {def?.power !== undefined && (
                        <div className="absolute bottom-1 right-1 bg-slate-700 px-1.5 rounded text-[10px] font-bold">
                          {def.power}/{def.toughness}
                        </div>
                      )}
                      {isLand && !isValidTarget && !isSelectedTarget && (
                        <div className="absolute top-1 right-1 bg-green-700/60 px-1 py-0.5 rounded text-[8px]">
                          Land
                        </div>
                      )}
                    </div>
                  );
                })}
                {aiBattlefield.length === 0 && (
                  <div className="text-slate-600 text-sm py-4">No permanents on opponent's battlefield</div>
                )}
              </div>
            </ZoneBox>
          )}

          {/* ===== YOUR PLAYMAT ===== */}
          <div className="flex-[2] flex gap-3">
            {/* Left Zone Column */}
            <div className="w-28 flex flex-col gap-2">
              {/* Command Zone */}
              <ZoneBox className="p-2 flex-1">
                <ZoneLabel>Command Zone</ZoneLabel>
                {myCommandZone.length > 0 ? myCommandZone.map(card => {
                  const def = getCardDef(card.definitionId);
                  const isCastable = castableCards.has(card.instanceId);
                  const commanderTax = humanPlayer.commanderCastCount * 2;
                  return (
                    <div
                      key={card.instanceId}
                      onClick={() => {
                        if (selectedCard === card.instanceId) {
                          setInspectedCard(card.instanceId);
                        } else {
                          selectCard(card.instanceId);
                        }
                      }}
                      onDoubleClick={() => setInspectedCard(card.instanceId)}
                      className={`w-full h-20 rounded border p-1.5 text-xs cursor-pointer transition-all relative ${
                        selectedCard === card.instanceId
                          ? 'border-amber-400 ring-2 ring-amber-400/50 bg-slate-700'
                          : isCastable
                          ? 'border-green-500/60 shadow-green-500/20 shadow-md bg-slate-800'
                          : 'border-amber-600/40 bg-slate-800'
                      }`}
                    >
                      {isCastable && selectedCard !== card.instanceId && (
                        <div className="absolute top-1 left-1 w-2.5 h-2.5 bg-green-500 rounded-full z-10" />
                      )}
                      <div className="font-medium truncate text-[10px] text-amber-400">{def?.name}</div>
                      <div className="text-[9px] text-amber-300/70">{def?.mana_cost}</div>
                      {commanderTax > 0 && (
                        <div className="text-[8px] text-red-400 mt-0.5">+{commanderTax} tax</div>
                      )}
                      <div className="absolute bottom-1 right-1 text-[8px] text-amber-600">CMD</div>
                    </div>
                  );
                }) : (
                  <div className="w-full h-16 border border-dashed border-amber-600/30 rounded flex items-center justify-center">
                    <span className="text-slate-600 text-[10px]">On battlefield</span>
                  </div>
                )}
              </ZoneBox>

              {/* Library */}
              <ZoneBox className="p-2">
                <ZoneLabel>Library</ZoneLabel>
                <div className="w-full h-20 bg-slate-800 rounded border border-slate-600 flex items-center justify-center">
                  <BookOpen className="w-6 h-6 text-amber-600/50" />
                </div>
                <div className="text-center text-[10px] text-slate-500 mt-1">
                  {myLibraryCount} cards
                </div>
              </ZoneBox>

              {/* Graveyard */}
              <ZoneBox className="p-2">
                <ZoneLabel>Graveyard ({myGraveyard.length})</ZoneLabel>
                {myGraveyard.length > 0 ? (
                  <div className="space-y-0.5 max-h-24 overflow-y-auto">
                    {myGraveyard.map(card => {
                      const def = getCardDef(card.definitionId);
                      return (
                        <div
                          key={card.instanceId}
                          onClick={() => setInspectedCard(card.instanceId)}
                          className="text-[9px] text-slate-400 hover:text-slate-200 cursor-pointer truncate px-1"
                        >
                          {def?.name}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="w-full h-16 border border-dashed border-amber-600/30 rounded flex items-center justify-center">
                    <Skull className="w-5 h-5 text-slate-600" />
                  </div>
                )}
              </ZoneBox>

              {/* Exile */}
              <ZoneBox className="p-2">
                <ZoneLabel>Exile</ZoneLabel>
                <div className="w-full h-12 border border-dashed border-amber-600/30 rounded flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-slate-600" />
                </div>
              </ZoneBox>
            </div>

            {/* Main Battlefield Zones */}
            <div className="flex-1 flex flex-col gap-2">
              {/* Combat Zone */}
              <ZoneBox className="h-20 p-2">
                <ZoneLabel>Combat Zone</ZoneLabel>
                <div className="h-full flex items-center justify-center">
                  <span className="text-slate-600 text-xs">Attacking/Blocking creatures appear here</span>
                </div>
              </ZoneBox>

              {/* Battlefield (Creatures, Artifacts, Enchantments) */}
              <ZoneBox className="flex-1 p-3">
                <ZoneLabel>Battlefield</ZoneLabel>
                <div className="flex flex-wrap gap-2">
                  {myCreatures.map(card => {
                    const def = getCardDef(card.definitionId);
                    const isValidTarget = targeting.isTargeting && targeting.validTargets.includes(card.instanceId);
                    const isSelectedTarget = targeting.selectedTargets.includes(card.instanceId);
                    return (
                      <div
                        key={card.instanceId}
                        onClick={() => {
                          if (targeting.isTargeting && isValidTarget) {
                            selectTarget(card.instanceId);
                          } else if (selectedCard === card.instanceId) {
                            setInspectedCard(card.instanceId);
                          } else {
                            selectCard(card.instanceId);
                          }
                        }}
                        onDoubleClick={() => setInspectedCard(card.instanceId)}
                        className={`w-20 h-28 rounded border p-1.5 text-xs cursor-pointer transition-all relative ${
                          card.tapped ? 'rotate-12 opacity-60' : ''
                        } ${
                          isSelectedTarget
                            ? 'border-yellow-400 ring-2 ring-yellow-400/70 bg-yellow-900/30'
                            : isValidTarget
                            ? 'border-green-400 ring-2 ring-green-400/50 bg-green-900/20 animate-pulse'
                            : selectedCard === card.instanceId
                            ? 'border-amber-400 ring-2 ring-amber-400/50 bg-slate-700'
                            : 'border-slate-600 hover:border-amber-600/50 bg-slate-800'
                        }`}
                      >
                        {isValidTarget && (
                          <div className="absolute -top-1 -right-1 bg-green-500 rounded-full w-4 h-4 flex items-center justify-center z-10">
                            <Target className="w-3 h-3 text-white" />
                          </div>
                        )}
                        {isSelectedTarget && (
                          <div className="absolute -top-1 -right-1 bg-yellow-500 rounded-full w-4 h-4 flex items-center justify-center z-10">
                            <Check className="w-3 h-3 text-black" />
                          </div>
                        )}
                        <div className="font-medium truncate text-[10px]">{def?.name}</div>
                        <div className="text-slate-400 text-[9px] truncate">{def?.type_line}</div>
                        {def?.power !== undefined && (
                          <div className="absolute bottom-1 right-1 bg-slate-700 px-1 rounded text-[10px] font-bold">
                            {def.power}/{def.toughness}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {myCreatures.length === 0 && (
                    <div className="text-slate-600 text-sm">No creatures</div>
                  )}
                </div>
              </ZoneBox>

              {/* Lands Zone */}
              <ZoneBox className="h-32 p-3">
                <ZoneLabel>Lands</ZoneLabel>
                <div className="flex flex-wrap gap-2">
                  {myLands.map(card => {
                    const def = getCardDef(card.definitionId);
                    return (
                      <div
                        key={card.instanceId}
                        onClick={() => {
                          if (selectedCard === card.instanceId) {
                            setInspectedCard(card.instanceId);
                          } else {
                            selectCard(card.instanceId);
                          }
                        }}
                        onDoubleClick={() => setInspectedCard(card.instanceId)}
                        className={`w-16 h-20 rounded border p-1 text-xs cursor-pointer transition-all ${
                          card.tapped ? 'rotate-12 opacity-60' : ''
                        } ${
                          selectedCard === card.instanceId
                            ? 'border-amber-400 ring-2 ring-amber-400/50 bg-slate-700'
                            : 'border-slate-600 hover:border-amber-600/50 bg-slate-800'
                        }`}
                      >
                        <div className="font-medium truncate text-[9px]">{def?.name}</div>
                        {!card.tapped && (
                          <div className="absolute bottom-0.5 left-0.5 text-[8px] text-green-400">
                            tap
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {myLands.length === 0 && (
                    <div className="text-slate-600 text-xs">Play a land!</div>
                  )}
                </div>
              </ZoneBox>
            </div>
          </div>
        </div>

        {/* Right Sidebar - Actions & Log */}
        <div className="w-72 flex flex-col gap-2">
          {/* Game Over Banner */}
          {isGameOver && (
            <ZoneBox className="p-4 text-center">
              <Trophy className={`w-8 h-8 mx-auto mb-2 ${gameState.winnerId === 'human' ? 'text-amber-400' : 'text-slate-500'}`} />
              <div className={`text-lg font-bold ${gameState.winnerId === 'human' ? 'text-amber-400' : 'text-red-400'}`}>
                {gameState.winnerId === 'human' ? 'VICTORY!' : 'DEFEAT'}
              </div>
              <button
                onClick={() => navigate('/')}
                className="mt-3 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm"
              >
                Back to Menu
              </button>
            </ZoneBox>
          )}

          {/* Actions */}
          <ZoneBox className="p-3 space-y-2">
            <ZoneLabel>Actions</ZoneLabel>

            {/* Contextual actions based on selection */}
            {selectedCard && selectedCardInstance?.zone === 'hand' && isSelectedLand && (
              <button
                onClick={() => playLandAction(selectedCard)}
                disabled={humanPlayer.hasPlayedLand}
                className="w-full py-2 px-3 bg-green-700 hover:bg-green-600 disabled:bg-slate-700 disabled:text-slate-500 rounded text-sm font-medium flex items-center justify-center gap-2 border border-green-600/50"
              >
                <Layers className="w-4 h-4" />
                Play {selectedCardDef?.name}
              </button>
            )}

            {selectedCard && selectedCardInstance?.zone === 'hand' && !isSelectedLand && (
              <div>
                <button
                  onClick={() => castSpellAction(selectedCard)}
                  className="w-full py-2 px-3 bg-blue-700 hover:bg-blue-600 rounded text-sm font-medium flex items-center justify-center gap-2 border border-blue-600/50"
                >
                  <Zap className="w-4 h-4" />
                  Cast {selectedCardDef?.name}
                </button>
                {selectedManaInfo && !selectedManaInfo.canCast && (
                  <div className="text-red-400 text-xs mt-1 px-1">
                    {selectedManaInfo.timingOk
                      ? selectedManaInfo.deficit
                        ? `Need ${selectedManaInfo.cost} — missing ${Object.entries(selectedManaInfo.deficit).map(([c, n]) => c === 'generic' ? `{${n}}` : Array(n).fill(`{${c}}`).join('')).join('')}`
                        : 'Not enough mana'
                      : "Can't cast right now"}
                  </div>
                )}
              </div>
            )}

            {selectedCard && isSelectedInCommandZone && selectedCardDef && (
              <div>
                <button
                  onClick={() => castSpellAction(selectedCard)}
                  className="w-full py-2 px-3 bg-amber-700 hover:bg-amber-600 rounded text-sm font-medium flex items-center justify-center gap-2 border border-amber-600/50"
                >
                  <Zap className="w-4 h-4" />
                  Cast Commander
                </button>
                {humanPlayer.commanderCastCount > 0 && (
                  <div className="text-amber-400 text-xs mt-1 px-1">
                    Commander tax: +{humanPlayer.commanderCastCount * 2} generic
                  </div>
                )}
                {selectedManaInfo && !selectedManaInfo.canCast && (
                  <div className="text-red-400 text-xs mt-1 px-1">
                    {selectedManaInfo.timingOk
                      ? selectedManaInfo.deficit
                        ? `Need ${selectedManaInfo.cost}${humanPlayer.commanderCastCount > 0 ? ` +{${humanPlayer.commanderCastCount * 2}} tax` : ''} — missing ${Object.entries(selectedManaInfo.deficit).map(([c, n]) => c === 'generic' ? `{${n}}` : Array(n).fill(`{${c}}`).join('')).join('')}`
                        : 'Not enough mana'
                      : "Can't cast right now"}
                  </div>
                )}
              </div>
            )}

            {selectedCard && isSelectedOnBattlefield && !selectedCardInstance?.tapped && (isSelectedLand || selectedCardDef?.oracle_text.includes('{T}: Add {')) && (
              <button
                onClick={() => tapForMana(selectedCard)}
                className="w-full py-2 px-3 bg-green-700 hover:bg-green-600 rounded text-sm font-medium flex items-center justify-center gap-2 border border-green-600/50"
              >
                <RefreshCw className="w-4 h-4" />
                Tap for Mana
              </button>
            )}

            {/* Activate ability button for permanents with non-mana activated abilities */}
            {selectedCard && isSelectedOnBattlefield && selectedCardDef &&
              !selectedCardDef.oracle_text.match(/^\(?{T}: Add {[WUBRGC]}\.\)?$/) &&
              selectedCardDef.oracle_text.includes(':') &&
              !selectedCardDef.oracle_text.toLowerCase().startsWith('when') && (
              <button
                onClick={() => activateAbility(selectedCard, 0)}
                className="w-full py-2 px-3 bg-purple-700 hover:bg-purple-600 rounded text-sm font-medium flex items-center justify-center gap-2 border border-purple-600/50"
              >
                <Sparkles className="w-4 h-4" />
                Activate Ability
              </button>
            )}

            {/* Attack button for creatures during combat */}
            {canSelectedAttack && selectedCard && (
              <button
                onClick={() => declareAttacker(selectedCard)}
                className="w-full py-2 px-3 bg-red-700 hover:bg-red-600 rounded text-sm font-medium flex items-center justify-center gap-2 border border-red-600/50"
              >
                <Swords className="w-4 h-4" />
                Attack with {selectedCardDef?.name}
              </button>
            )}

            {/* Confirm attackers button */}
            {isAttackPhase && (
              <button
                onClick={confirmAttackers}
                className="w-full py-2 px-3 bg-red-800 hover:bg-red-700 rounded text-sm font-medium flex items-center justify-center gap-2 border border-red-600/50"
              >
                <Shield className="w-4 h-4" />
                Confirm Attackers ({gameState.combat?.attackers.length || 0})
              </button>
            )}

            {/* Status */}
            <div className="text-xs py-1 space-y-1">
              {humanPlayer.hasPlayedLand ? (
                <div className="text-slate-500">Land played this turn</div>
              ) : (
                <div className="text-green-400">Can play a land</div>
              )}
              {isAttackPhase && (
                <div className="text-red-400">Combat! Select creatures to attack</div>
              )}
              {isBlockPhase && (
                <div className="text-orange-400">Declare blockers!</div>
              )}
            </div>

            {/* Always-available actions */}
            <button
              onClick={passPriorityAction}
              disabled={isGameOver}
              className="w-full py-2 px-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded text-sm font-medium flex items-center justify-center gap-2 border border-slate-600"
            >
              <SkipForward className="w-4 h-4" />
              Pass Priority
            </button>
            <button
              onClick={endTurn}
              disabled={isGameOver}
              className="w-full py-2 px-3 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 rounded text-sm font-medium flex items-center justify-center gap-2 border border-amber-600/50"
            >
              <Play className="w-4 h-4" />
              End Turn
            </button>

            {selectedCard && (
              <div className="flex gap-2">
                <button
                  onClick={() => setInspectedCard(selectedCard)}
                  className="flex-1 py-1 px-3 bg-slate-700 hover:bg-slate-600 rounded text-xs flex items-center justify-center gap-1 border border-slate-600"
                >
                  <Eye className="w-3 h-3" />
                  Inspect
                </button>
                <button
                  onClick={() => selectCard(null)}
                  className="flex-1 py-1 px-3 bg-slate-600 hover:bg-slate-500 rounded text-xs"
                >
                  Deselect
                </button>
              </div>
            )}
          </ZoneBox>

          {/* Game Log */}
          <ZoneBox className="flex-1 p-3 overflow-hidden flex flex-col min-h-0">
            <ZoneLabel>Game Log</ZoneLabel>
            <div className="flex-1 overflow-y-auto space-y-1 text-xs">
              {gameLog.map((log, i) => (
                <div
                  key={i}
                  className={`py-1 border-b border-slate-700/50 ${
                    log.type === 'action' ? 'text-green-400' :
                    log.type === 'spell' ? 'text-blue-400' :
                    log.type === 'ai' ? 'text-amber-400' :
                    'text-slate-400'
                  }`}
                >
                  {log.message}
                </div>
              ))}
              {gameLog.length === 0 && (
                <div className="text-slate-600">Game starting...</div>
              )}
            </div>
          </ZoneBox>
        </div>
      </div>

      {/* Hand - Fixed at bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-amber-600/30 p-3 z-40">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-2 mb-2">
            <Hand className="w-4 h-4 text-amber-400/80" />
            <span className="text-xs text-amber-400/80 uppercase tracking-wider font-semibold">Your Hand ({handCards.length} cards)</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {handCards.map(card => {
              const def = getCardDef(card.definitionId);
              const isLand = def?.card_types.includes('land');
              const isCastable = castableCards.has(card.instanceId);
              return (
                <div
                  key={card.instanceId}
                  onClick={() => {
                    if (selectedCard === card.instanceId) {
                      setInspectedCard(card.instanceId);
                    } else {
                      selectCard(card.instanceId);
                    }
                  }}
                  onDoubleClick={() => setInspectedCard(card.instanceId)}
                  className={`flex-shrink-0 w-32 h-44 rounded-lg border p-2.5 cursor-pointer transition-all hover:-translate-y-2 relative ${
                    selectedCard === card.instanceId
                      ? 'border-amber-400 ring-2 ring-amber-400/50 -translate-y-2 bg-slate-700'
                      : isCastable
                      ? 'border-green-500/60 shadow-green-500/20 shadow-md hover:border-green-400 bg-slate-800'
                      : 'border-slate-600 hover:border-amber-600/50 bg-slate-800 opacity-70'
                  }`}
                >
                  {isCastable && selectedCard !== card.instanceId && (
                    <div className="absolute top-1 left-1 w-2.5 h-2.5 bg-green-500 rounded-full z-10" />
                  )}
                  <div className="text-sm font-medium mb-1 truncate">{def?.name}</div>
                  <div className="text-[10px] text-amber-400 mb-0.5">{def?.mana_cost || '(Land)'}</div>
                  <div className="text-[9px] text-slate-400 mb-1 truncate">{def?.type_line}</div>
                  <div className="text-[9px] text-slate-300 line-clamp-4">{def?.oracle_text}</div>
                  {def?.power !== undefined && (
                    <div className="absolute bottom-1.5 right-1.5 bg-slate-700 px-1.5 py-0.5 rounded text-xs font-bold">
                      {def.power}/{def.toughness}
                    </div>
                  )}
                  {isLand && (
                    <div className="absolute top-1.5 right-1.5 bg-green-700/80 px-1 py-0.5 rounded text-[9px]">
                      Land
                    </div>
                  )}
                </div>
              );
            })}
            {handCards.length === 0 && (
              <div className="text-slate-600">No cards in hand</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
