/**
 * Legal Action Generation
 *
 * Enumerates all legal actions available to a player from a game state.
 */

import { GameState, ManaColor, CardInstance, AttackerDeclaration, BlockerDeclaration } from '../types';
import { getCardsInZone, getCardDefinition } from '../game-state';
import { canCastSpell } from '../stack';
import { canPlayLand, getActivatedAbilities, canActivateAbility } from '../actions';
import { canDeclareAttacker, canDeclareBlocker } from '../combat';
import { getOverride } from '../effects/overrides';
import { parseOracleText } from '../effects/parser';
import type { TargetSpec } from '../effects/targets';
import type {
  AIAction,
  CastSpellAction,
  PlayLandAction,
  ActivateManaAbilityAction,
  ActivateAbilityAction,
  DeclareAttackersAction,
  DeclareBlockersAction,
  PassPriorityAction,
} from './types';

/**
 * Check if player has priority in the current game state.
 */
export function hasPriority(state: GameState, playerId: string): boolean {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  return state.priorityPlayerIndex === playerIndex;
}

/**
 * Determine what mana colors a land can produce.
 * Simplified: basic lands produce their color, others produce colorless.
 */
function getLandManaColors(state: GameState, card: CardInstance): ManaColor[] {
  const def = getCardDefinition(state, card);
  const typeLine = def.type_line.toLowerCase();

  // Basic lands
  if (typeLine.includes('plains')) return ['W'];
  if (typeLine.includes('island')) return ['U'];
  if (typeLine.includes('swamp')) return ['B'];
  if (typeLine.includes('mountain')) return ['R'];
  if (typeLine.includes('forest')) return ['G'];

  // Check oracle text for mana production
  const oracle = def.oracle_text.toLowerCase();
  const colors: ManaColor[] = [];

  if (oracle.includes('{w}') || oracle.includes('add {w}')) colors.push('W');
  if (oracle.includes('{u}') || oracle.includes('add {u}')) colors.push('U');
  if (oracle.includes('{b}') || oracle.includes('add {b}')) colors.push('B');
  if (oracle.includes('{r}') || oracle.includes('add {r}')) colors.push('R');
  if (oracle.includes('{g}') || oracle.includes('add {g}')) colors.push('G');
  if (oracle.includes('{c}') || oracle.includes('add {c}')) colors.push('C');

  // Default: colorless for unknown lands
  if (colors.length === 0) colors.push('C');

  return colors;
}

/**
 * Get the required targets for a card spell.
 */
export function getSpellTargetSpecs(state: GameState, card: CardInstance): TargetSpec[] {
  const def = getCardDefinition(state, card);

  // Check for override first
  const override = getOverride(def.id, def.name);
  if (override && override.kind === 'Spell') {
    return override.targets;
  }

  // Try to parse oracle text
  const parsed = parseOracleText(def.oracle_text);
  if (parsed.kind === 'Spell') {
    return parsed.targets;
  }

  return [];
}

/**
 * Get legal targets for a target specification.
 */
export function getLegalTargets(
  state: GameState,
  casterId: string,
  spec: TargetSpec,
): string[] {
  const targets: string[] = [];

  if (spec.type === 'Player') {
    for (const player of state.players) {
      if (!player.hasLost) {
        targets.push(player.id);
      }
    }
  } else if (spec.type === 'Creature') {
    for (const card of state.cards.values()) {
      if (card.zone !== 'battlefield') continue;
      const def = state.cardDefinitions.get(card.definitionId);
      if (!def?.card_types.includes('creature')) continue;

      // Check opponentControls constraint
      if (spec.constraints?.opponentControls && card.ownerId === casterId) continue;

      targets.push(card.instanceId);
    }
  } else if (spec.type === 'Any') {
    // Players
    for (const player of state.players) {
      if (!player.hasLost) {
        targets.push(player.id);
      }
    }
    // Creatures
    for (const card of state.cards.values()) {
      if (card.zone !== 'battlefield') continue;
      const def = state.cardDefinitions.get(card.definitionId);
      if (!def?.card_types.includes('creature')) continue;
      targets.push(card.instanceId);
    }
  }

  return targets;
}

