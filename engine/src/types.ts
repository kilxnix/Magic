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

export interface StackItem {
  id: string;
  cardInstanceId: string;
  casterId: string;
  targets: string[];
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
  commanderDamage: Record<string, number>;
  commanderTax: number;
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
    manaPool: emptyManaPool(),
    hasPlayedLand: false,
    hasPriority: false,
    hasLost: false,
  };
}
