// Phase 4 (parser-first): Effect system AST types
// Phase 10: Extended with modal, X costs, tokens, and more primitives
// Phase 14: Expanded with ForEach, ExileFromLibrary, GainControl, and more patterns
// Phase 15: Static/continuous abilities and conditional effects
// Phase 16: Blink/flicker, copy effects, keyword granting, phasing
// Phase 17: Planeswalker loyalty abilities and additional trigger types

export type Effect =
  | DrawEffect
  | DestroyEffect
  | DealDamageEffect
  | DealDamageForExiledCardsEffect
  | PreventDamageEffect
  | GainLifeEffect
  | LoseLifeEffect
  | ExileEffect
  | PutIntoLibraryEffect
  | ReturnToHandEffect
  | SacrificeEffect
  | SacrificeSelfUnlessPlayerSacrificesEffect
  | MillEffect
  | AddCountersEffect
  | RemoveCountersEffect
  | TapEffect
  | UntapEffect
  | CreateTokenEffect
  | RollD20Effect
  | FightEffect
  | DiscardEffect
  | ScryEffect
  | SurveilEffect
  | LookAtHandEffect
  | SearchLibraryEffect
  | ShuffleLibraryEffect
  | CounterSpellEffect
  | ReturnFromGraveyardEffect
  | ModifyPTEffect
  | ExileFromLibraryEffect
  | ExileUntilNamedEffect
  | GainControlEffect
  | ConditionalEffect
  | BlinkEffect
  | CopyEffect
  | CopySpellEffect
  | GrantKeywordEffect
  | LoseKeywordEffect
  | PhaseOutEffect
  | WinGameEffect
  | LoseGameEffect
  | AddManaEffect
  | PutLandFromHandOntoBattlefieldEffect;

// Amount can be a fixed number, reference to X, or a dynamic "for each" count
export type AmountRef =
  | number
  | { kind: 'X' }
  | { kind: 'XMultiplied'; multiplier: number }
  | { kind: 'EventSpellManaValue' }
  | { kind: 'TargetPower'; target: TargetRef }
  | GreatestPowerAmount
  | GreatestManaValueAmount
  | ForEachAmount;

// Dynamic count: "for each [condition]" — evaluated at resolution time
export interface ForEachAmount {
  kind: 'ForEach';
  zone: 'battlefield' | 'hand' | 'graveyard' | 'library';
  filter?: CardFilter;
  controller: 'you' | 'opponent' | 'each';
}

export interface GreatestPowerAmount {
  kind: 'GreatestPower';
  zone: 'battlefield';
  filter?: CardFilter;
  controller: 'you' | 'opponent' | 'each';
}

export interface GreatestManaValueAmount {
  kind: 'GreatestManaValue';
  zone: 'battlefield';
  filter?: CardFilter;
  controller: 'you' | 'opponent' | 'each';
}

export interface DrawEffect {
  kind: 'Draw';
  player: TargetRef;
  count: AmountRef;
}

export interface DestroyEffect {
  kind: 'Destroy';
  target: TargetRef;
}

export interface DealDamageEffect {
  kind: 'DealDamage';
  source?: SourceRef;
  target: TargetRef;
  amount: AmountRef;
}

export interface DealDamageForExiledCardsEffect {
  kind: 'DealDamageForExiledCards';
  target: TargetRef;
  exiledCardIds: string[];
  amountPerCard: number;
}

export interface PreventDamageEffect {
  kind: 'PreventDamage';
  target?: TargetRef;
  amount: AmountRef | 'all';
  combatOnly: boolean;
  duration: 'turn';
}

export interface GainLifeEffect {
  kind: 'GainLife';
  player: TargetRef;
  amount: AmountRef;
}

export interface LoseLifeEffect {
  kind: 'LoseLife';
  player: TargetRef;
  amount: AmountRef;
}

export interface ExileEffect {
  kind: 'Exile';
  target: TargetRef;
}

export interface PutIntoLibraryEffect {
  kind: 'PutIntoLibrary';
  target: TargetRef;
  position: 'top' | 'bottom' | 'shuffle';
}

export interface ReturnToHandEffect {
  kind: 'ReturnToHand';
  target: TargetRef;
}

export interface SacrificeEffect {
  kind: 'Sacrifice';
  player: TargetRef;
  filter?: CardFilter;
  count: AmountRef;
}

export interface SacrificeSelfUnlessPlayerSacrificesEffect {
  kind: 'SacrificeSelfUnlessPlayerSacrifices';
  player: TargetRef;
  filter?: CardFilter;
  count: AmountRef;
}

export interface MillEffect {
  kind: 'Mill';
  player: TargetRef;
  count: AmountRef;
}

export interface AddCountersEffect {
  kind: 'AddCounters';
  target: TargetRef;
  counterType: string;
  count: AmountRef;
}

