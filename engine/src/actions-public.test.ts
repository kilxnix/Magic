import { describe, it, expect } from 'vitest';
import { tryPlayLand, tryTapLandForMana, tryCastSpell } from './actions-public';
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

describe('tryTapLandForMana', () => {
  it('returns ok with ManaTapped event when untapped land exists', () => {
    const state = makeTestState({ battlefieldLands: 1 });
    const landId = [...state.cards.values()].find(c => c.zone === 'battlefield')!.instanceId;
    const result = tryTapLandForMana(state, 'human', landId, 'G');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events[0]).toEqual({ kind: 'ManaTapped', playerId: 'human', cardId: landId, color: 'G' });
    }
  });

  it('returns already_tapped when land is tapped', () => {
    const state = makeTestState({ battlefieldLands: 1, tapLands: true });
    const landId = [...state.cards.values()].find(c => c.zone === 'battlefield')!.instanceId;
    const result = tryTapLandForMana(state, 'human', landId, 'G');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('already_tapped');
  });

  it('returns not_in_zone for hand card', () => {
    const state = makeTestState({ handLands: 1 });
    const landId = [...state.cards.values()].find(c => c.zone === 'hand')!.instanceId;
    const result = tryTapLandForMana(state, 'human', landId, 'G');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_in_zone');
  });
});

describe('tryCastSpell', () => {
  it('returns ok with SpellCast event when mana sufficient', () => {
    const state = makeTestState({ handInstant: '{1}{G}', manaPool: { G: 1, C: 1 } });
    const spellId = [...state.cards.values()].find(c => c.zone === 'hand')!.instanceId;
    const result = tryCastSpell(state, 'human', spellId, [], { C: 1, G: 1, W: 0, U: 0, B: 0, R: 0, generic: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events.some(e => e.kind === 'SpellCast')).toBe(true);
    }
  });

  it('returns insufficient_mana when pool is empty', () => {
    const state = makeTestState({ handInstant: '{1}{G}' });
    const spellId = [...state.cards.values()].find(c => c.zone === 'hand')!.instanceId;
    const result = tryCastSpell(state, 'human', spellId, [], { C: 0, G: 0, W: 0, U: 0, B: 0, R: 0, generic: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('insufficient_mana');
  });

  it('returns wrong_phase for sorcery during combat', () => {
    const state = makeTestState({ handSorcery: '{G}', manaPool: { G: 1 }, phase: 'combat' });
    const spellId = [...state.cards.values()].find(c => c.zone === 'hand')!.instanceId;
    const result = tryCastSpell(state, 'human', spellId, [], { G: 1, C: 0, W: 0, U: 0, B: 0, R: 0, generic: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrong_phase');
  });
});
