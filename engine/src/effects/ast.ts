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
  | GainLifeEffect
  | LoseLifeEffect
  | ExileEffect
  | ReturnToHandEffect
  | SacrificeEffect
  | MillEffect
  | AddCountersEffect
  | RemoveCountersEffect
  | TapEffect
  | UntapEffect
  | CreateTokenEffect
  | DiscardEffect
  | ScryEffect
  | SurveilEffect
  | SearchLibraryEffect
  | ShuffleLibraryEffect
  | CounterSpellEffect
  | ReturnFromGraveyardEffect
  | ModifyPTEffect
  | ExileFromLibraryEffect
  | GainControlEffect
  | ConditionalEffect
  | BlinkEffect
  | CopyEffect
  | GrantKeywordEffect
  | PhaseOutEffect
  | WinGameEffect
  | LoseGameEffect
  | AddManaEffect;

// Amount can be a fixed number, reference to X, or a dynamic "for each" count
export type AmountRef =
  | number
  | { kind: 'X' }
  | { kind: 'XMultiplied'; multiplier: number }
  | ForEachAmount;

// Dynamic count: "for each [condition]" — evaluated at resolution time
export interface ForEachAmount {
  kind: 'ForEach';
  zone: 'battlefield' | 'hand' | 'graveyard' | 'library';
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
}

export interface CreateTokenEffect {
  kind: 'CreateToken';
  controller: TargetRef;
  token: TokenDefinition;
  count: AmountRef;
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

export interface SearchLibraryEffect {
  kind: 'SearchLibrary';
  player: TargetRef;
  filter: CardFilter;
  destination: 'battlefield' | 'hand' | 'graveyard';
  tapped?: boolean;
  shuffle: boolean;
}

export interface ShuffleLibraryEffect {
  kind: 'ShuffleLibrary';
  player: TargetRef;
}

export interface CounterSpellEffect {
  kind: 'CounterSpell';
  target: TargetRef;
  filter?: 'noncreature'; // undefined = any spell
}

export interface ReturnFromGraveyardEffect {
  kind: 'ReturnFromGraveyard';
  target: TargetRef;
  destination: 'hand' | 'battlefield';
}

export interface ModifyPTEffect {
  kind: 'ModifyPT';
  target: TargetRef;
  power: number; // e.g. +2 or -2
  toughness: number;
  untilEndOfTurn: boolean;
}

// Exile cards from the top of a library (impulse draw)
export interface ExileFromLibraryEffect {
  kind: 'ExileFromLibrary';
  player: TargetRef;
  count: AmountRef;
  mayPlay?: boolean; // "you may play them this turn"
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

// Grant a keyword to a creature (one-shot, not static)
export interface GrantKeywordEffect {
  kind: 'GrantKeyword';
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

// Token definition for CreateToken
export interface TokenDefinition {
  name: string;
  colors: Array<'W' | 'U' | 'B' | 'R' | 'G'>;
  types: string[];
  subtypes?: string[];
  power: number;
  toughness: number;
  keywords?: string[];
  abilities?: string[];
}

// Card filter for sacrifice/search effects
export interface CardFilter {
  types?: string[];
  subtypes?: string[];
  supertypes?: string[];
  colors?: Array<'W' | 'U' | 'B' | 'R' | 'G'>;
  cmc?: { op: 'eq' | 'lte' | 'gte'; value: number };
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
}

export type Trigger =
  | { kind: 'ETB'; who: 'self' | 'any' | 'controller' }
  | { kind: 'Dies'; who: 'self' | 'any' }
  | { kind: 'Attacks'; who: 'self' }
  | { kind: 'Upkeep'; whose: 'yours' | 'each' }
  | { kind: 'EndStep'; whose: 'yours' }
  | { kind: 'AnotherCreatureETB'; controller: 'yours' }
  | { kind: 'CreatureYouControlDies' }
  | { kind: 'YouCastSpell' }
  // Phase 17: Additional trigger types
  | { kind: 'LifeGain' }
  | { kind: 'CardDrawn' }
  | { kind: 'OpponentCastSpell' }
  | { kind: 'AnyCreatureETB' }
  | { kind: 'CastInstantOrSorcery' }
  | { kind: 'Landfall' };

export type TargetRef =
  | { kind: 'Chosen'; targetId: string }
  | { kind: 'Controller' }
  | { kind: 'Player'; playerId: string }
  | { kind: 'EachOpponent' }
  | { kind: 'EachPlayer' }
  | { kind: 'AllCreatures' }
  | { kind: 'AllCreaturesYouControl' }
  | { kind: 'AllOfType'; filter: CardFilter };

export type SourceRef = { kind: 'ThisSpell' } | { kind: 'ThisPermanent' };

// Activated ability cost components
export interface ActivatedAbilityCost {
  tap?: boolean;
  sacrifice?: 'self' | CardFilter;
  mana?: string; // raw mana cost like "{2}{B}"
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
  | { kind: 'GrantKeyword'; keyword: string }
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
}