export interface RemoveCountersEffect {
  kind: 'RemoveCounters';
  target: TargetRef;
  counterType: string;
  count: AmountRef;
}

export interface TapEffect {
  kind: 'Tap';
  target: TargetRef;
}

export interface UntapEffect {
  kind: 'Untap';
  target: TargetRef;
  /** Optional cap for non-targeting untap effects such as "untap up to seven lands." */
  maxCount?: AmountRef;
}

export interface CreateTokenEffect {
  kind: 'CreateToken';
  controller: TargetRef;
  token: TokenDefinition;
  count: AmountRef;
  /**
   * Attach the source permanent to the first token this effect creates.
   * This covers dice/table cards such as "create a token, then attach this to it".
   */
  attachSourceToCreated?: boolean;
}

export interface RollD20Outcome {
  min: number;
  max: number;
  effects: Effect[];
}

export interface RollD20Effect {
  kind: 'RollD20';
  outcomes: RollD20Outcome[];
  /** Test-only deterministic value; normal gameplay rolls randomly. */
  rollOverride?: number;
}

export interface DiscardEffect {
  kind: 'Discard';
  player: TargetRef;
  count: AmountRef;
  random?: boolean;
}

export interface ScryEffect {
  kind: 'Scry';
  player: TargetRef;
  count: AmountRef;
}

export interface SurveilEffect {
  kind: 'Surveil';
  player: TargetRef;
  count: AmountRef;
}

export interface LookAtHandEffect {
  kind: 'LookAtHand';
  player: TargetRef;
}

export interface SearchLibraryEffect {
  kind: 'SearchLibrary';
  player: TargetRef;
  filter: CardFilter;
  destination: 'battlefield' | 'hand' | 'top' | 'graveyard';
  tapped?: boolean;
  shuffle: boolean;
  topCount?: number;
  putUnselectedTopCardsOnBottom?: boolean;
  minSelections?: number;
  maxSelections?: number;
  namedCardChoiceId?: string;
  selectedCardChoiceId?: string;
}

export interface ShuffleLibraryEffect {
  kind: 'ShuffleLibrary';
  player: TargetRef;
}

export interface CounterSpellEffect {
  kind: 'CounterSpell';
  target: TargetRef;
  filter?: 'noncreature' | 'creature' | 'creatureOrEnchantment' | 'artifactOrCreature' | 'instantOrSorcery'; // undefined = any spell
  exileInstead?: boolean;
}

export interface FightEffect {
  kind: 'Fight';
  fighterA: TargetRef;
  fighterB: TargetRef;
}

export interface ReturnFromGraveyardEffect {
  kind: 'ReturnFromGraveyard';
  target: TargetRef;
  destination: 'hand' | 'battlefield';
  counters?: string[];
}

export interface ModifyPTEffect {
  kind: 'ModifyPT';
  target: TargetRef;
  power: AmountRef; // e.g. +2, -2, or a dynamic amount such as target power
  toughness: AmountRef;
  untilEndOfTurn: boolean;
}

// Exile cards from the top of a library (impulse draw)
export interface ExileFromLibraryEffect {
  kind: 'ExileFromLibrary';
  player: TargetRef;
  count: AmountRef;
  mayPlay?: boolean; // "you may play them this turn"
  delayedDamageEachOpponentPerCard?: number;
}

export interface ExileUntilNamedEffect {
  kind: 'ExileUntilNamed';
  player: TargetRef;
  namedCard?: string;
  namedCardChoiceId?: string;
  foundDestination: 'hand' | 'exile';
  exileBeforeSearch?: number;
}

// Gain control of a permanent
export interface GainControlEffect {
  kind: 'GainControl';
  target: TargetRef;
}

// ============================================================================
// Phase 16: Blink/Flicker, Copy, Keyword Granting, Phasing
// ============================================================================

// Blink/Flicker: exile then return to battlefield (triggers ETB again)
export interface BlinkEffect {
  kind: 'Blink';
  target: TargetRef;
  delayed?: boolean; // true = "return at the beginning of the next end step" (simplified to immediate)
  ownerControl?: boolean; // true = "under its owner's control"
}

// Copy: create a token copy of target creature
export interface CopyEffect {
  kind: 'Copy';
  target: TargetRef;
}

// CopySpell: copy a spell on the stack, optionally with mana value limit.
export interface CopySpellEffect {
  kind: 'CopySpell';
  target: TargetRef;
  maxManaValue?: number;
}

// Grant a keyword to a creature (one-shot, not static)
export interface GrantKeywordEffect {
  kind: 'GrantKeyword';
  target: TargetRef;
  keyword: string;
  untilEndOfTurn: boolean;
}

export interface LoseKeywordEffect {
  kind: 'LoseKeyword';
  target: TargetRef;
  keyword: string;
  untilEndOfTurn: boolean;
}

