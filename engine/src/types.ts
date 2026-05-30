import type { CardFilter, EquipCostInfo, EquipmentBonusInfo, ManaProductionInfo, SearchAbilityInfo, StaticAbilityEffect, UnlessTaxInfo } from './effects/ast';

export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';

export type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'stack' | 'command';

export type Phase = 'beginning' | 'precombat_main' | 'combat' | 'postcombat_main' | 'ending';

export type Step =
  | 'untap' | 'upkeep' | 'draw'
  | 'begin_combat' | 'declare_attackers' | 'declare_blockers'
  | 'first_strike_damage' | 'combat_damage' | 'end_of_combat'
  | 'end' | 'cleanup';

export type CardType = 'creature' | 'instant' | 'sorcery' | 'artifact' | 'enchantment' | 'planeswalker' | 'land' | 'battle';

export interface ManaCost {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  C: number;
  generic: number;
  hybrid?: ManaColor[][];
  /** Colored Phyrexian symbols such as {G/P}; each may be paid with that color or 2 life. */
  phyrexian?: ManaColor[];
  /** Snow symbols such as {S}; each must be paid with mana produced by a snow source. */
  snow?: number;
}

export interface CardDefinition {
  id: string;
  name: string;
  type_line: string;
  oracle_text: string;
  mana_cost: string;
  cmc: number;
  colors: ManaColor[];
  color_identity: ManaColor[];
  keywords: string[];
  power?: number;
  toughness?: number;
  card_types: CardType[];
  faces?: CardDefinitionFace[];

  // Cached parse data — populated at card load time
  isEquipment?: boolean;
  equipCost?: EquipCostInfo;
  equipmentBonus?: EquipmentBonusInfo;
  manaProduction?: ManaProductionInfo;
  searchAbility?: SearchAbilityInfo;
  unlessTax?: UnlessTaxInfo;
}

export interface CardInstance {
  instanceId: string;
  definitionId: string;
  ownerId: string;
  zone: Zone;
  tapped: boolean;
  summoningSick: boolean;
  counters: Record<string, number>;
  attachedTo?: string;
  damage: number;
  deathtouchDamage?: boolean;
  isCommander: boolean;
  phasedOut?: boolean; // Phase 16: true when phased out (treated as not existing)
  grantedKeywords?: string[]; // Phase 16: temporarily granted keywords (e.g. "until end of turn")
  isToken?: boolean; // Phase 16: true for token copies / token creatures
  copiedFromDefinitionId?: string; // Phase 16: original definition for copy tokens
  fromSideboard?: boolean; // True when an outside-the-game effect brought this card in.
  choices?: {
    chosenCreatureType?: string;
    imprintedCardIds?: string[];
    discardedCardIds?: string[];
  };
}

export interface CardDefinitionFace {
  id: string;
  name: string;
  type_line: string;
  oracle_text: string;
  mana_cost: string;
  cmc: number;
  colors: ManaColor[];
  keywords: string[];
  card_types: CardType[];
  power?: number;
  toughness?: number;
}

// Import TriggeredAbility from effects/ast (forward declaration for type safety)
// Actual import is done in files that need the full type
export interface TriggeredAbilityRef {
  kind: 'TriggeredAbility';
  trigger: { kind: 'ETB'; who: 'self' | 'any' | 'controller' }
    | { kind: 'Dies'; who: 'self' | 'any' }
    | { kind: 'Attacks'; who: 'self' }
    | { kind: 'Upkeep'; whose: 'yours' | 'each' }
    | { kind: 'BeginningCombat'; whose: 'yours' | 'each' }
    | { kind: 'EndStep'; whose: 'yours' | 'opponents' }
    | { kind: 'AnotherCreatureETB'; controller: 'yours'; nontoken?: boolean; tokenOnly?: boolean }
    | { kind: 'CreatureYouControlDies' }
    | { kind: 'CreatureYouControlAttacks' }
    | { kind: 'YouCastSpell' }
    | { kind: 'CastNoncreatureSpell' }
    | { kind: 'LifeGain' }
    | { kind: 'CardDrawn' }
    | { kind: 'OpponentCastSpell' }
    | { kind: 'AnyCreatureETB'; controller?: 'yours' | 'any'; nontoken?: boolean; tokenOnly?: boolean }
    | { kind: 'CombatDamageToPlayer'; who: 'self' | 'creatureYouControl' }
    | { kind: 'CastInstantOrSorcery' }
    | { kind: 'CastOrCopyInstantOrSorcery' }
    | { kind: 'Landfall' };
  effects: unknown[]; // Effect[] from ast.ts
  targets?: unknown[]; // TargetSpec[] from targets.ts
  optional?: boolean;
}

export interface DelayedTriggeredAbilityRef {
  id: string;
  sourceInstanceId?: string;
  controllerId: string;
  trigger: { kind: 'EndStep'; whose: 'yours' | 'opponents' };
  effects: unknown[];
  oneShot: boolean;
}

export type StackItemKind = 'Spell' | 'TriggeredAbility' | 'ActivatedAbility';

export interface SpellStackItem {
  kind: 'Spell';
  id: string;
  cardInstanceId: string;
  casterId: string;
  targets: string[];
  castFromZone?: Zone;
  chosenModes?: number[];
  namedCardChoices?: Record<string, string>;
  cardChoices?: CardInstance['choices'];
  xValue?: number;
  faceName?: string;
  cantBeCountered?: boolean;
  isCopy?: boolean;
  copyOfCardInstanceId?: string;
}

export interface TriggeredAbilityStackItem {
  kind: 'TriggeredAbility';
  id: string;
  sourceInstanceId: string;
  controllerId: string;
  ability: TriggeredAbilityRef;
  targets: string[];
  targetSpecs?: unknown[]; // TargetSpec[] from targets.ts
  namedCardChoices?: Record<string, string>;
  eventContext?: {
    casterId?: string;
    cardInstanceId?: string;
  };
}

