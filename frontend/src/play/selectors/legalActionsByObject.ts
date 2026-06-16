import type { SimpleLegalAction, LegalAction, LegalActionKind } from '../gameView.types';

/**
 * Maps a SimpleLegalAction.kind (which mirrors AIAction['kind'] plus the synthetic
 * Skip* kinds) to the view-model LegalActionKind. Unknown kinds fall back to
 * 'examine' so the UI never crashes on an unexpected action.
 */
export function normalizeKind(kind: string): LegalActionKind {
  switch (kind) {
    case 'CastSpell':
      return 'cast';
    case 'PlayLand':
      return 'play-land';
    case 'ActivateAbility':
    case 'ActivateManaAbility':
    case 'Equip':
      return 'activate';
    case 'DeclareAttackers':
      return 'attack';
    case 'DeclareBlockers':
      return 'block';
    case 'PassPriority':
    case 'SkipRestOfTurn':
    case 'SkipEmptyPhases':
      return 'pass';
    default:
      return 'examine';
  }
}

export function toLegalAction(source: SimpleLegalAction): LegalAction {
  return {
    source,
    kind: normalizeKind(source.kind),
    label: source.label,
  };
}

/** Kinds that belong to the table/priority strip, not to a specific permanent. */
function isObjectAction(kind: string): boolean {
  const normalized = normalizeKind(kind);
  return normalized !== 'pass' && normalized !== 'attack' && normalized !== 'block';
}

export interface LegalActionsByObjectResult {
  /** cardInstanceId → its legal actions (cast / play-land / activate / equip). */
  byObject: Map<string, LegalAction[]>;
  /**
   * The top-level pass action, present whenever the human has priority.
   * INVARIANT (no-dead-ends): non-null whenever `hasPriority` is true, even if the
   * engine did not enumerate a PassPriority action.
   */
  pass: LegalAction | null;
}

export interface LegalActionsByObjectOptions {
  hasPriority: boolean;
}

/**
 * Synthetic SimpleLegalAction used when the human has priority but the engine
 * didn't surface an explicit PassPriority (keeps the no-dead-ends invariant).
 */
function syntheticPass(): SimpleLegalAction {
  return {
    kind: 'PassPriority',
    label: 'Pass',
    _engineAction: ({ kind: 'PassPriority' } as unknown) as SimpleLegalAction['_engineAction'],
  };
}

export function legalActionsByObject(
  actions: SimpleLegalAction[],
  options: LegalActionsByObjectOptions,
): LegalActionsByObjectResult {
  const byObject = new Map<string, LegalAction[]>();

  for (const action of actions) {
    if (!action.cardInstanceId) continue;
    if (!isObjectAction(action.kind)) continue;
    const list = byObject.get(action.cardInstanceId) ?? [];
    list.push(toLegalAction(action));
    byObject.set(action.cardInstanceId, list);
  }

  let pass: LegalAction | null = null;
  if (options.hasPriority) {
    const existing = actions.find(action => action.kind === 'PassPriority');
    pass = toLegalAction(existing ?? syntheticPass());
  }

  return { byObject, pass };
}