// Phase out a permanent
export interface PhaseOutEffect {
  kind: 'PhaseOut';
  target: TargetRef;
}

// Win the game
export interface WinGameEffect {
  kind: 'WinGame';
  player: TargetRef;
}

// Lose the game
export interface LoseGameEffect {
  kind: 'LoseGame';
  player: TargetRef;
}

// Add mana to a player's pool
export interface AddManaEffect {
  kind: 'AddMana';
  player: TargetRef;
  mana: { W?: number; U?: number; B?: number; R?: number; G?: number; C?: number };
}

export interface PutLandFromHandOntoBattlefieldEffect {
  kind: 'PutLandFromHandOntoBattlefield';
  player: TargetRef;
  tapped?: boolean;
  selectedCardChoiceId?: string;
}

// Token definition for CreateToken
export interface TokenDefinition {
  name: string;
  colors: Array<'W' | 'U' | 'B' | 'R' | 'G'>;
  types: string[];
  subtypes?: string[];
  power: number;
  toughness: number;
  powerAmount?: AmountRef;
  toughnessAmount?: AmountRef;
  counters?: Record<string, AmountRef>;
  keywords?: string[];
  abilities?: string[];
}

// Card filter for sacrifice/search effects
export interface CardFilter {
  anyOf?: CardFilter[];
  names?: string[];
  nameIncludes?: string[];
  types?: string[];
  subtypes?: string[];
  excludeSubtypes?: string[];
  supertypes?: string[];
  colors?: Array<'W' | 'U' | 'B' | 'R' | 'G'>;
  multicolored?: boolean;
  cmc?: { op: 'eq' | 'lte' | 'gte'; value: number };
  permanent?: boolean;
  manaValueLessThanSourcePower?: boolean;
  power?: { op: 'eq' | 'lte' | 'gte'; value: number };
}

// Modal choice (for "Choose one" spells)
export interface ModalChoice {
  label: string;
  effects: Effect[];
  targets: { id: string; type: string }[];
}

export interface ModalSpell {
  kind: 'Modal';
  chooseCount: number; // 1 for "Choose one", 2 for "Choose two"
  upTo?: boolean; // true for "choose one or both" (choose up to N)
  choices: ModalChoice[];
}

export interface TriggeredAbility {
  kind: 'TriggeredAbility';
  trigger: Trigger;
  effects: Effect[];
  optional?: boolean; // "you may" triggered abilities need an explicit player choice.
}

export type Trigger =
  | { kind: 'ETB'; who: 'self' | 'any' | 'controller' }
  | { kind: 'Dies'; who: 'self' | 'any' }
  | { kind: 'AttachedCreatureDies' }
  | { kind: 'Attacks'; who: 'self' }
  | { kind: 'Unblocked'; who: 'self' }
  | { kind: 'Upkeep'; whose: 'yours' | 'each' }
  | { kind: 'BeginningCombat'; whose: 'yours' | 'each' }
  | { kind: 'EndStep'; whose: 'yours' | 'opponents' }
  | { kind: 'AnotherCreatureETB'; controller: 'yours'; nontoken?: boolean; tokenOnly?: boolean }
  | { kind: 'CreatureYouControlDies' }
  | { kind: 'CreatureYouControlAttacks' }
  | { kind: 'YouCastSpell' }
  | { kind: 'CastNoncreatureSpell' }
  // Phase 17: Additional trigger types
  | { kind: 'LifeGain' }
  | { kind: 'CardDrawn' }
  | { kind: 'OpponentCastSpell' }
  | { kind: 'AnyCreatureETB'; controller?: 'yours' | 'any'; nontoken?: boolean; tokenOnly?: boolean }
  | { kind: 'CombatDamageToPlayer'; who: 'self' | 'creatureYouControl' }
  | { kind: 'CastInstantOrSorcery' }
  | { kind: 'CastOrCopyInstantOrSorcery' }
  | { kind: 'Landfall' }
  | { kind: 'BecomesTapped'; who: 'self' };

export type TargetRef =
  | { kind: 'Chosen'; targetId: string }
  | { kind: 'TargetController'; targetId: string }
  | { kind: 'Controller' }
  | { kind: 'ActivePlayer' }
  | { kind: 'Player'; playerId: string }
  | { kind: 'EachOpponent' }
  | { kind: 'EachPlayer' }
  | { kind: 'AllCreatures' }
  | { kind: 'AllAttackingCreatures' }
  | { kind: 'AllCreaturesYouControl' }
  | { kind: 'AllOfType'; filter: CardFilter }
  | { kind: 'Source' }
  | { kind: 'SourceAttachedTo' }
  | { kind: 'EventCaster' }
  | { kind: 'EventSpell' };

