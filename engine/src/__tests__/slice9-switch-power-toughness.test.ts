/**
 * Slice 9: SwitchPowerToughness
 *
 * "Switch [target creature's | its] power and toughness until end of turn."
 * (Dwarven Thaumaturgist / Merfolk Thaumaturgist / Valakut Fireboar family.)
 *
 * Tests:
 *  1. Parser: targeted form — "switch target creature's power and toughness until end of turn."
 *  2. Parser: self-trigger form — "its" subject (Valakut Fireboar attack trigger body).
 *  3. Parser: activated-ability card (Dwarven Thaumaturgist full oracle text) parses to Activated.
 *  4. Parser: triggered-ability card (Valakut Fireboar full oracle text) parses to Triggered.
 *  5. Executor: SwitchPowerToughness stores _switchPT counter, swapping effective P/T.
 *  6. Executor: cleanupDamage clears _switchPT, restoring original P/T.
 *  7. Executor: Source target (self) form works correctly.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import { cleanupDamage } from '../state-based';
import { initGameState, getCardsInZone } from '../game-state';
import type { CardDefinition } from '../types';
import type { Effect } from '../effects/ast';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function creature(id: string, name: string, power: number, toughness: number): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature — Dwarf',
    oracle_text: '',
    mana_cost: '{1}{R}',
    cmc: 2,
    colors: ['R'],
    color_identity: ['R'],
    keywords: [],
    card_types: ['creature'],
    power,
    toughness,
  };
}

function makeState(power: number, toughness: number) {
  const def = creature('target-creature', 'Target Creature', power, toughness);
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: [def], commanderId: 'cmd1' },
    { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
  ];
  const state = initGameState(decks);
  const card = getCardsInZone(state, 'p1', 'library')[0];
  state.cards.set(card.instanceId, {
    ...card,
    zone: 'battlefield',
    summoningSick: false,
  });
  return { state, card };
}

// ---------------------------------------------------------------------------
// Parser tests
// ---------------------------------------------------------------------------

describe('slice9-switch-power-toughness: parser', () => {
  it('1. parses targeted form — "switch target creature\'s power and toughness until end of turn."', () => {
    const text = "Switch target creature's power and toughness until end of turn.";
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.effects).toHaveLength(1);
    const effect = parsed.effects[0];
    expect(effect.kind).toBe('SwitchPowerToughness');
    if (effect.kind !== 'SwitchPowerToughness') return;

    // Target ref must be a Chosen (targeted form)
    expect(effect.target.kind).toBe('Chosen');
    // One TargetSpec: a Creature
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');
  });

  it('2. parses self-trigger "its" form — "switch its power and toughness until end of turn."', () => {
    const text = 'Switch its power and toughness until end of turn.';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.effects).toHaveLength(1);
    const effect = parsed.effects[0];
    expect(effect.kind).toBe('SwitchPowerToughness');
    if (effect.kind !== 'SwitchPowerToughness') return;

    // "its" → Source (self-referential trigger body)
    expect(effect.target.kind).toBe('Source');
    // No target specs for self form
    expect(parsed.targets).toHaveLength(0);
  });

  it('3. parses Dwarven/Merfolk Thaumaturgist full oracle — activated ability emitting SwitchPowerToughness', () => {
    // Dwarven Thaumaturgist: "{T}: Switch target creature's power and toughness until end of turn."
    const text = "{T}: Switch target creature's power and toughness until end of turn.";
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Activated');
    if (parsed.kind !== 'Activated') return;

    expect(parsed.abilities).toHaveLength(1);
    const ability = parsed.abilities[0];
    expect(ability.effects).toHaveLength(1);
    const effect = ability.effects[0];
    expect(effect.kind).toBe('SwitchPowerToughness');
    if (effect.kind !== 'SwitchPowerToughness') return;
    expect(effect.target.kind).toBe('Chosen');
  });

  it('4. parses Valakut Fireboar-style attack trigger — triggered ability emitting SwitchPowerToughness', () => {
    // Valakut Fireboar: "Whenever this creature attacks, switch its power and toughness until end of turn."
    const text = 'Whenever this creature attacks, switch its power and toughness until end of turn.';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    expect(parsed.ability.effects).toHaveLength(1);
    const effect = parsed.ability.effects[0];
    expect(effect.kind).toBe('SwitchPowerToughness');
    if (effect.kind !== 'SwitchPowerToughness') return;
    // Self-reference ("its") → Source
    expect(effect.target.kind).toBe('Source');
  });

  it('5. rejects unrelated P/T text — does not parse as SwitchPowerToughness', () => {
    // A pump effect should NOT be parsed as SwitchPowerToughness
    const text = 'Target creature gets +2/+2 until end of turn.';
    const parsed = parseOracleText(text);
    if (parsed.kind === 'Spell') {
      const hasSwitchEffect = parsed.effects.some(e => e.kind === 'SwitchPowerToughness');
      expect(hasSwitchEffect).toBe(false);
    }
    // (Most pump-only text parses to ModifyPT, not SwitchPowerToughness.)
  });
});

// ---------------------------------------------------------------------------
// Executor tests
// ---------------------------------------------------------------------------

describe('slice9-switch-power-toughness: executor', () => {
  it('6. SwitchPowerToughness swaps effective P/T (2/5 → reports 5 power, 2 toughness)', () => {
    const { state, card } = makeState(2, 5);
    // Before: normal P/T
    expect(getEffectivePower(state, card.instanceId)).toBe(2);
    expect(getEffectiveToughness(state, card.instanceId)).toBe(5);

    const text = "Switch target creature's power and toughness until end of turn.";
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const after = executeEffects(
      state,
      parsed.effects,
      'p1',
      [card.instanceId],
      parsed.targets,
      0,
    );

    // The _switchPT flag should be set
    const afterCard = after.cards.get(card.instanceId)!;
    expect(afterCard.counters['_switchPT']).toBe(1);

    // Effective P/T must now be swapped
    expect(getEffectivePower(after, card.instanceId)).toBe(5);
    expect(getEffectiveToughness(after, card.instanceId)).toBe(2);
  });

  it('7. cleanupDamage clears _switchPT, restoring original P/T', () => {
    const { state, card } = makeState(3, 7);

    const text = "Switch target creature's power and toughness until end of turn.";
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const after = executeEffects(
      state,
      parsed.effects,
      'p1',
      [card.instanceId],
      parsed.targets,
      0,
    );

    // Verify swap is active
    expect(getEffectivePower(after, card.instanceId)).toBe(7);
    expect(getEffectiveToughness(after, card.instanceId)).toBe(3);

    // Simulate end-of-turn cleanup
    const cleaned = cleanupDamage({ ...after, step: 'cleanup' });

    // _switchPT should be gone
    const cleanedCard = cleaned.cards.get(card.instanceId)!;
    expect(cleanedCard.counters['_switchPT']).toBeUndefined();

    // P/T should return to original values
    expect(getEffectivePower(cleaned, card.instanceId)).toBe(3);
    expect(getEffectiveToughness(cleaned, card.instanceId)).toBe(7);
  });

  it('8. Source target (self) form swaps the caster\'s own P/T', () => {
    const { state, card } = makeState(1, 6);
    // Before
    expect(getEffectivePower(state, card.instanceId)).toBe(1);
    expect(getEffectiveToughness(state, card.instanceId)).toBe(6);

    // Directly construct and execute a SwitchPowerToughness Source effect
    // (this mirrors what Valakut Fireboar's attack trigger body does)
    const switchEffect: Effect = {
      kind: 'SwitchPowerToughness',
      target: { kind: 'Source' },
    };

    const after = executeEffects(
      state,
      [switchEffect],
      'p1',
      [],
      [],
      0,
      { sourceInstanceId: card.instanceId },
    );

    expect(getEffectivePower(after, card.instanceId)).toBe(6);
    expect(getEffectiveToughness(after, card.instanceId)).toBe(1);
  });
});
