import { useMemo } from 'react';
import type {
  GameView,
  GameViewInput,
  SimpleCard,
  SimpleGameState,
  PermanentView,
  HandCardView,
  OpponentBoard,
  YouView,
  LegalAction,
  CombatContext,
} from './gameView.types';
import { opponentGlance } from './selectors/opponentGlance';
import { stackView } from './selectors/stackView';
import { legalActionsByObject } from './selectors/legalActionsByObject';
import { priority } from './selectors/priority';
import { targeting } from './selectors/targeting';
import { combat } from './selectors/combat';
import { narration } from './selectors/narration';

function isCreature(card: SimpleCard): boolean {
  return card.cardTypes.includes('creature');
}

function isLand(card: SimpleCard): boolean {
  return card.cardTypes.includes('land');
}

interface PermanentContext {
  legalFor: (id: string) => LegalAction[];
  attackingIds: Set<string>;
  blockingIds: Set<string>;
}

function toPermanentView(card: SimpleCard, ctx: PermanentContext): PermanentView {
  return {
    id: card.instanceId,
    name: card.name,
    tapped: card.tapped,
    power: card.power,
    toughness: card.toughness,
    counters: Object.keys(card.counters).length > 0 ? card.counters : undefined,
    isLand: isLand(card),
    isCreature: isCreature(card),
    isAttacking: ctx.attackingIds.has(card.instanceId) || undefined,
    isBlocking: ctx.blockingIds.has(card.instanceId) || undefined,
    legalActions: ctx.legalFor(card.instanceId),
  };
}

function bucket(
  battlefield: SimpleCard[],
  ctx: PermanentContext,
): { creatures: PermanentView[]; lands: PermanentView[]; other: PermanentView[] } {
  const creatures: PermanentView[] = [];
  const lands: PermanentView[] = [];
  const other: PermanentView[] = [];
  for (const card of battlefield) {
    const view = toPermanentView(card, ctx);
    if (view.isCreature) creatures.push(view);
    else if (view.isLand) lands.push(view);
    else other.push(view);
  }
  return { creatures, lands, other };
}

const EMPTY_VIEW: GameView = {
  you: {
    life: 0,
    poison: 0,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    commandZone: [],
    graveyardCount: 0,
    libraryCount: 0,
    handCount: 0,
    creatures: [],
    lands: [],
    other: [],
    hand: [],
  },
  opponents: [],
  stack: [],
  priority: {
    hasPriority: false,
    isYourTurn: false,
    phaseLabel: '',
    hasMeaningfulResponse: false,
    canPass: false,
    canHold: false,
  },
  targeting: { active: false, prompt: '', minTargets: 0, maxTargets: 0, legalTargetIds: [], selectedTargetIds: [] },
  combat: { step: 'none', eligibleIds: [], eligible: [], assignments: {} },
  narration: [],
  guided: false,
  isYourTurn: false,
  winner: null,
};

/**
 * Pure composer: reshapes the hook's already-derived outputs into one GameView.
 * NEVER re-derives from raw engine state (see engine-hook-api.md architecture note).
 */