export interface ActivatedAbilityStackItem {
  kind: 'ActivatedAbility';
  id: string;
  sourceInstanceId: string;
  controllerId: string;
  ability: {
    effects: unknown[]; // Effect[] from ast.ts
    targets: { id: string; type: string }[];
  };
  targets: string[];
  namedCardChoices?: Record<string, string>;
}

export type StackItem = SpellStackItem | TriggeredAbilityStackItem | ActivatedAbilityStackItem;

// Legacy helper for backwards compatibility with existing code
export function isSpellStackItem(item: StackItem): item is SpellStackItem {
  return item.kind === 'Spell';
}

export function isTriggeredAbilityStackItem(item: StackItem): item is TriggeredAbilityStackItem {
  return item.kind === 'TriggeredAbility';
}

export function isActivatedAbilityStackItem(item: StackItem): item is ActivatedAbilityStackItem {
  return item.kind === 'ActivatedAbility';
}

export interface PendingTrigger {
  id: string;
  sourceInstanceId: string;
  controllerId: string;
  ability: TriggeredAbilityRef;
  requiredTargets: unknown[]; // TargetSpec[] from targets.ts
  eventContext?: {
    casterId?: string;        // Who cast the spell that triggered this
    cardInstanceId?: string;  // The spell that was cast
  };
}

export interface AttackerDeclaration {
  cardInstanceId: string;
  defendingPlayerId: string;
}

export interface BlockerDeclaration {
  cardInstanceId: string;
  blockingAttackerId: string;
}

export interface CombatState {
  attackers: AttackerDeclaration[];
  blockers: BlockerDeclaration[];
  blockersDeclared?: boolean;
  blockersDeclaredBy?: string[];
  blockerOrder?: Record<string, string[]>; // attackerInstanceId -> ordered blocker instance IDs for damage assignment
  damageAssignment: Map<string, number>; // attackerInstanceId -> damage to assign to player
}

export interface ManaPool {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  C: number;
}

export type ManaRestrictionKind = 'creatureSpell' | 'creatureTypeSpell' | 'legendarySpell' | 'commanderSpell';

export interface RestrictedMana {
  color: ManaColor;
  amount: number;
  restriction: ManaRestrictionKind;
  creatureType?: string;
  sourceInstanceId?: string;
  snow?: boolean;
}

export type ConditionalManaEffectKind = 'copyRedInstantOrSorcery';

export interface ConditionalMana {
  color: ManaColor;
  amount: number;
  effect: ConditionalManaEffectKind;
  sourceInstanceId?: string;
  snow?: boolean;
}

export interface Player {
  id: string;
  name: string;
  life: number;
  poisonCounters: number; // NEW — for infect/poison loss condition (>=10 loses)
  commanderDamage: Record<string, number>; // commanderInstanceId -> damage taken
  commanderTax: number;
  commanderInstanceId: string | null; // player's commander card instance
  commanderInstanceIds?: string[]; // partner/background commanders in the command zone
  commanderCastCount: number; // times commander has been cast from command zone
  commanderCastCounts?: Record<string, number>; // per commander instance for partner tax
  manaPool: ManaPool;
  snowManaPool?: ManaPool;
  restrictedMana?: RestrictedMana[];
  conditionalMana?: ConditionalMana[];
  hasPlayedLand: boolean;
  /** Count of lands played this turn. Independent of hasPlayedLand so that
   * Exploration / Mina and Denn / Oracle of Mul Daya can grant additional
   * land plays beyond the normal one. Defaults to 0; reset each turn. */
  landsPlayedThisTurn?: number;
  hasPriority: boolean;
  hasLost: boolean;
}

// Phase 15: Forward declaration for continuous effects (actual type in effects/continuous.ts)
export interface ContinuousEffectRef {
  id: string;
  sourceInstanceId: string;
  controllerId: string;
  ability: {
    kind: 'StaticAbility';
  } & StaticAbilityEffect;
  timestamp: number;
}

export interface GameState {
  players: Player[];
  cards: Map<string, CardInstance>;
  cardDefinitions: Map<string, CardDefinition>;
  /** Sideboards are registered deck cards outside the game. They are not card
   * instances and are unavailable to normal gameplay actions unless an effect
   * explicitly refers to cards from outside the game. */
  sideboards?: Map<string, CardDefinition[]>;
  activePlayerIndex: number;
  priorityPlayerIndex: number;
  phase: Phase;
  step: Step;
  turnNumber: number;
  spellsCastThisTurn?: number;
  hasPriorityPassed: boolean[];
  stack: StackItem[];
  combat: CombatState | null;

  // Phase 6: Triggers
  battlefieldAbilities: Map<string, TriggeredAbilityRef[]>; // instanceId → abilities
  pendingTriggers: PendingTrigger[];
  delayedTriggers?: DelayedTriggeredAbilityRef[];

  // Phase 15: Continuous effects from static abilities
  continuousEffects?: ContinuousEffectRef[];
}

export function emptyManaPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

export function createPlayer(id: string, name: string, life: number = 40): Player {
  return {
    id,
    name,
    life,
    poisonCounters: 0,
    commanderDamage: {},
    commanderTax: 0,
    commanderInstanceId: null,
    commanderInstanceIds: [],
    commanderCastCount: 0,
    commanderCastCounts: {},
    manaPool: emptyManaPool(),
    snowManaPool: emptyManaPool(),
    restrictedMana: [],
    conditionalMana: [],
    hasPlayedLand: false,
    landsPlayedThisTurn: 0,
    hasPriority: false,
    hasLost: false,
  };
}
