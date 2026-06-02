const DESIRED_COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
const DESIRED_MASK = (1 << DESIRED_COLORS.length) - 1;

type DesiredColor = typeof DESIRED_COLORS[number];

export interface ManaTapPlanAction {
  cardInstanceId?: string;
  label?: string;
  _engineAction?: unknown;
}

interface PlanCandidate<T> {
  actions: T[];
  counts: Record<string, number>;
  mask: number;
}

function colorMask(color: string): number {
  const index = DESIRED_COLORS.indexOf(color as DesiredColor);
  return index >= 0 ? (1 << index) : 0;
}

function countDesiredColors(mask: number): number {
  let count = 0;
  let rest = mask;
  while (rest > 0) {
    count += rest & 1;
    rest >>= 1;
  }
  return count;
}

function duplicatePenalty(counts: Record<string, number>): number {
  return Object.entries(counts).reduce((total, [color, count]) => {
    const colorWeight = color === 'C' ? 3 : 1;
    return total + colorWeight * Math.max(0, count - 1);
  }, 0);
}

function actionColor(action: ManaTapPlanAction): string {
  const engineAction = action._engineAction;
  if (!engineAction || typeof engineAction !== 'object') return 'C';
  const color = (engineAction as { color?: unknown }).color;
  return typeof color === 'string' ? color : 'C';
}

function isBetterCandidate<T>(candidate: PlanCandidate<T>, current?: PlanCandidate<T>): boolean {
  if (!current) return true;
  const candidateColors = countDesiredColors(candidate.mask);
  const currentColors = countDesiredColors(current.mask);
  if (candidateColors !== currentColors) return candidateColors > currentColors;
  const candidateFull = candidate.mask === DESIRED_MASK;
  const currentFull = current.mask === DESIRED_MASK;
  if (candidateFull !== currentFull) return candidateFull;
  return duplicatePenalty(candidate.counts) < duplicatePenalty(current.counts);
}

export function buildTapAllManaPlan<T extends ManaTapPlanAction>(manaActions: T[]): T[] {
  const byCard = new Map<string, T[]>();
  for (const action of manaActions.filter(candidate => candidate.label?.startsWith('Tap '))) {
    if (!action.cardInstanceId) continue;
    const options = byCard.get(action.cardInstanceId) ?? [];
    options.push(action);
    byCard.set(action.cardInstanceId, options);
  }

  const groups = [...byCard.values()].sort((a, b) => a.length - b.length);
  if (groups.length === 0) return [];

  let candidates = new Map<number, PlanCandidate<T>>();
  candidates.set(0, { actions: [], counts: {}, mask: 0 });

  for (const options of groups) {
    const next = new Map<number, PlanCandidate<T>>();
    for (const candidate of candidates.values()) {
      for (const option of options) {
        const color = actionColor(option);
        const mask = candidate.mask | colorMask(color);
        const counts = {
          ...candidate.counts,
          [color]: (candidate.counts[color] ?? 0) + 1,
        };
        const updated: PlanCandidate<T> = {
          actions: [...candidate.actions, option],
          counts,
          mask,
        };
        if (isBetterCandidate(updated, next.get(mask))) {
          next.set(mask, updated);
        }
      }
    }
    candidates = next;
  }

  let best: PlanCandidate<T> | undefined;
  for (const candidate of candidates.values()) {
    if (isBetterCandidate(candidate, best)) {
      best = candidate;
    }
  }

  return best?.actions ?? [];
}