/**
 * Generate all legal cast spell actions (without targets).
 */
function generateModalActions(
  state: GameState,
  playerId: string,
  card: CardInstance,
  actions: CastSpellAction[],
  parsed: ReturnType<typeof parseOracleText>,
): boolean {
  if (parsed.kind !== 'Modal') return false;

  const modal = parsed.modal;

  if (modal.chooseCount === 1) {
    for (let i = 0; i < modal.choices.length; i++) {
      const choice = modal.choices[i];
      if (choice.targets.length === 0) {
        // Targetless mode
        actions.push({
          kind: 'CastSpell',
          cardInstanceId: card.instanceId,
          targets: [],
          chosenModes: [i],
        });
      } else {
        // Mode with targets — get legal targets for each target spec
        const specs: TargetSpec[] = choice.targets.map(t => ({
          id: t.id,
          type: t.type as any,
          count: 1,
        }));
        if (specs.length === 1) {
          const legalTargets = getLegalTargets(state, playerId, specs[0]);
          for (const target of legalTargets) {
            actions.push({
              kind: 'CastSpell',
              cardInstanceId: card.instanceId,
              targets: [target],
              chosenModes: [i],
            });
          }
        }
      }
    }
  } else if (modal.chooseCount === 2 && modal.choices.length >= 2) {
    // Generate pairs of modes
    for (let i = 0; i < modal.choices.length; i++) {
      for (let j = i + 1; j < modal.choices.length; j++) {
        // For simplicity, only generate targetless combinations in v0
        const ci = modal.choices[i];
        const cj = modal.choices[j];
        if (ci.targets.length === 0 && cj.targets.length === 0) {
          actions.push({
            kind: 'CastSpell',
            cardInstanceId: card.instanceId,
            targets: [],
            chosenModes: [i, j],
          });
        }
      }
    }
  }

  return true;
}

function generateCastSpellActions(state: GameState, playerId: string): CastSpellAction[] {
  const actions: CastSpellAction[] = [];

  // Check hand
  const hand = getCardsInZone(state, playerId, 'hand');
  for (const card of hand) {
    if (canCastSpell(state, playerId, card.instanceId)) {
      // Check for modal spells first
      const def = getCardDefinition(state, card);
      const parsed = parseOracleText(def.oracle_text, def.mana_cost);

      if (generateModalActions(state, playerId, card, actions, parsed)) {
        continue; // Skip normal spell handling for modal spells
      }

      // Get target specs for this spell
      const specs = getSpellTargetSpecs(state, card);

      if (specs.length === 0) {
        // No targets needed
        actions.push({
          kind: 'CastSpell',
          cardInstanceId: card.instanceId,
          targets: [],
        });
      } else {
        // Generate actions for each valid target combination
        // For v0, handle single-target spells only
        if (specs.length === 1 && specs[0].count === 1) {
          const legalTargets = getLegalTargets(state, playerId, specs[0]);
          for (const target of legalTargets) {
            actions.push({
              kind: 'CastSpell',
              cardInstanceId: card.instanceId,
              targets: [target],
            });
          }
        }
        // Multi-target spells would need combinatorial expansion (future)
      }
    }
  }

  // Check command zone (for commander)
  const commandZone = getCardsInZone(state, playerId, 'command');
  for (const card of commandZone) {
    if (canCastSpell(state, playerId, card.instanceId)) {
      // Check for modal spells first
      const def = getCardDefinition(state, card);
      const parsed = parseOracleText(def.oracle_text, def.mana_cost);

      if (generateModalActions(state, playerId, card, actions, parsed)) {
        continue; // Skip normal spell handling for modal commanders
      }

      const specs = getSpellTargetSpecs(state, card);
      if (specs.length === 0) {
        actions.push({
          kind: 'CastSpell',
          cardInstanceId: card.instanceId,
          targets: [],
        });
      }
      // Commanders with targets would follow same pattern as above
    }
  }

  return actions;
}

