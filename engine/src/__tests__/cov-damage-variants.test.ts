import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';

type AnyObj = Record<string, any>;

function firstEffect(text: string): AnyObj {
  const res = parseOracleText(text) as AnyObj;
  // Spell-level effects live under .effects; triggered abilities nest under .ability.effects
  const effects: AnyObj[] = res.effects ?? res.ability?.effects ?? [];
  expect(effects.length).toBeGreaterThan(0);
  return effects[0];
}

describe('damage-variants: one-sided "deals damage equal to its power"', () => {
  it('parses "deals damage equal to its power to target creature you don\'t control"', () => {
    const res = parseOracleText(
      "Target creature you control deals damage equal to its power to target creature you don't control.",
    ) as AnyObj;
    const eff = res.effects[0];
    expect(eff.kind).toBe('DealDamage');
    // amount is the chosen fighterA's power
    expect(eff.amount.kind).toBe('TargetPower');
    expect(eff.amount.target.kind).toBe('Chosen');
    // damage target is the chosen fighterB
    expect(eff.target.kind).toBe('Chosen');
    // two distinct targets declared, A = you control, B = opponent controls
    expect(res.targets).toHaveLength(2);
    const a = res.targets.find((t: AnyObj) => t.id === eff.amount.target.targetId);
    const b = res.targets.find((t: AnyObj) => t.id === eff.target.targetId);
    expect(a.type).toBe('Creature');
    expect(a.constraints?.controllerControls).toBe(true);
    expect(b.type).toBe('Creature');
    expect(b.constraints?.opponentControls).toBe(true);
  });

  it('parses the "an opponent controls" phrasing', () => {
    const res = parseOracleText(
      'Target creature you control deals damage equal to its power to target creature an opponent controls.',
    ) as AnyObj;
    const eff = res.effects[0];
    expect(eff.kind).toBe('DealDamage');
    expect(eff.amount.kind).toBe('TargetPower');
    const b = res.targets.find((t: AnyObj) => t.id === eff.target.targetId);
    expect(b.constraints?.opponentControls).toBe(true);
  });

  it('NOW parses "or planeswalker" variants (slice 7/12 added CreatureOrPlaneswalker target type)', () => {
    // This test was previously asserting Unparsed because no planeswalker target type existed.
    // Slice 7/12 added support: the second target is now CreatureOrPlaneswalker.
    const res = parseOracleText(
      "Target creature you control deals damage equal to its power to target creature or planeswalker you don't control.",
    ) as AnyObj;
    expect(res.kind).toBe('Spell');
    const eff = res.effects[0];
    expect(eff.kind).toBe('DealDamage');
    expect(eff.amount.kind).toBe('TargetPower');
    expect(res.targets).toHaveLength(2);
    const b = res.targets.find((t: AnyObj) => t.id === eff.target.targetId);
    expect(b.type).toBe('CreatureOrPlaneswalker');
    expect(b.constraints?.opponentControls).toBe(true);
  });
});

describe('damage-variants: "deals damage to itself equal to its power"', () => {
  it('parses Repentance-style self-damage', () => {
    const res = parseOracleText('Target creature deals damage to itself equal to its power.') as AnyObj;
    const eff = res.effects[0];
    expect(eff.kind).toBe('DealDamage');
    expect(eff.amount.kind).toBe('TargetPower');
    // target and amount source reference the SAME chosen creature
    expect(eff.target.kind).toBe('Chosen');
    expect(eff.amount.target.kind).toBe('Chosen');
    expect(eff.amount.target.targetId).toBe(eff.target.targetId);
    expect(res.targets).toHaveLength(1);
    expect(res.targets[0].type).toBe('Creature');
  });
});

describe('damage-variants: existing damage patterns still parse (regression)', () => {
  it('still parses "deals N damage to each opponent" inside ETB', () => {
    const eff = firstEffect('When this creature enters, it deals 3 damage to each opponent.');
    expect(eff.kind).toBe('DealDamage');
    expect(eff.target.kind).toBe('EachOpponent');
    expect(eff.amount).toBe(3);
  });

  it('still parses mutual Fight', () => {
    const res = parseOracleText(
      "Target creature you control fights target creature you don't control.",
    ) as AnyObj;
    expect(res.effects[0].kind).toBe('Fight');
  });
});
