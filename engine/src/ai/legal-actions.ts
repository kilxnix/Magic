/**
 * Legal Action Generation
 *
 * Enumerates all legal actions available to a player from a game state.
 */

import { GameState, CardInstance, AttackerDeclaration, BlockerDeclaration, isSpellStackItem } from '../types';
import { getCardsInZone, getCardDefinition } from '../game-state';
import { canCastSpell, getCastSpellDefinition, getEffectiveCastCost, type CastSpellOptions } from '../stack';
import { canPlayLand, getActivatedAbilities, canActivateAbility, isBlockedBySummoningSicknessForTap, getAvailableManaColors } from '../actions';
import { canDeclareAttacker, canDeclareBlocker, hasPlayerDeclaredBlockers } from '../combat';
import { canPaySpellCost, canPayUnrestrictedCost } from '../mana';
import { getOverride } from '../effects/overrides';
import { parseOracleText } from '../effects/parser';
import { matchesCardFilter } from '../effects/executor';
import { isEffectiveCreature } from '../effective-types';
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
  EquipAction,
} from './types';

function normalizeOracleForParser(oracleText: string, cardName: string): string {
  if (!cardName) return oracleText;
  const escaped = cardName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return oracleText.replace(new RegExp(escaped, 'gi'), '~');
}

/**
 * Check if player has priority in the current game state.
 */
export function hasPriority(state: GameState, playerId: string): boolean {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  return state.priorityPlayerIndex === playerIndex;
}

/**
 * Get the required targets for a card spell.
 */
export function getSpellTargetSpecs(
  state: GameState,
  card: CardInstance,
  options: CastSpellOptions = {},
): TargetSpec[] {
  const def = getCastSpellDefinition(state, card.instanceId, options) ?? getCardDefinition(state, card);

  // Check for override first
  const override = getOverride(def.id, def.name);
  if (override && override.kind === 'Spell') {
    return override.targets;
  }

  if (def.card_types.includes('enchantment') && /\baura\b/i.test(def.type_line)) {
    if (/\benchant\s+creature\b/i.test(def.oracle_text)) {
      return [{ id: 'aura_target', type: 'Creature', count: 1 }];
    }
  }

  // Permanent cards usually do not choose their ETB/activated-ability targets
  // while being cast. Those choices happen after the spell resolves and the
  // ability is on the stack. Without this guard, cards like Stella Lee can have
  // their activated ability text mistaken for cast-time spell targets.
  if (def.card_types.some(type => ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle'].includes(type))) {
    return [];
  }

  // Try to parse oracle text
  const parsed = parseOracleText(normalizeOracleForParser(def.oracle_text, def.name), def.mana_cost);
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
        if (spec.constraints?.opponentControls && player.id === casterId) continue;
        targets.push(player.id);
      }
    }
  } else if (spec.type === 'Creature') {
    for (const card of state.cards.values()) {
      if (card.zone !== 'battlefield') continue;
      if (!isEffectiveCreature(state, card.instanceId)) continue;

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
      if (!isEffectiveCreature(state, card.instanceId)) continue;
      targets.push(card.instanceId);
    }
  } else if (
    spec.type === 'Spell'
    || spec.type === 'NoncreatureSpell'
    || spec.type === 'CreatureSpell'
    || spec.type === 'CreatureOrEnchantmentSpell'
    || spec.type === 'ArtifactOrCreatureSpell'
    || spec.type === 'InstantOrSorcerySpell'
  ) {
    for (const item of state.stack) {
      if (!isSpellStackItem(item)) continue;
      const card = state.cards.get(item.cardInstanceId);
      const def = card ? getCastSpellDefinition(state, item.cardInstanceId, { faceName: item.faceName }) : undefined;
      if (!card || !def) continue;
      if (spec.type === 'NoncreatureSpell' && def.card_types.includes('creature')) continue;
      if (spec.type === 'CreatureSpell' && !def.card_types.includes('creature')) continue;
      if (spec.type === 'CreatureOrEnchantmentSpell' && !def.card_types.includes('creature') && !def.card_types.includes('enchantment')) continue;
      if (spec.type === 'ArtifactOrCreatureSpell' && !def.card_types.includes('artifact') && !def.card_types.includes('creature')) continue;
      if (spec.type === 'InstantOrSorcerySpell' && !def.card_types.includes('instant') && !def.card_types.includes('sorcery')) continue;
      targets.push(card.instanceId);
    }
  } else if (
    spec.type === 'Permanent'
    || spec.type === 'NonlandPermanent'
    || spec.type === 'Land'
    || spec.type === 'Artifact'
    || spec.type === 'Enchantment'
    || spec.type === 'ArtifactOrEnchantment'
    || spec.type === 'ArtifactEnchantmentOrLand'
  ) {
    for (const card of state.cards.values()) {
      if (card.zone !== 'battlefield') continue;
      const def = getCardDefinition(state, card);

      if (spec.type === 'NonlandPermanent' && def.card_types.includes('land')) continue;
      if (spec.type === 'Land' && !def.card_types.includes('land')) continue;
      if (spec.type === 'Artifact' && !def.card_types.includes('artifact')) continue;
      if (spec.type === 'Enchantment' && !def.card_types.includes('enchantment')) continue;
      if (
        spec.type === 'ArtifactOrEnchantment'
        && !def.card_types.includes('artifact')
        && !def.card_types.includes('enchantment')
      ) continue;
      if (
        spec.type === 'ArtifactEnchantmentOrLand'
        && !def.card_types.includes('artifact')
        && !def.card_types.includes('enchantment')
        && !def.card_types.includes('land')
      ) continue;
      if (spec.constraints?.opponentControls && card.ownerId === casterId) continue;

      targets.push(card.instanceId);
    }
  } else if (
    spec.type === 'CardInGraveyard'
    || spec.type === 'CreatureCardInGraveyard'
    || spec.type === 'CreatureOrEnchantmentCardInGraveyard'
  ) {
    for (const card of state.cards.values()) {
      if (card.zone !== 'graveyard') continue;
      const def = getCardDefinition(state, card);
      if (spec.type === 'CreatureCardInGraveyard' && !def.card_types.includes('creature')) continue;
      if (
        spec.type === 'CreatureOrEnchantmentCardInGraveyard'
        && !def.card_types.includes('creature')
        && !def.card_types.includes('enchantment')
      ) continue;
      if (spec.constraints?.opponentControls && card.ownerId === casterId) continue;
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
  baseOptions: CastSpellOptions = {},
): boolean {
  if (parsed.kind !== 'Modal') return false;
  const startingActionCount = actions.length;

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
          ...baseOptions,
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
              ...baseOptions,
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
            ...baseOptions,
          });
        }
      }
    }
  }

  return actions.length > startingActionCount;
}

