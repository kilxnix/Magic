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
  manaProductions?: ManaProductionInfo[];
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
  lostKeywords?: string[]; // Phase 18: temporarily removed keywords (e.g. "loses flying until end of turn")
  /** Slice 10: true when the creature has been granted all creature types until end of turn
   * (Volatile Claws / Shields of Velis Vel / Blades of Velis Vel family).
   * Cleared at end-of-turn cleanup (cleanupDamage in state-based.ts). */
  grantedAllCreatureTypes?: boolean;
  /**
   * Slice 4 (activated-ability type-change): specific creature subtypes temporarily
   * granted via "{cost}: This creature becomes a [type] until end of turn."
   * (Mistform Dreamer / Crippling Fatigue / Amoeba Spy family).
   * The subtypes in this array are treated as part of the creature's type line for
   * subtype-matching purposes (matchesCardFilter, typeLineHasSubtype checks).
   * Cleared at end-of-turn cleanup (cleanupDamage in state-based.ts).
   */
  grantedSubtypes?: string[];
  /** Slice-6: extra card types applied via EnterAsCopy "except it's a <type> in addition" rider. */
  additionalTypes?: string[];
  /** Slice-6: name override applied via EnterAsCopy "except its name is ~" rider (stores original name). */
  nameOverride?: string;
  /**
   * Slice-7 (enter-as-copy): true when the copy entered with "except it isn't legendary",
   * suppressing the legendary supertype from the copied definition for legend-rule purposes.
   * Permanent: remains set for the lifetime of the permanent (not cleared at end of turn).
   */
  nonLegendary?: boolean;
  /** Player ids who have goaded this creature (goad lasts until the goader's next turn).
   *  A goaded creature must attack each combat if able, and must attack a player other
   *  than a goader if able (CR 701.39). */
  goadedBy?: string[];
  /** True once this creature has become monstrous (CR 701.34). Monstrosity N only
   *  acts when the creature is not yet monstrous. */
  monstrous?: boolean;
  /** Pending regeneration shields. Each shield replaces the next destruction this turn:
   *  the creature is tapped, removed from combat, damage removed, and one shield is
   *  consumed instead of being destroyed (CR 701.18). Cleared at end-of-turn cleanup. */
  regenerationShields?: number;
  isToken?: boolean; // Phase 16: true for token copies / token creatures
  copiedFromDefinitionId?: string; // Phase 16: original definition for copy tokens
  /**
   * Slice 7 (becomes-copy): set by BecomesCopyEffect when "~ becomes a copy of target creature
   * until end of turn." While set, getCardDefinition returns this definition instead of
   * definitionId. Cleared at end-of-turn cleanup (cleanupDamage in state-based.ts).
   */
  becomesCopyOfDefinitionId?: string;
  fromSideboard?: boolean; // True when an outside-the-game effect brought this card in.
  playableFromExileUntilTurn?: number; // Impulse-draw style permission while exiled.
  playableFromExileSourceId?: string;
  /**
   * Slice 11: Flash-window cleanup-sacrifice (Spider Climb / Armor of Thorns family).
   * Set to true when an enchantment with the "sacrifices it at the beginning of the
   * next cleanup step" rider was cast outside the sorcery window. turn-manager.ts
   * sacrifices all flagged permanents at the beginning of the cleanup step.
   */
  sacrificeAtCleanup?: boolean;
  /**
   * Slice 12 (Licid family): when true, this permanent has used its Licid ability
   * and is now functioning as an Aura attached to another creature. Its effective
   * card_types are overridden to ['enchantment'] with subtype 'Aura', and it is
   * attached to another creature via `attachedTo`. The Licid can use a second
   * activated ability (typically free) to detach and revert to creature form.
   */
  licidAura?: boolean;
  /**
   * Slice 7 (transient polymorph): "Until end of turn, target creature loses all
   * abilities and becomes a <color> <type> with base power and toughness X/Y."
   * (Turn to Frog / Dance of the Skywise / Turn//Burn family.)
   *
   * When true, instanceLosesAllAbilities returns true for this permanent, suppressing
   * its printed keywords, triggered/activated/static abilities for the turn.
   * Cleared at end-of-turn cleanup (cleanupDamage in state-based.ts).
   */
  transientLosesAllAbilities?: true;
  /**
   * Slice 1 (Morph/Megamorph): true when this permanent was cast face-down as a
   * 2/2 colorless creature for {3}. While face-down the card presents as a 2/2
   * with no text, no name, no types (beyond "Creature"), and no color. Cleared
   * when the turn-face-up action pays the morph/megamorph cost and fires the
   * TurnedFaceUp trigger.
   */
  faceDown?: boolean;
  /**
   * Slice 1 (Morph/Megamorph): the raw mana cost string of the morph/megamorph
   * ability stored at face-down-cast time (e.g. "{1}{U}", "{2}{G}"). Used to
   * verify payment when the controller activates the turn-face-up action.
   * `isMegamorph` distinguishes megamorph (adds a +1/+1 counter on turn-up).
   */
  morphCost?: string;
  isMegamorph?: boolean;
  /** Chosen face for a spell on the stack or a permanent cast as a non-front face. */
  activeFaceName?: string;
  choices?: {
    chosenCreatureType?: string;
    /** Slice 5: chosen-color subsystem — "As ~ enters, choose a color." */
    chosenColor?: 'W' | 'U' | 'B' | 'R' | 'G';
    /**
     * Slice 3 (as-enters-choice): "As ~ enters, choose an opponent." / "choose a
     * player." Stored as a player id; consumed by any companion line that refers to
     * "the chosen player" or "the chosen opponent" (e.g. upkeep triggers that discard).
     * Note: full execution of chosen-opponent effects (CDA, chosen-opponent targeting)
     * is tracked separately; this field merely records the choice for the engine.
     */
    chosenOpponent?: string;
    /**
     * Slice 3 (as-enters-choice): "As ~ enters, choose a nonland card name." /
     * "choose a card name." Stored as a lowercase card-name string; consumed by
     * companion restriction lines like "Spells with the chosen name can't be cast."
     */
    chosenCardName?: string;
    imprintedCardIds?: string[];
    discardedCardIds?: string[];
    /**
     * Slice 9 (ControlEnchanted): stores the instanceId and original ownerId of
     * the enchanted permanent at the time this theft Aura entered the battlefield.
     * Used by the revert hook in pruneDetachedEffects (game-state.ts) when the
     * Aura leaves the battlefield so the enchanted permanent's ownerId is restored
     * to its pre-theft controller.
     */
    previousEnchantedOwnerId?: string;
    /** The instanceId of the permanent whose control was stolen by this Aura. */
    stolenPermanentId?: string;
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
    | { kind: 'AttachedCreatureDies' }
    | { kind: 'Attacks'; who: 'self'; alone?: boolean }
    | { kind: 'Unblocked'; who: 'self' }
    | { kind: 'Upkeep'; whose: 'yours' | 'each' | 'opponents' }
    | { kind: 'DrawStep'; whose: 'yours' }
    | { kind: 'BeginningCombat'; whose: 'yours' | 'each' }
    | { kind: 'EndStep'; whose: 'yours' | 'opponents' | 'next' | 'each' }
    | { kind: 'AnotherCreatureETB'; controller: 'yours'; nontoken?: boolean; tokenOnly?: boolean }
    | { kind: 'CreatureYouControlDies' }
    | { kind: 'OtherCreatureDies'; who: 'youControl' | 'opponentControl'; other?: boolean }
    | { kind: 'CreatureYouControlAttacks' }
    | { kind: 'YouCastSpell' }
    | { kind: 'CastNoncreatureSpell' }
    | { kind: 'LifeGain' }
    | { kind: 'LifeLoss' }
    | { kind: 'CardDrawn' }
    | { kind: 'OpponentCastSpell'; maxManaValue?: number }
    | { kind: 'AnyPlayerCastSpell'; maxManaValue?: number }
    | { kind: 'AnyCreatureETB'; controller?: 'yours' | 'any'; nontoken?: boolean; tokenOnly?: boolean }
    | { kind: 'CombatDamageToPlayer'; who: 'self' | 'creatureYouControl'; requiresDeathtouch?: boolean }
    | { kind: 'CastInstantOrSorcery' }
    | { kind: 'CastOrCopyInstantOrSorcery' }
    | { kind: 'Landfall' }
    | { kind: 'BecomesTapped'; who: 'self' }
    | { kind: 'PlayerTapsLandForMana'; subtype?: string; nonbasic?: boolean }
    // Slice 5 (event-damage triggers): "Whenever this creature / enchanted creature
    // deals damage" — pre-errata lifelink / Guilty Conscience reflection wording.
    | { kind: 'DealsDamage'; who: 'self' | 'enchantedCreature' }
    // Slice 7: "Whenever this creature or another <Subtype> you control enters"
    // (Ally / Mutant / Phyrexian / Dinosaur / Equipment / plain-creature family).
    | { kind: 'SelfOrAnotherSubtypeETB'; subtype: string }
    // Slice 2: "Whenever another legendary permanent you control enters" (Yoshimaru family).
    | { kind: 'AnotherLegendaryPermanentETB' }
    // Slice 8/11: "Whenever this creature blocks or becomes blocked by a creature, that creature <effect>"
    // (Witherscale Wurm / Dwarven Nomad / Lim-Dûl's Cohort family.)
    | { kind: 'BlocksOrBlockedBy'; who: 'self' }
    // Slice 1 (Morph/Megamorph): "When this creature is turned face up, <effect>."
    | { kind: 'TurnedFaceUp'; who: 'self' };
  effects: unknown[]; // Effect[] from ast.ts
  targets?: unknown[]; // TargetSpec[] from targets.ts
  optional?: boolean;
  /**
   * Slice 10 (modal-as-trigger-body): When set, this triggered ability's body
   * is a modal spell. `effects` is empty; stack.ts resolves the chosen mode(s)
   * via the same modal path as activated ability modals.
   */
  modal?: unknown; // ModalSpell from ast.ts
  /** Slice 10: which mode indices were chosen for a modal triggered ability. */
  chosenModes?: number[];
}

