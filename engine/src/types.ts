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
  isCommander: boolean;
}

// Import TriggeredAbility from effects/ast (forward declaration for type safety)
// Actual import is done in files that need the full type
export interface TriggeredAbilityRef {
  kind: 'TriggeredAbility';
  trigger: { kind: 'ETB'; who: 'self' | 'any' | 'controller' }
    | { kind: 'Dies'; who: 'self' | 'any' };
  effects: unknown[]; // Effect[] from ast.ts
}

export type StackItemKind = 'Spell' | 'TriggeredAbility' | 'ActivatedAbility';

export interface SpellStackItem {
  kind: 'Spell';
  id: string;
  cardInstanceId: string;
  casterId: string;
  targets: string[];
  chosenModes?: number[];
}

export interface TriggeredAbilityStackItem {
  kind: 'TriggeredAbility';
  id: string;
  sourceInstanceId: string;
  controllerId: string;
  ability: TriggeredAbilityRef;
  targets: string[];
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

export interface Player {
  id: string;
  name: string;
  life: number;
  commanderDamage: Record<string, number>; // commanderInstanceId -> damage taken
  commanderTax: number;
  commanderInstanceId: string | null; // player's commander card instance
  commanderCastCount: number; // times commander has been cast from command zone
  manaPool: ManaPool;
  hasPlayedLand: boolean;
  hasPriority: boolean;
  hasLost: boolean;
}

export interface GameState {
  players: Player[];
  cards: Map<string, CardInstance>;
  cardDefinitions: Map<string, CardDefinition>;
  activePlayerIndex: number;
  priorityPlayerIndex: number;
  phase: Phase;
  step: Step;
  turnNumber: number;
  hasPriorityPassed: boolean[];
  stack: StackItem[];
  combat: CombatState | null;

  // Phase 6: Triggers
  battlefieldAbilities: Map<string, TriggeredAbilityRef[]>; // instanceId → abilities
  pendingTriggers: PendingTrigger[];
}

export function emptyManaPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

export function createPlayer(id: string, name: string, life: number = 40): Player {
  return {
    id,
    name,
    life,
    commanderDamage: {},
    commanderTax: 0,
    commanderInstanceId: null,
    commanderCastCount: 0,
    manaPool: emptyManaPool(),
    hasPlayedLand: false,
    hasPriority: false,
    hasLost: false,
  };
}