function generateTargetCombinations(
  state: GameState,
  playerId: string,
  specs: TargetSpec[],
): string[][] {
  if (specs.length === 0) return [[]];
  if (specs.some(spec => spec.count !== 1)) return [];

  let combinations: string[][] = [[]];
  for (const spec of specs) {
    const legalTargets = getLegalTargets(state, playerId, spec);
    const next: string[][] = [];
    for (const existing of combinations) {
      for (const target of legalTargets) {
        next.push([...existing, target]);
      }
    }
    combinations = next;
    if (combinations.length > 100) {
      combinations = combinations.slice(0, 100);
      break;
    }
  }
  return combinations;
}

function hasXCost(def: ReturnType<typeof getCardDefinition>): boolean {
  return /\{X\}/i.test(def.mana_cost);
}

function legalXValuesForSpell(
  state: GameState,
  playerId: string,
  card: CardInstance,
  def: ReturnType<typeof getCardDefinition>,
  baseOptions: CastSpellOptions = {},
): number[] {
  if (!hasXCost(def)) return [0];
  const player = state.players.find(p => p.id === playerId);
  if (!player) return [];
  const values: number[] = [];
  for (let xValue = 0; xValue <= 20; xValue++) {
    const cost = getEffectiveCastCost(state, playerId, card.instanceId, { ...baseOptions, xValue });
    if (cost && canPaySpellCost(player, cost, def, card)) values.push(xValue);
  }
  return values;
}

function withXValues(
  state: GameState,
  playerId: string,
  card: CardInstance,
  def: ReturnType<typeof getCardDefinition>,
  baseAction: Omit<CastSpellAction, 'xValue'>,
): CastSpellAction[] {
  if (!hasXCost(def)) return [baseAction];
  return legalXValuesForSpell(state, playerId, card, def, {
    faceName: baseAction.faceName,
  }).map(xValue => ({
    ...baseAction,
    xValue,
  }));
}