/**
 * Generate all legal play land actions.
 */
function generatePlayLandActions(state: GameState, playerId: string): PlayLandAction[] {
  const actions: PlayLandAction[] = [];

  const hand = getCardsInZone(state, playerId, 'hand');
  for (const card of hand) {
    if (canPlayLand(state, playerId, card.instanceId)) {
      actions.push({
        kind: 'PlayLand',
        cardInstanceId: card.instanceId,
      });
    }
  }

  return actions;
}

/**
 * Generate mana ability activations.
 */
function generateManaActions(state: GameState, playerId: string): ActivateManaAbilityAction[] {
  const actions: ActivateManaAbilityAction[] = [];

  const battlefield = getCardsInZone(state, playerId, 'battlefield');
  for (const card of battlefield) {
    if (card.tapped) continue;

    const def = getCardDefinition(state, card);
    if (!def.card_types.includes('land')) continue;

    // Get all colors this land can produce
    const colors = getLandManaColors(state, card);
    for (const color of colors) {
      actions.push({
        kind: 'ActivateManaAbility',
        cardInstanceId: card.instanceId,
        color,
      });
    }
  }

  return actions;
}

/**
 * Generate activated ability actions for non-mana abilities.
 */
function generateActivateAbilityActions(state: GameState, playerId: string): ActivateAbilityAction[] {
  const actions: ActivateAbilityAction[] = [];

  const battlefield = getCardsInZone(state, playerId, 'battlefield');
  for (const card of battlefield) {
    const abilities = getActivatedAbilities(state, card.instanceId);
    for (let i = 0; i < abilities.length; i++) {
      if (!canActivateAbility(state, playerId, card.instanceId, i)) continue;
      // Non-mana abilities only (mana abilities handled separately)
      if (abilities[i].isManaAbility) continue;

      actions.push({
        kind: 'ActivateAbility',
        cardInstanceId: card.instanceId,
        abilityIndex: i,
        targets: [], // Targets will be enhanced by AI targeting logic
      });
    }
  }

  return actions;
}

/**
 * Generate attacker declaration actions.
 *
 * To keep the search space bounded, we generate:
 * 1. Attack with no creatures
 * 2. Attack with each creature individually
 * 3. Attack with all eligible creatures
 *
 * In multiplayer, creatures can attack different players.
 * For v0, we simplify by having all attackers target the same defender.
 */
function generateAttackerActions(state: GameState, playerId: string): DeclareAttackersAction[] {
  if (state.step !== 'declare_attackers') return [];

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (state.activePlayerIndex !== playerIndex) return [];

  const actions: DeclareAttackersAction[] = [];

  // Find all potential attackers
  const eligibleAttackers: CardInstance[] = [];
  const battlefield = getCardsInZone(state, playerId, 'battlefield');
  for (const card of battlefield) {
    if (canDeclareAttacker(state, playerId, card.instanceId)) {
      eligibleAttackers.push(card);
    }
  }

  // Find valid defenders (opponents who haven't lost)
  const defenders = state.players.filter((p, i) =>
    i !== playerIndex && !p.hasLost
  );

  if (defenders.length === 0) {
    // No valid defenders, can only pass
    return [{ kind: 'DeclareAttackers', attacks: [] }];
  }

  // Option 1: Attack with no creatures
  actions.push({ kind: 'DeclareAttackers', attacks: [] });

  // Option 2: Attack with each creature individually (against each defender)
  for (const attacker of eligibleAttackers) {
    for (const defender of defenders) {
      actions.push({
        kind: 'DeclareAttackers',
        attacks: [{ cardInstanceId: attacker.instanceId, defendingPlayerId: defender.id }],
      });
    }
  }

  // Option 3: Attack with all creatures (against the same defender)
  if (eligibleAttackers.length > 1) {
    for (const defender of defenders) {
      const allAttacks: AttackerDeclaration[] = eligibleAttackers.map(a => ({
        cardInstanceId: a.instanceId,
        defendingPlayerId: defender.id,
      }));
      actions.push({ kind: 'DeclareAttackers', attacks: allAttacks });
    }
  }

  return actions;
}