export function buildGameView(input: GameViewInput): GameView {
  const { gameState } = input;
  if (!gameState) {
    return { ...EMPTY_VIEW, guided: input.guided, isYourTurn: input.isHumanTurn, winner: input.winner };
  }

  const { byObject, pass } = legalActionsByObject(input.legalActions, {
    hasPriority: input.isHumanTurn,
  });
  const legalFor = (id: string): LegalAction[] => byObject.get(id) ?? [];

  // Committed combat participants (who is currently attacking / blocking).
  // The engine declarations in legalActions represent ELIGIBLE participants while
  // the step is open; once declared they remain in the per-object actions. We treat
  // the eligible set as the combat highlight set and also surface it on permanents.
  const combatCtx = combat({
    step: gameState.step,
    legalActions: input.legalActions,
    damageAssignmentChoice: input.damageAssignmentChoice,
  });
  const attackingIds = new Set(
    combatCtx.step === 'declare-attackers' ? combatCtx.eligibleIds : [],
  );
  const blockingIds = new Set(
    combatCtx.step === 'declare-blockers' ? combatCtx.eligibleIds : [],
  );

  const permCtx: PermanentContext = { legalFor, attackingIds, blockingIds };

  // --- You ---
  const youBuckets = bucket(gameState.humanBattlefield, permCtx);
  const hand: HandCardView[] = gameState.humanHand.map(card => ({
    id: card.instanceId,
    name: card.name,
    manaCost: card.manaCost || undefined,
    legalActions: legalFor(card.instanceId),
  }));
  const you: YouView = {
    life: gameState.humanPlayer.life,
    poison: gameState.humanPlayer.poisonCounters,
    manaPool: gameState.manaPool,
    commandZone: gameState.humanCommandZone.map(card => toPermanentView(card, permCtx)),
    graveyardCount: gameState.humanGraveyard.length,
    libraryCount: gameState.humanPlayer.libraryCount,
    handCount: gameState.humanHand.length,
    creatures: youBuckets.creatures,
    lands: youBuckets.lands,
    other: youBuckets.other,
    hand,
  };

  // --- Opponents ---
  // Opponent permanents never carry the human's legal actions, but they ARE
  // examinable targets; pass an empty action list (the targeting layer highlights
  // legal targets separately).
  const opponentPermCtx: PermanentContext = {
    legalFor: () => [],
    attackingIds: new Set<string>(),
    blockingIds: new Set<string>(),
  };
  const humanCommanderDamage = gameState.humanPlayer.commanderDamage;
  const opponents: OpponentBoard[] = gameState.aiPlayers.map(player => {
    const battlefield = gameState.aiBattlefields[player.id] ?? [];
    const buckets = bucket(battlefield, opponentPermCtx);
    return {
      glance: opponentGlance({ player, battlefield, humanCommanderDamage }),
      creatures: buckets.creatures,
      lands: buckets.lands,
      other: buckets.other,
      graveyardCount: (gameState.aiGraveyards[player.id] ?? []).length,
      exileCount: 0, // exile zone is not surfaced on SimpleGameState today
      commandZone: (gameState.aiCommandZones[player.id] ?? []).map(card =>
        toPermanentView(card, opponentPermCtx),
      ),
    };
  });

  // --- Name resolver for the stack ---
  const nameFor = (playerId: string): string =>
    nameForPlayer(gameState, playerId);

  // True turn ownership (active player == you) — distinct from holding priority,
  // which the hook reports as `isHumanTurn` even on the opponent's turn.
  const isYourTurn = gameState.activePlayerId === gameState.humanPlayer.id;

  // Resolve eligible combatants (always YOUR creatures) to names + P/T so the
  // combat UI shows "Seedborn Muse 2/4", not a raw card instance id.
  const myCreatureById = new Map(gameState.humanBattlefield.map(c => [c.instanceId, c]));
  const combatView: CombatContext = {
    ...combatCtx,
    eligible: combatCtx.eligibleIds.map(id => {
      const card = myCreatureById.get(id);
      return { id, name: card?.name ?? id, power: card?.power, toughness: card?.toughness };
    }),
  };

  return {
    you,
    opponents,
    stack: stackView(gameState.stack, nameFor),
    priority: priority({
      isHumanTurn: input.isHumanTurn,
      isYourTurn,
      legalActions: input.legalActions,
      phase: gameState.phase,
      step: gameState.step,
      canHold: pass != null,
    }),
    targeting: targeting(input.targetingPrompt),
    combat: combatView,
    narration: narration(input.chatMessages),
    guided: input.guided,
    isYourTurn: input.isHumanTurn,
    winner: input.winner,
  };
}

function nameForPlayer(gameState: SimpleGameState, playerId: string): string {
  if (playerId === gameState.humanPlayer.id) return gameState.humanPlayer.name;
  const ai = gameState.aiPlayers.find(player => player.id === playerId);
  if (ai) return ai.name;
  return gameState.aiCommanderNames[playerId] ?? playerId;
}

/**
 * Thin React hook wrapping the pure composer with `useMemo`. Components consume
 * this; tests call `buildGameView` directly.
 */
export function useGameView(input: GameViewInput): GameView {
  return useMemo(
    () => buildGameView(input),
    [
      input.gameState,
      input.legalActions,
      input.isHumanTurn,
      input.winner,
      input.guided,
      input.targetingPrompt,
      input.currentPrompt,
      input.chatMessages,
      input.damageAssignmentChoice,
    ],
  );
}