function castFacesForCard(
  state: GameState,
  card: CardInstance,
): Array<{ def: ReturnType<typeof getCardDefinition>; options: CastSpellOptions }> {
  const baseDef = getCardDefinition(state, card);
  if (!baseDef.faces || baseDef.faces.length === 0) {
    return [{ def: baseDef, options: {} }];
  }
  const casts: Array<{ def: ReturnType<typeof getCardDefinition>; options: CastSpellOptions }> = [];
  for (const face of baseDef.faces) {
    const options: CastSpellOptions = { faceName: face.name };
    const def = getCastSpellDefinition(state, card.instanceId, options);
    if (def) casts.push({ def, options });
  }
  return casts;
}

function generateCastSpellActions(state: GameState, playerId: string): CastSpellAction[] {
  const actions: CastSpellAction[] = [];

  // Check hand
  const hand = getCardsInZone(state, playerId, 'hand');
  for (const card of hand) {
    for (const faceCast of castFacesForCard(state, card)) {
      if (!canCastSpell(state, playerId, card.instanceId, faceCast.options)) continue;
      // Check for modal spells first
      const def = faceCast.def;
      const parsed = parseOracleText(normalizeOracleForParser(def.oracle_text, def.name), def.mana_cost);

      if (generateModalActions(state, playerId, card, actions, parsed, faceCast.options)) {
        continue; // Skip normal spell handling for modal spells
      }

      // Get target specs for this spell
      const specs = getSpellTargetSpecs(state, card, faceCast.options);

      if (specs.length === 0) {
        // No targets needed
        actions.push(...withXValues(state, playerId, card, def, {
            kind: 'CastSpell',
            cardInstanceId: card.instanceId,
            targets: [],
            ...faceCast.options,
          }));
      } else {
        for (const targets of generateTargetCombinations(state, playerId, specs)) {
          actions.push(...withXValues(state, playerId, card, def, {
              kind: 'CastSpell',
              cardInstanceId: card.instanceId,
              targets,
              ...faceCast.options,
            }));
        }
      }
    }
  }

  // Check command zone (for commander)
  const commandZone = getCardsInZone(state, playerId, 'command');
  for (const card of commandZone) {
    for (const faceCast of castFacesForCard(state, card)) {
      if (!canCastSpell(state, playerId, card.instanceId, faceCast.options)) continue;
      // Check for modal spells first
      const def = faceCast.def;
      const parsed = parseOracleText(normalizeOracleForParser(def.oracle_text, def.name), def.mana_cost);

      if (generateModalActions(state, playerId, card, actions, parsed, faceCast.options)) {
        continue; // Skip normal spell handling for modal commanders
      }

      const specs = getSpellTargetSpecs(state, card, faceCast.options);
      if (specs.length === 0) {
        actions.push(...withXValues(state, playerId, card, def, {
            kind: 'CastSpell',
            cardInstanceId: card.instanceId,
            targets: [],
            ...faceCast.options,
          }));
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
    const def = getCardDefinition(state, card);

    if (!def.manaProduction) continue;
    if (def.manaProduction.activationZone === 'hand') continue;
    if (def.manaProduction.isTapAbility && card.tapped) continue;
    if (def.manaProduction.isTapAbility && isBlockedBySummoningSicknessForTap(state, card.instanceId)) continue;
    if (def.manaProduction.sacrificeFilter) {
      const canPaySacrificeCost = battlefield.some(candidate => {
        if (candidate.instanceId === card.instanceId) return false;
        const candidateDef = getCardDefinition(state, candidate);
        return matchesCardFilter(candidateDef, def.manaProduction!.sacrificeFilter!);
      });
      if (!canPaySacrificeCost) continue;
    }
    // Sacrifice-cost mana abilities (Lotus Petal, Tinder Wall, etc.) are now
    // legal actions — tapLandForMana sacrifices the card as part of activation.

    for (const color of getAvailableManaColors(state, card.instanceId)) {
      actions.push({
        kind: 'ActivateManaAbility',
        cardInstanceId: card.instanceId,
        color,
      });
    }
  }

  const hand = getCardsInZone(state, playerId, 'hand');
  for (const card of hand) {
    const def = getCardDefinition(state, card);
    if (def.manaProduction?.activationZone !== 'hand') continue;
    if (!def.manaProduction.requiresExileFromHand) continue;

    for (const color of getAvailableManaColors(state, card.instanceId)) {
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
 *
 * For abilities that require targets, enumerate one action per legal target.
 * Abilities with no legal targets are skipped (an action with empty targets
 * would crash the executor with "Missing chosen target").
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

      const abilityTargets = abilities[i].targets ?? [];
      if (abilityTargets.length === 0) {
        actions.push({
          kind: 'ActivateAbility',
          cardInstanceId: card.instanceId,
          abilityIndex: i,
          targets: [],
        });
        continue;
      }

      // Single-target ability: enumerate legal targets, one action each.
      // Multi-target abilities are skipped for v0 (combinatorial blowup).
      if (abilityTargets.length === 1) {
        const spec: TargetSpec = {
          id: abilityTargets[0].id,
          type: abilityTargets[0].type as TargetSpec['type'],
          count: 1,
        };
        const legalTargets = getLegalTargets(state, playerId, spec);
        for (const target of legalTargets) {
          actions.push({
            kind: 'ActivateAbility',
            cardInstanceId: card.instanceId,
            abilityIndex: i,
            targets: [target],
          });
        }
      }
      // (Abilities with 2+ target specs are not yet enumerated. They'll be
      // missing from the legal-actions list rather than crash on activation.)
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
 * 3. Attack with all eligible creatures against one defender
 * 4. Attack with all eligible creatures distributed across defenders
 *
 * In multiplayer, creatures can attack different players. We keep this
 * bounded by adding one split-table attack pattern instead of enumerating
 * every possible assignment.
 */
function generateAttackerActions(state: GameState, playerId: string): DeclareAttackersAction[] {
  if (state.step !== 'declare_attackers') return [];
  if (state.combat) return [];

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

  // Option 4: Split attackers across multiple defenders. This is important
  // for real four-player Commander pods where one player can pressure the
  // archenemy while also sending evasive/chip damage elsewhere.
  if (eligibleAttackers.length > 1 && defenders.length > 1) {
    const splitAttacks: AttackerDeclaration[] = eligibleAttackers.map((attacker, index) => ({
      cardInstanceId: attacker.instanceId,
      defendingPlayerId: defenders[index % defenders.length].id,
    }));
    if (new Set(splitAttacks.map(attack => attack.defendingPlayerId)).size > 1) {
      actions.push({ kind: 'DeclareAttackers', attacks: splitAttacks });
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
  if (hasPlayerDeclaredBlockers(state, playerId)) return [];

  const actions: DeclareBlockersAction[] = [];

  // Find attackers targeting this player
  const incomingAttackers = state.combat.attackers.filter(
    a => a.defendingPlayerId === playerId
  );

  if (incomingAttackers.length === 0) {
    return [];
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
 * Generate equip actions for equipment on the battlefield.
 * Equip is a sorcery-speed action (main phases only, empty stack).
 */
function generateEquipActions(state: GameState, playerId: string): EquipAction[] {
  const actions: EquipAction[] = [];

  // Only during main phases, active player, empty stack (sorcery speed)
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (state.activePlayerIndex !== playerIndex) return actions;
  if (state.phase !== 'precombat_main' && state.phase !== 'postcombat_main') return actions;
  if (state.stack.length > 0) return actions;

  const battlefield = getCardsInZone(state, playerId, 'battlefield');
  const creatures = battlefield.filter(c => isEffectiveCreature(state, c.instanceId));

  if (creatures.length === 0) return actions;

  // Find equipment on battlefield
  const equipment = battlefield.filter(c => {
    const def = getCardDefinition(state, c);
    return def.isEquipment && def.equipCost;
  });

  for (const equip of equipment) {
    const def = getCardDefinition(state, equip);
    const equipCost = def.equipCost!;
    const costAsMana = { W: equipCost.W, U: equipCost.U, B: equipCost.B, R: equipCost.R, G: equipCost.G, C: equipCost.C, generic: equipCost.generic };

    // Check if player can pay equip cost
    const player = state.players[playerIndex];
    if (!canPayUnrestrictedCost(player, costAsMana)) continue;

    // Can equip any creature you control (skip if already equipped to this creature)
    for (const creature of creatures) {
      if (equip.attachedTo === creature.instanceId) continue;

      actions.push({
        kind: 'Equip',
        equipmentInstanceId: equip.instanceId,
        targetCreatureId: creature.instanceId,
      });
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

  // Equipment (sorcery speed, special action)
  actions.push(...generateEquipActions(state, playerId));

  // Always can pass priority
  actions.push(generatePassAction());

  return actions;
}
