import { describe, expect, it } from 'vitest';
import {
  legalActionsByObject,
  normalizeKind,
  toLegalAction,
} from '../../../src/play/selectors/legalActionsByObject';
import { makeLegalAction } from '../fixtures/simpleState';

describe('normalizeKind', () => {
  it('maps engine action kinds to the view-model kinds', () => {
    expect(normalizeKind('CastSpell')).toBe('cast');
    expect(normalizeKind('PlayLand')).toBe('play-land');
    expect(normalizeKind('ActivateAbility')).toBe('activate');
    expect(normalizeKind('ActivateManaAbility')).toBe('activate');
    expect(normalizeKind('Equip')).toBe('activate');
    expect(normalizeKind('DeclareAttackers')).toBe('attack');
    expect(normalizeKind('DeclareBlockers')).toBe('block');
    expect(normalizeKind('PassPriority')).toBe('pass');
    expect(normalizeKind('SkipRestOfTurn')).toBe('pass');
    expect(normalizeKind('SkipEmptyPhases')).toBe('pass');
  });
});

describe('toLegalAction', () => {
  it('carries the original SimpleLegalAction as source for submitAction', () => {
    const src = makeLegalAction({ kind: 'CastSpell', label: 'Cast — {1}{B}' });
    const la = toLegalAction(src);
    expect(la.source).toBe(src);
    expect(la.kind).toBe('cast');
    expect(la.label).toBe('Cast — {1}{B}');
  });
});

describe('legalActionsByObject', () => {
  it('groups actions by cardInstanceId', () => {
    const actions = [
      makeLegalAction({ kind: 'CastSpell', cardInstanceId: 'c1', label: 'Cast — {B}' }),
      makeLegalAction({ kind: 'ActivateAbility', cardInstanceId: 'c1', label: 'Activate' }),
      makeLegalAction({ kind: 'PlayLand', cardInstanceId: 'land1', label: 'Play Land' }),
      makeLegalAction({ kind: 'PassPriority', label: 'Pass' }),
    ];
    const { byObject } = legalActionsByObject(actions, { hasPriority: true });
    expect(byObject.get('c1')).toHaveLength(2);
    expect(byObject.get('land1')).toHaveLength(1);
    // PassPriority has no cardInstanceId → not grouped under any object
    expect([...byObject.keys()].sort()).toEqual(['c1', 'land1']);
  });

  it('includes a top-level pass action whenever the human has priority', () => {
    const { pass } = legalActionsByObject([], { hasPriority: true });
    expect(pass).not.toBeNull();
    expect(pass?.kind).toBe('pass');
  });

  it('reuses an existing PassPriority action as the pass when present', () => {
    const passSrc = makeLegalAction({ kind: 'PassPriority', label: 'End Turn' });
    const { pass } = legalActionsByObject([passSrc], { hasPriority: true });
    expect(pass?.source).toBe(passSrc);
    expect(pass?.label).toBe('End Turn');
  });

  it('synthesizes a pass even if the engine did not emit PassPriority (no-dead-ends)', () => {
    const { pass } = legalActionsByObject(
      [makeLegalAction({ kind: 'CastSpell', cardInstanceId: 'c1', label: 'Cast' })],
      { hasPriority: true },
    );
    expect(pass).not.toBeNull();
    expect(pass?.kind).toBe('pass');
  });

  it('omits the top-level pass when the human does not have priority', () => {
    const { pass } = legalActionsByObject([], { hasPriority: false });
    expect(pass).toBeNull();
  });

  it('does not group pass/skip/combat actions under objects', () => {
    const actions = [
      makeLegalAction({ kind: 'SkipRestOfTurn', label: 'Skip to my next turn' }),
      makeLegalAction({ kind: 'DeclareAttackers', label: 'Attack' }),
    ];
    const { byObject } = legalActionsByObject(actions, { hasPriority: true });
    expect(byObject.size).toBe(0);
  });
});
