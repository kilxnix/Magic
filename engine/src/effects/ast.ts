// Phase 4 (parser-first): Effect system AST types
// Phase 10: Extended with modal, X costs, tokens, and more primitives

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
  | SearchLibraryEffect
  | ShuffleLibraryEffect;

// Amount can be a fixed number or reference to X
export type AmountRef = number | { kind: 'X' } | { kind: 'XMultiplied'; multiplier: number };

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
  choices: ModalChoice[];
}

export interface TriggeredAbility {
  kind: 'TriggeredAbility';
  trigger: Trigger;
  effects: Effect[];
}

export type Trigger =
  | { kind: 'ETB'; who: 'self' | 'any' | 'controller' }
  | { kind: 'Dies'; who: 'self' | 'any' };

export type TargetRef =
  | { kind: 'Chosen'; targetId: string }
  | { kind: 'Controller' }
  | { kind: 'Player'; playerId: string }
  | { kind: 'EachOpponent' }
  | { kind: 'AllCreatures' };

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