export type SourceRef = { kind: 'ThisSpell' } | { kind: 'ThisPermanent' };

// Activated ability cost components
export interface ActivatedAbilityCost {
  tap?: boolean;
  sacrifice?: 'self' | CardFilter;
  mana?: string; // raw mana cost like "{2}{B}"
  payLife?: number;
}

// Activated ability definition parsed from oracle text
export interface ActivatedAbility {
  kind: 'ActivatedAbility';
  cost: ActivatedAbilityCost;
  effects: Effect[];
  isManaAbility: boolean;
  targets: { id: string; type: string }[];
}

// ============================================================================
// Phase 15: Static/Continuous Abilities
// ============================================================================

/**
 * What a static ability modifies.
 */
export type StaticModifier =
  | { kind: 'ModifyPT'; power: number; toughness: number }
  | {
      kind: 'ModifyPTByUniqueColorsAmongOtherLegendaryPermanentsYouControl';
      powerPerColor: number;
      toughnessPerColor: number;
    }
  | { kind: 'GrantKeyword'; keyword: string }
  | { kind: 'GrantKeywords'; keywords: string[] }
  | { kind: 'ReduceCost'; amount: number };

/**
 * A static ability that applies continuously while the source is on the battlefield.
 * Examples:
 *   "Creatures you control get +1/+1"
 *   "Other creatures you control have flying"
 *   "Spells you cast cost {1} less to cast"
 *   "Elves you control get +1/+1"
 */
export interface StaticAbilityEffect {
  kind: 'StaticAbility';
  modifier: StaticModifier;
  filter: CardFilter;
  controller: 'you' | 'opponent' | 'any';
  excludeSelf: boolean; // true for "Other creatures you control..."
  selfOnly?: boolean; // true for "~ gets..." / named-card self modifiers
}

// ============================================================================
// Phase 15: Conditional Effects
// ============================================================================

/**
 * A condition that can be checked against the game state.
 */
export type Condition =
  | { kind: 'ControlsType'; controller: 'you' | 'opponent'; filter: CardFilter }
  | { kind: 'ControlsMoreThan'; who: 'opponent'; what: CardFilter; thanWho: 'you' }
  | { kind: 'LifeAtOrBelow'; controller: 'you' | 'opponent'; amount: number }
  | { kind: 'LifeAtOrAbove'; controller: 'you' | 'opponent'; amount: number };

/**
 * A conditional effect that checks a condition before executing.
 * Examples:
 *   "If you control a Dragon, draw two cards"
 *   "If an opponent controls more creatures than you, draw a card"
 *   "As long as you control an enchantment, ~ gets +1/+1"
 */
export interface ConditionalEffect {
  kind: 'Conditional';
  condition: Condition;
  effect: Effect;
  elseEffect?: Effect;
}

// ============================================================================
// Phase 17: Planeswalker Loyalty Abilities
// ============================================================================

/**
 * A planeswalker loyalty ability.
 * Loyalty cost can be positive (+N), negative (-N), or zero (0).
 * Examples:
 *   "+1: Create a 1/1 white Soldier creature token."
 *   "-3: Destroy target creature."
 *   "0: Draw a card."
 */
export interface LoyaltyAbility {
  kind: 'LoyaltyAbility';
  loyaltyCost: number; // positive (+1), negative (-3), or 0
  effects: Effect[];
  targets: { id: string; type: string }[];
}

// ============================================================================
// Cached Parse Data — computed once at card load time
// ============================================================================

export interface ManaProductionInfo {
  colors: Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'>;
  amounts: Record<string, number>;
  isTapAbility: boolean;
  requiresSacrifice: boolean;
  exileAfterUse?: boolean;
  sacrificeFilter?: CardFilter;
  activationZone?: 'battlefield' | 'hand';
  requiresExileFromHand?: boolean;
  amountScale?: 'creaturesYouControl';
  restriction?: 'creatureSpell' | 'creatureTypeSpell' | 'legendarySpell' | 'commanderSpell';
  /** True for fixed bundles such as "{T}: Add {C}{G}" where all listed mana is produced together. */
  producesAllColors?: boolean;
}

export interface EquipmentBonusInfo {
  power: number;
  toughness: number;
  keywords: string[];
}

export interface EquipCostInfo {
  generic: number;
  W: number; U: number; B: number; R: number; G: number; C: number;
}

export interface UnlessTaxInfo {
  triggerKind: string;
  taxAmount: number;
  effect: 'draw' | 'treasure' | 'other';
  effectCount: number;
}

export interface SearchAbilityInfo {
  filter?: string;
  destination: 'hand' | 'battlefield' | 'top' | 'graveyard';
  tapped?: boolean;
  shuffle: boolean;
  /** Maximum cards searchable. 1 for "a card", 2 for "up to two ... cards", etc. Defaults to 1. */
  count?: number;
}