export interface DelayedTriggeredAbilityRef {
  id: string;
  sourceInstanceId?: string;
  controllerId: string;
  trigger: { kind: 'EndStep'; whose: 'yours' | 'opponents' | 'next' };
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
  /**
   * Slice 11: true when the spell carrying the flash-cleanup-sacrifice rider was
   * cast outside the sorcery window (i.e. used the flash grant). Used at resolution
   * to flag the entering permanent with `sacrificeAtCleanup`.
   */
  castAtInstantSpeed?: boolean;
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
    eventPlayerId?: string; // "that player" — the player tied to the triggering event
    eventDamageAmount?: number; // Slice 5: the amount of damage that triggered a DealsDamage trigger
    /**
     * Slice 6 (combat-damage trigger bodies): snapshot of attacker instanceIds
     * captured at the moment combat damage was dealt (before combat state is cleared).
     * Used by AllAttackingCreaturesYouControl executor branch.
     */
    attackerInstanceIds?: string[];
  };
}

export interface ActivatedAbilityStackItem {
  kind: 'ActivatedAbility';
  id: string;
  sourceInstanceId: string;
  controllerId: string;
  ability: {
    effects: unknown[]; // Effect[] from ast.ts
    targets: unknown[]; // TargetSpec[] from targets.ts
  };
  targets: string[];
  namedCardChoices?: Record<string, string>;
  /**
   * Slice 6: Set when the activated ability's effect body is a modal spell
   * ("{N}: Choose one — • A. • B."). Resolution in stack.ts executes the
   * chosen mode using the same modal resolution path as spells.
   */
  modal?: unknown; // ModalSpell from ast.ts
  /** Slice 6: Which mode indices were chosen for a modal activated ability. */
  chosenModes?: number[];
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
    eventPlayerId?: string;   // "that player" — the player tied to the triggering event
                              // (upkeep's active player, the caster, the tapping player)
    eventDamageAmount?: number; // Slice 5: the amount of damage that triggered a DealsDamage trigger
    /** Slice 11 (intervening-if ETB): true when the permanent entered via being cast
     *  (spell resolution path). False/absent when entered by blink, reanimate, etc. */
    enteredViaCast?: boolean;
    /**
     * Slice 6 (combat-damage trigger bodies): snapshot of the attacker instanceIds
     * at the moment combat damage was dealt. Captured by checkTriggersForEvent for
     * CombatDamageToPlayer events because the combat state is cleared (set to null)
     * before the trigger resolves. Used by the AllAttackingCreaturesYouControl
     * executor branch to place counters on the correct creatures.
     */
    attackerInstanceIds?: string[];
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
  /**
   * Slice 7 (lure): instance IDs of creatures that must be blocked this combat
   * if any creature is able to block them (CR 509.1a / lure rule).
   * Set by the MustBeBlockedIfAble executor when a Lure-effect resolves during
   * combat. combat.ts declareBlockers enforces the constraint: every blocker-
   * eligible creature whose controller is a defending player MUST be assigned to
   * block a lured creature if it canBlock any of them.
   */
  luredCreatureIds?: string[];
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
  /** Starting life total for the game (40 in Commander, 20 in limited/duel).
   * Used by Slice 7 conditions (LifeAtOrBelowHalfStarting / LifeAboveStarting). */
  startingLife?: number;
  playerCounters?: Record<string, number>; // generic counters such as energy and experience
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

export interface DamagePreventionEffectRef {
  id: string;
  sourceInstanceId?: string;
  controllerId: string;
  protectedTargetId?: string;
  amount: number | 'all';
  combatOnly: boolean;
  expiresAtTurnNumber: number;
  /**
   * Slice 12 (en-Kor family): when set, the shield redirects damage to this
   * target instead of preventing it. The next N damage to `protectedTargetId`
   * is dealt to `redirectToId` instead. One-shot per redirect event.
   */
  redirectToId?: string;
}

export interface GameOutcomePreventionEffectRef {
  id: string;
  sourceInstanceId?: string;
  controllerId: string;
  protectedPlayerIds?: string[];
  preventsLoss?: boolean;
  preventsWin?: boolean;
  preventsLifeLoss?: boolean;
  expiresAtTurnNumber: number;
}

/**
 * Slice 10: "Your opponents can't cast spells this turn." (Silence family).
 * Tracks which players are prohibited from casting spells for the rest of the
 * current turn number. Registered by the OpponentsCantCastSpells executor and
 * checked in canCastSpell (stack.ts). Expired entries are pruned on each step
 * transition and at the start of a new turn.
 */
export interface SpellCastProhibitionRef {
  id: string;
  sourceInstanceId?: string;
  controllerId: string;
  /** Player IDs that cannot cast spells while this prohibition is active. */
  prohibitedPlayerIds: string[];
  expiresAtTurnNumber: number;
}

/**
 * Slice 6: "Until your next turn, spells your opponents cast cost {N} more."
 * (Tax Collector / Gobakhan family — ETB-triggered cost increase.)
 * Registered by the OpponentSpellCostTax executor and checked in
 * getSpellCostTaxIncrease (stack.ts). Expires at the start of the controller's
 * next turn (tracked via controllerId + active-player check in pruneSpellCostTaxes).
 */
export interface SpellCostTaxRef {
  id: string;
  sourceInstanceId?: string;
  /** The player who cast/triggered the tax effect. Tax applies to their opponents. */
  controllerId: string;
  /** Generic mana cost increase applied to each spell cast by a prohibited player. */
  amount: number;
  /**
   * The turn number when this tax was registered. Used together with controllerId
   * to detect when the controller's next turn begins (at which point the tax expires).
   */
  registeredAtTurnNumber: number;
}

export interface DiceRollRecord {
  id: string;
  playerId: string;
  sourceInstanceId?: string;
  sourceName?: string;
  sides: 20;
  result: number;
  outcomeMin: number;
  outcomeMax: number;
  turnNumber: number;
  phase: Phase;
  step: Step;
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
  /**
   * Slice 2 (werewolf): Snapshot of spellsCastThisTurn taken at the turn boundary
   * (advanceToNextTurn). Used by the "no spells were cast last turn" and "a player cast
   * two or more spells last turn" werewolf upkeep trigger conditions.
   */
  spellsCastLastTurn?: number;
  /** Turn-scoped counter: total creatures that have died this turn (across all players). */
  creaturesDiedThisTurn?: number;
  playersWhoAttackedThisTurn?: string[];
  /**
   * Explicit legend-rule choices keyed by `${ownerId}:${lowercaseCardName}`.
   * When omitted or invalid, SBAs keep the first matching permanent as a
   * deterministic AI/test fallback.
   */
  legendRuleKeepChoices?: Record<string, string>;
  /**
   * Explicit replacement-effect ordering choices. Keys can be the event key
   * from `replacementChoiceKey(...)`, `player:<playerId>`, or `global`.
   * Each value is an ordered list of replacement effect ids to apply first.
   */
  replacementEffectOrderChoices?: Record<string, string[]>;
  hasPriorityPassed: boolean[];
  stack: StackItem[];
  combat: CombatState | null;