/**
 * Generate blocker declaration actions.
 *
 * Similar bounded search:
 * 1. Block with no creatures
 * 2. Block with each blocker on each attacker
 * 3. Block all attackers (one blocker each if possible)
 */
function generateBlockerActions(state: GameState, playerId: string): DeclareBlockersAction[] {
  if (state.step !== 'declare_blockers') return [];
  if (!state.combat) return [];

  const actions: DeclareBlockersAction[] = [];

  // Find attackers targeting this player
  const incomingAttackers = state.combat.attackers.filter(
    a => a.defendingPlayerId === playerId
  );

  if (incomingAttackers.length === 0) {
    // No attackers to block
    return [{ kind: 'DeclareBlockers', blocks: [] }];
  }

  // Find eligible blockers
  const eligibleBlockers: CardInstance[] = [];
  const battlefield = getCardsInZone(state, playerId, 'battlefield');
  for (const card of battlefield) {
    // Check if this card could block any attacker
    for (const attacker of incomingAttackers) {
      if (canDeclareBlocker(state, playerId, card.instanceId, attacker.cardInstanceId)) {
        eligibleBlockers.push(card);
        break; // Only add once
      }
    }
  }

  // Option 1: No blocks
  actions.push({ kind: 'DeclareBlockers', blocks: [] });

  // Option 2: Each blocker blocks each attacker
  for (const blocker of eligibleBlockers) {
    for (const attacker of incomingAttackers) {
      if (canDeclareBlocker(state, playerId, blocker.instanceId, attacker.cardInstanceId)) {
        actions.push({
          kind: 'DeclareBlockers',
          blocks: [{ cardInstanceId: blocker.instanceId, blockingAttackerId: attacker.cardInstanceId }],
        });
      }
    }
  }

  // Option 3: Block all attackers with one blocker each (greedy assignment)
  if (eligibleBlockers.length > 0 && incomingAttackers.length > 1) {
    const blocks: BlockerDeclaration[] = [];
    const usedBlockers = new Set<string>();

    for (const attacker of incomingAttackers) {
      for (const blocker of eligibleBlockers) {
        if (usedBlockers.has(blocker.instanceId)) continue;
        if (canDeclareBlocker(state, playerId, blocker.instanceId, attacker.cardInstanceId)) {
          blocks.push({ cardInstanceId: blocker.instanceId, blockingAttackerId: attacker.cardInstanceId });
          usedBlockers.add(blocker.instanceId);
          break;
        }
      }
    }

    if (blocks.length > 0) {
      actions.push({ kind: 'DeclareBlockers', blocks });
    }
  }

  return actions;
}

/**
 * Generate the pass priority action.
 */
function generatePassAction(): PassPriorityAction {
  return { kind: 'PassPriority' };
}

/**
 * Generate all legal actions for a player from the current game state.
 */
export function getLegalActions(state: GameState, playerId: string): AIAction[] {
  const actions: AIAction[] = [];

  // Combat actions (only during specific steps, whether or not we have priority)
  const attackerActions = generateAttackerActions(state, playerId);
  const blockerActions = generateBlockerActions(state, playerId);

  if (attackerActions.length > 0) {
    return attackerActions; // Must declare attackers
  }

  if (blockerActions.length > 0) {
    return blockerActions; // Must declare blockers
  }

  // Priority-based actions
  if (!hasPriority(state, playerId)) {
    return []; // No legal actions without priority
  }

  // Spells (includes targeting)
  actions.push(...generateCastSpellActions(state, playerId));

  // Lands (special action, doesn't use stack)
  actions.push(...generatePlayLandActions(state, playerId));

  // Mana abilities (special action, doesn't use stack)
  actions.push(...generateManaActions(state, playerId));

  // Activated abilities (non-mana, uses stack)
  actions.push(...generateActivateAbilityActions(state, playerId));

  // Always can pass priority
  actions.push(generatePassAction());

  return actions;
}
