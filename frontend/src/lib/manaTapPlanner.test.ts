import { describe, expect, it } from 'vitest';
import { buildTapAllManaPlan, type ManaTapPlanAction } from './manaTapPlanner';

function tap(cardInstanceId: string, color: string): ManaTapPlanAction {
  return {
    cardInstanceId,
    label: `Tap ${cardInstanceId} for ${color}`,
    _engineAction: { color },
  };
}

describe('buildTapAllManaPlan', () => {
  it('chooses a five-color spread from overlapping dual lands', () => {
    const plan = buildTapAllManaPlan([
      tap('temple_garden', 'W'),
      tap('temple_garden', 'G'),
      tap('rejuvenating_springs', 'U'),
      tap('rejuvenating_springs', 'G'),
      tap('undergrowth_stadium', 'B'),
      tap('undergrowth_stadium', 'G'),
      tap('stomping_ground', 'R'),
      tap('stomping_ground', 'G'),
      tap('steam_vents', 'U'),
      tap('steam_vents', 'R'),
    ]);

    expect(plan.map(action => (action._engineAction as { color?: string }).color).sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
  });

  it('still returns one tap per source when all five colors are not possible', () => {
    const plan = buildTapAllManaPlan([
      tap('island', 'U'),
      tap('mountain', 'R'),
      tap('steam_vents', 'U'),
      tap('steam_vents', 'R'),
    ]);

    expect(plan).toHaveLength(3);
    expect(plan.map(action => action.cardInstanceId).sort()).toEqual(['island', 'mountain', 'steam_vents']);
  });
});
