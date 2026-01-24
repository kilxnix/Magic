// Phase 4 (parser-first): Effect system AST types (v0)

export type Effect =
  | DrawEffect
  | DestroyEffect
  | DealDamageEffect
  | GainLifeEffect
  | LoseLifeEffect;

export interface DrawEffect {
  kind: 'Draw';
  player: TargetRef;
  count: number;
}

export interface DestroyEffect {
  kind: 'Destroy';
  target: TargetRef;
}

export interface DealDamageEffect {
  kind: 'DealDamage';
  source?: SourceRef;
  target: TargetRef;
  amount: number;
}

export interface GainLifeEffect {
  kind: 'GainLife';
  player: TargetRef;
  amount: number;
}

export interface LoseLifeEffect {
  kind: 'LoseLife';
  player: TargetRef;
  amount: number;
}

export interface TriggeredAbility {
  kind: 'TriggeredAbility';
  trigger: Trigger;
  effects: Effect[];
}

export type Trigger = { kind: 'ETB'; who: 'self' | 'any' | 'controller' };

export type TargetRef =
  | { kind: 'Chosen'; targetId: string }
  | { kind: 'Controller' }
  | { kind: 'Player'; playerId: string };

export type SourceRef = { kind: 'ThisSpell' } | { kind: 'ThisPermanent' };
