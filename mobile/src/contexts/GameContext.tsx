/**
 * GameContext
 *
 * Provides game state and actions to all game components.
 * Wraps useGameEngine, useGameState, and useAI hooks.
 */

import React, { createContext, useContext, useEffect, useCallback, useState } from 'react';
import type {
  GameState,
  Player,
  CardInstance,
  CardDefinition,
  Phase,
  Step,
  Zone,
  ManaColor,
  StackItem,
  CombatState,
  AttackerDeclaration,
  BlockerDeclaration,
  AIPlayerConfig,
  AIAction,
  OverlayState,
  SelectionState,
  GameConfig,
  TargetSpec,
} from '@/types';
import { useGameEngine } from '@/hooks/useGameEngine';
import { useGameState } from '@/hooks/useGameState';
import { useAI } from '@/hooks/useAI';
import { useTargeting } from '@/hooks/useTargeting';
import { useCombat } from '@/hooks/useCombat';
import { getSpellTargetSpecs, getLegalTargets } from '@engine/ai/legal-actions';

// Sample deck for testing - minimal cards
import { createSampleDecks } from '@/services/CardLoader';

interface GameContextValue {
  // Game state
  gameState: GameState | null;
  humanPlayerId: string;
  isLoading: boolean;
  error: string | null;

  // Derived state
  humanPlayer: Player | null;
  opponents: Player[];
  activePlayer: Player | null;
  priorityPlayer: Player | null;
  hand: CardInstance[];
  battlefield: CardInstance[];
  lands: CardInstance[];
  creatures: CardInstance[];
  otherPermanents: CardInstance[];
  graveyard: CardInstance[];
  commandZone: CardInstance[];
  isYourTurn: boolean;
  hasYourPriority: boolean;
  currentPhase: Phase;
  currentStep: Step;
  turnNumber: number;
  stackItems: StackItem[];
  hasStackItems: boolean;
  combatState: CombatState | null;
  isInCombat: boolean;
  isDeclareAttackersStep: boolean;
  isDeclareBlockersStep: boolean;

  // AI state
  isAIThinking: boolean;

  // Overlay state
  overlays: OverlayState;
  setOverlay: <K extends keyof OverlayState>(key: K, value: OverlayState[K]) => void;
  toggleOverlay: (key: keyof OverlayState) => void;

  // Selection state
  selection: SelectionState;
  setSelection: (state: SelectionState) => void;

  // Targeting state
  targeting: {
    isTargeting: boolean;
    sourceCardId: string | null;
    sourceCardName: string | null;
    validTargets: string[];
    selectedTargets: string[];
    requiredCount: number;
    hasEnoughTargets: boolean;
  };
  startTargeting: (cardInstanceId: string) => void;
  selectTarget: (targetId: string) => void;
  confirmTargeting: () => void;
  cancelTargeting: () => void;
  isValidTarget: (targetId: string) => boolean;
  isSelectedTarget: (targetId: string) => boolean;

  // Combat state (from useCombat)
  combat: {
    isDeclaringAttackers: boolean;
    isDeclaringBlockers: boolean;
    pendingAttackers: Map<string, string>;
    pendingBlockers: Map<string, string>;
  };
  toggleAttacker: (cardId: string, defenderId: string) => void;
  assignBlocker: (blockerId: string, attackerId: string) => void;
  confirmAttackers: () => void;
  confirmBlockers: () => void;
  skipCombat: () => void;

  // Actions
  playLand: (cardInstanceId: string) => void;
  castSpell: (cardInstanceId: string, targets: string[]) => void;
  activateMana: (cardInstanceId: string, color: ManaColor) => void;
  tapPermanent: (cardInstanceId: string) => void;
  declareAttackers: (attacks: AttackerDeclaration[]) => void;
  declareBlockers: (blocks: BlockerDeclaration[]) => void;
  passPriority: () => void;