  /** The Monarch (CR 720). The monarch draws a card at the beginning of their end
   *  step; dealing combat damage to the monarch makes that player the new monarch. */
  monarchId?: string;

  // Phase 6: Triggers
  battlefieldAbilities: Map<string, TriggeredAbilityRef[]>; // instanceId → abilities
  pendingTriggers: PendingTrigger[];
  delayedTriggers?: DelayedTriggeredAbilityRef[];

  // Phase 15: Continuous effects from static abilities
  continuousEffects?: ContinuousEffectRef[];

  // Turn-scoped damage prevention such as Fog.
  damagePreventionEffects?: DamagePreventionEffectRef[];

  // Turn-scoped outcome and life-loss prevention such as Everybody Lives!
  gameOutcomePreventionEffects?: GameOutcomePreventionEffectRef[];

  // Turn-scoped spell-cast prohibitions such as Silence.
  spellCastProhibitions?: SpellCastProhibitionRef[];

  // Slice 6: "Until your next turn, spells your opponents cast cost {N} more." taxes.
  spellCostTaxes?: SpellCostTaxRef[];

  // Public presentation history for effects such as "roll a d20".
  diceRolls?: DiceRollRecord[];

  /**
   * Deterministic PRNG cursor (mulberry32). All game-affecting randomness —
   * shuffles, dice, coin flips, the starting-player roll — draws from this so
   * a game replays identically given the same seed and actions. Seeded at game
   * creation; serialized with the state. See `rng.ts`.
   */
  rngState?: number;

  /** Monotonic counter backing deterministic object/trigger id generation. */
  idCounter?: number;
}

export function emptyManaPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

export function createPlayer(id: string, name: string, life: number = 40): Player {
  return {
    id,
    name,
    life,
    startingLife: life,
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
