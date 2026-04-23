import { describe, it, expect } from 'vitest';
import { tryPlayLand } from './actions-public';
import { makeTestState } from './__tests__/test-helpers';

describe('tryPlayLand', () => {
  it('returns ok and LandPlayed event on success', () => {
    const state = makeTestState({ handLands: 1 });
    const landId = [...state.cards.values()].find(c => c.zone === 'hand')!.instanceId;
    const result = tryPlayLand(state, 'human', landId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events).toContainEqual(
        expect.objectContaining({ kind: 'LandPlayed', cardId: landId }),
      );
    }
  });

  it('returns land_already_played when a land was played this turn', () => {
    const state = makeTestState({ handLands: 2, landAlreadyPlayed: true });
    const landId = [...state.cards.values()].find(c => c.zone === 'hand')!.instanceId;
    const result = tryPlayLand(state, 'human', landId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('land_already_played');
  });

  it('returns wrong_phase outside main phase', () => {
    const state = makeTestState({ handLands: 1, phase: 'combat' });
    const landId = [...state.cards.values()].find(c => c.zone === 'hand')!.instanceId;
    const result = tryPlayLand(state, 'human', landId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrong_phase');
  });

  it('returns not_your_turn when active player is elsewhere', () => {
    const state = makeTestState({ handLands: 1, activePlayerIndex: 1 });
    const landId = [...state.cards.values()].find(c => c.zone === 'hand')!.instanceId;
    const result = tryPlayLand(state, 'human', landId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_your_turn');
  });

  it('returns card_not_found for unknown instance id', () => {
    const state = makeTestState({});
    const result = tryPlayLand(state, 'human', 'nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('card_not_found');
  });
});