  // Queries
  canPlayLand: (cardInstanceId: string) => boolean;
  canCastSpell: (cardInstanceId: string) => boolean;
  getLegalActions: () => AIAction[];
  getCardsInZone: (playerId: string, zone: Zone) => CardInstance[];
  getDefinition: (card: CardInstance) => CardDefinition | undefined;
  getSpellTargetSpecs: (cardInstanceId: string) => TargetSpec[];
  getValidTargetsForSpec: (spec: TargetSpec) => string[];

  // Save/Load
  setGameState: (state: GameState) => void;
}

const GameContext = createContext<GameContextValue | null>(null);

const defaultOverlays: OverlayState = {
  hand: false,
  stack: false,
  cardZoom: null,
  zoneBrowser: null,
  lifeTotal: null,
  gameMenu: false,
  manaPool: false,
  opponent: null,
};

const defaultSelection: SelectionState = {
  mode: 'none',
  validTargets: [],
  selectedTargets: [],
};

interface GameProviderProps {
  config: GameConfig;
  children: React.ReactNode;
}

export function GameProvider({ config, children }: GameProviderProps) {
  const [overlays, setOverlays] = useState<OverlayState>(defaultOverlays);
  const [selection, setSelection] = useState<SelectionState>(defaultSelection);
  const [targetingSourceCard, setTargetingSourceCard] = useState<{id: string; name: string} | null>(null);

  // Initialize engine
  const engine = useGameEngine();

  // Derived state selectors
  const derivedState = useGameState(engine.gameState, engine.humanPlayerId);

  // AI management
  const ai = useAI(engine.gameState, engine.humanPlayerId, engine.setGameState);

  // Targeting management
  const targeting = useTargeting(engine.gameState, engine.humanPlayerId);

  // Combat management
  const combat = useCombat(engine.gameState, engine.humanPlayerId);

  // Initialize game on mount
  useEffect(() => {
    const humanPlayerId = config.players.find(p => !p.isAI)?.id ?? 'player-1';

    // Create sample decks for testing
    const decks = createSampleDecks(config.players.map(p => ({
      playerId: p.id,
      playerName: p.name,
    })));

    // Initialize game
    engine.initGame(decks, humanPlayerId);

    // Configure AI players
    for (const player of config.players) {
      if (player.isAI) {
        ai.setAIConfig(player.id, player.difficulty);
      }
    }
  }, [config]);

  // Overlay management
  const setOverlay = useCallback(<K extends keyof OverlayState>(
    key: K,
    value: OverlayState[K]
  ) => {
    setOverlays(prev => ({ ...prev, [key]: value }));
  }, []);

  const toggleOverlay = useCallback((key: keyof OverlayState) => {
    setOverlays(prev => {
      const current = prev[key];
      if (typeof current === 'boolean') {
        return { ...prev, [key]: !current };
      }
      return prev;
    });
  }, []);

  // Get spell target specs for a card
  const handleGetSpellTargetSpecs = useCallback((cardInstanceId: string): TargetSpec[] => {
    if (!engine.gameState) return [];
    const card = engine.gameState.cards.get(cardInstanceId);
    if (!card) return [];
    return getSpellTargetSpecs(engine.gameState, card);
  }, [engine.gameState]);

  // Get valid targets for a spec
  const handleGetValidTargetsForSpec = useCallback((spec: TargetSpec): string[] => {
    if (!engine.gameState) return [];
    return getLegalTargets(engine.gameState, engine.humanPlayerId, spec);
  }, [engine.gameState, engine.humanPlayerId]);

  // Start targeting mode for a spell
  const handleStartTargeting = useCallback((cardInstanceId: string) => {
    if (!engine.gameState) return;
    const card = engine.gameState.cards.get(cardInstanceId);
    if (!card) return;
    const def = engine.gameState.cardDefinitions.get(card.definitionId);
    const specs = getSpellTargetSpecs(engine.gameState, card);
    if (specs.length === 0) return;

    // Calculate total required targets
    const totalRequired = specs.reduce((sum, s) => sum + s.count, 0);
    setTargetingSourceCard({ id: cardInstanceId, name: def?.name ?? 'Unknown' });
    targeting.startTargeting(cardInstanceId, specs, totalRequired);
  }, [engine.gameState, targeting]);

  // Confirm targeting and cast spell
  const handleConfirmTargeting = useCallback(() => {
    if (!targetingSourceCard) return;
    const targets = targeting.confirmTargets();
    engine.castSpell(targetingSourceCard.id, targets);
    setTargetingSourceCard(null);
  }, [targetingSourceCard, targeting, engine]);

  // Cancel targeting
  const handleCancelTargeting = useCallback(() => {
    targeting.cancelTargeting();
    setTargetingSourceCard(null);
  }, [targeting]);

  // Check if a target ID is valid
  const isValidTarget = useCallback((targetId: string): boolean => {
    return targeting.validTargets.includes(targetId);
  }, [targeting.validTargets]);

  // Check if a target ID is selected
  const isSelectedTarget = useCallback((targetId: string): boolean => {
    return targeting.selectedTargets.includes(targetId);
  }, [targeting.selectedTargets]);

  // Combat actions
  const handleConfirmAttackers = useCallback(() => {
    const attacks = combat.getAttackerDeclarations();
    engine.declareAttackers(attacks);
    combat.clearPending();
  }, [combat, engine]);

  const handleConfirmBlockers = useCallback(() => {
    const blocks = combat.getBlockerDeclarations();
    engine.declareBlockers(blocks);
    combat.clearPending();
  }, [combat, engine]);

  const handleSkipCombat = useCallback(() => {
    // Declare no attackers / no blockers
    if (combat.isDeclaringAttackers) {
      engine.declareAttackers([]);
    } else if (combat.isDeclaringBlockers) {
      engine.declareBlockers([]);
    }
    combat.clearPending();
  }, [combat, engine]);

  const value: GameContextValue = {
    // Game state
    gameState: engine.gameState,
    humanPlayerId: engine.humanPlayerId,
    isLoading: engine.isLoading,
    error: engine.error,

    // Derived state
    ...derivedState,

    // AI state
    isAIThinking: ai.isAIThinking,

    // Overlay state
    overlays,
    setOverlay,
    toggleOverlay,

    // Selection state
    selection,
    setSelection,

    // Targeting state
    targeting: {
      isTargeting: targeting.isTargeting,
      sourceCardId: targetingSourceCard?.id ?? null,
      sourceCardName: targetingSourceCard?.name ?? null,
      validTargets: targeting.validTargets,
      selectedTargets: targeting.selectedTargets,
      requiredCount: targeting.requiredCount,
      hasEnoughTargets: targeting.hasEnoughTargets,
    },
    startTargeting: handleStartTargeting,
    selectTarget: targeting.selectTarget,
    confirmTargeting: handleConfirmTargeting,
    cancelTargeting: handleCancelTargeting,
    isValidTarget,
    isSelectedTarget,

    // Combat state
    combat: {
      isDeclaringAttackers: combat.isDeclaringAttackers,
      isDeclaringBlockers: combat.isDeclaringBlockers,
      pendingAttackers: combat.pendingAttackers,
      pendingBlockers: combat.pendingBlockers,
    },
    toggleAttacker: combat.toggleAttacker,
    assignBlocker: combat.assignBlocker,
    confirmAttackers: handleConfirmAttackers,
    confirmBlockers: handleConfirmBlockers,
    skipCombat: handleSkipCombat,

    // Actions
    playLand: engine.playLand,
    castSpell: engine.castSpell,
    activateMana: engine.activateMana,
    tapPermanent: engine.tapPermanent,
    declareAttackers: engine.declareAttackers,
    declareBlockers: engine.declareBlockers,
    passPriority: engine.passPriority,

    // Queries
    canPlayLand: engine.canPlayLand,
    canCastSpell: engine.canCastSpell,
    getLegalActions: engine.getLegalActions,
    getCardsInZone: engine.getCardsInZone,
    getDefinition: derivedState.getDefinition,
    getSpellTargetSpecs: handleGetSpellTargetSpecs,
    getValidTargetsForSpec: handleGetValidTargetsForSpec,

    // Save/Load
    setGameState: engine.setGameState,
  };

  return (
    <GameContext.Provider value={value}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame(): GameContextValue {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
}
