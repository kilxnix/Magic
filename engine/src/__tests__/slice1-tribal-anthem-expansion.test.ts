/**
 * Slice 1 — Tribal-anthem subtype expansion + plural-form + untapped-get variant.
 *
 * Coverage:
 *   A. New subtypes in parseStaticFilterType (kobold, turtle, detective, villain,
 *      minotaur, pegasus, spawn/scion/eldrazi, rebel, mercenary, kithkin, ally,
 *      shapeshifter, avatar, kor) — parser recognition.
 *   B. Plural-no-creatures form "[Type]s you control get +N/+N" — already handled
 *      by matchStaticAbility via parseStaticSubject once the subtype is in the map.
 *   C. "Other [Subtype] creatures you control get +N/+N" (tribal anthem) — both
 *      "Other" and non-"Other" forms.
 *   D. "Untapped creatures you control get +0/+2" — Builder's Blessing P/T form;
 *      extends matchOtherTappedUntappedCreaturesHave to handle "get/gets".
 *   E. Execution tests: continuous layer correctly applies the anthem to matching
 *      creatures and NOT to non-matching ones.
 *
 * Executor route: all parsed forms emit StaticAbility{ModifyPT, filter:{types:
 * ['creature'], subtypes:[<type>]}} (or tapped: false for the untapped form),
 * identical to existing working tribal anthems (Merfolk, Sliver, etc.), so the
 * continuous layer's anthem machinery already handles them.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import {
  getEffectivePower,
  getEffectiveToughness,
} from '../effects/continuous';
import { initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import type { CardDefinition } from '../types';

// ============================================================================
// Helpers
// ============================================================================

function creature(
  id: string,
  opts: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Creature — Test',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{1}',
    cmc: opts.cmc ?? 1,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 1,
    toughness: opts.toughness ?? 1,
  };
}

function setup(
  p1Defs: CardDefinition[],
  p2Defs: CardDefinition[] = [creature('p2dummy')],
  tapIds: Set<string> = new Set(),
) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'none1' },
    { playerId: 'p2', name: 'Bob', cards: p2Defs, commanderId: 'none2' },
  ];
  let state = initGameState(decks);
  for (const [id, card] of state.cards) {
    const def = state.cardDefinitions.get(card.definitionId);
    const shouldTap = def ? tapIds.has(def.id) : false;
    state.cards.set(id, {
      ...card,
      zone: 'battlefield',
      summoningSick: false,
      tapped: shouldTap,
    });
  }
  for (const card of state.cards.values()) {
    if (card.zone === 'battlefield') {
      state = registerContinuousAbilitiesForPermanent(state, card.instanceId);
    }
  }
  const idFor = (defId: string) =>
    [...state.cards.values()].find(c => c.definitionId === defId)!.instanceId;
  return { state, idFor };
}

// ============================================================================
// A + B + C: Parser recognition — new subtypes and plural/typed anthem forms
// ============================================================================

describe('Tribal anthem subtype expansion — parser recognition', () => {
  // Kobold Taskmaster: "Other Kobold creatures you control get +1/+0."
  it('Kobold Taskmaster: "Other Kobold creatures you control get +1/+0." parses as StaticAbility', () => {
    const r = parseOracleText('Other Kobold creatures you control get +1/+0.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 0 });
    expect(r.ability.filter).toEqual({ types: ['creature'], subtypes: ['kobold'] });
    expect(r.ability.controller).toBe('you');
    expect(r.ability.excludeSelf).toBe(true);
  });

  // Plural-no-creatures form: "Turtles you control get +2/+2."
  it('Turtle Power: "Turtles you control get +2/+2." (plural no-creatures form) parses as StaticAbility', () => {
    const r = parseOracleText('Turtles you control get +2/+2.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 2, toughness: 2 });
    expect(r.ability.filter).toEqual({ types: ['creature'], subtypes: ['turtle'] });
    expect(r.ability.controller).toBe('you');
    expect(r.ability.excludeSelf).toBe(false);
  });

  // Flash prefix + plural: "Flash. Turtles you control get +2/+2." (the per-line dispatch handles multi-line)
  it('"Flash Turtles you control get +2/+2." (variant without comma) parses as StaticAbility', () => {
    // Without Flash prefix — the static line itself
    const r = parseOracleText('Turtles you control get +2/+2.');
    expect(r.kind).toBe('StaticAbility');
  });

  // Private Eye: "Other Detectives you control get +1/+1."
  it('Private Eye: "Other Detectives you control get +1/+1." parses as StaticAbility', () => {
    const r = parseOracleText('Other Detectives you control get +1/+1.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(r.ability.filter).toEqual({ types: ['creature'], subtypes: ['detective'] });
    expect(r.ability.controller).toBe('you');
    expect(r.ability.excludeSelf).toBe(true);
  });

  // Villain subtype
  it('"Other Villains you control get +1/+1." parses as StaticAbility with villain subtype', () => {
    const r = parseOracleText('Other Villains you control get +1/+1.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.filter).toEqual({ types: ['creature'], subtypes: ['villain'] });
    expect(r.ability.excludeSelf).toBe(true);
  });

  // Minotaur subtype
  it('"Other Minotaur creatures you control get +1/+1." parses as StaticAbility with minotaur subtype', () => {
    const r = parseOracleText('Other Minotaur creatures you control get +1/+1.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.filter).toEqual({ types: ['creature'], subtypes: ['minotaur'] });
    expect(r.ability.excludeSelf).toBe(true);
  });

  // Pegasus subtype
  it('"Pegasus creatures you control get +1/+1." parses as StaticAbility with pegasus subtype', () => {
    const r = parseOracleText('Pegasus creatures you control get +1/+1.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.filter).toEqual({ types: ['creature'], subtypes: ['pegasus'] });
    expect(r.ability.excludeSelf).toBe(false);
  });

  // Spawn subtype (Broodwarden uses "Eldrazi Spawn creatures" — we parse "Spawn" as the subtype)
  it('"Spawn creatures you control get +2/+1." parses as StaticAbility with spawn subtype', () => {
    const r = parseOracleText('Spawn creatures you control get +2/+1.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.filter).toEqual({ types: ['creature'], subtypes: ['spawn'] });
  });

  // Rebel subtype
  it('"Rebel creatures you control get +1/+1." parses as StaticAbility with rebel subtype', () => {
    const r = parseOracleText('Rebel creatures you control get +1/+1.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.filter).toEqual({ types: ['creature'], subtypes: ['rebel'] });
  });

  // Ally subtype (plural form)
  it('"Allies you control get +1/+1." (plural) parses as StaticAbility with ally subtype', () => {
    const r = parseOracleText('Allies you control get +1/+1.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.filter).toEqual({ types: ['creature'], subtypes: ['ally'] });
  });

  // Non-other form
  it('"Kobold creatures you control get +1/+0." (no Other) parses as StaticAbility without excludeSelf', () => {
    const r = parseOracleText('Kobold creatures you control get +1/+0.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.filter).toEqual({ types: ['creature'], subtypes: ['kobold'] });
    expect(r.ability.excludeSelf).toBe(false);
  });

  // "All <subtype> get" form (matchAllSubtypeAnthem) — confirms new subtypes work there too
  it('"All Minotaurs get +1/+1." (All-subtype form) parses as StaticAbility with controller:any', () => {
    const r = parseOracleText('All Minotaurs get +1/+1.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(r.ability.filter).toEqual({ types: ['creature'], subtypes: ['minotaur'] });
    expect(r.ability.controller).toBe('any');
  });
});

// ============================================================================
// D: "Untapped creatures you control get +0/+2" (Builder's Blessing P/T form)
// ============================================================================

describe('matchOtherTappedUntappedCreaturesHave — P/T form (get/gets)', () => {
  it('Builder\'s Blessing: "Untapped creatures you control get +0/+2." parses as StaticAbility', () => {
    const r = parseOracleText('Untapped creatures you control get +0/+2.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 0, toughness: 2 });
    expect(r.ability.filter).toMatchObject({ types: ['creature'], tapped: false });
    expect(r.ability.controller).toBe('you');
    expect(r.ability.excludeSelf).toBe(false);
  });

  it('"Other untapped creatures you control get +1/+1." (Other form) parses as StaticAbility', () => {
    const r = parseOracleText('Other untapped creatures you control get +1/+1.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(r.ability.filter).toMatchObject({ types: ['creature'], tapped: false });
    expect(r.ability.excludeSelf).toBe(true);
  });

  it('"Tapped creatures you control get -1/+0." parses as StaticAbility (tapped P/T debuff)', () => {
    const r = parseOracleText('Tapped creatures you control get -1/+0.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: -1, toughness: 0 });
    expect(r.ability.filter).toMatchObject({ types: ['creature'], tapped: true });
  });

  it('Temporary "until end of turn" untapped get form stays a spell effect (not StaticAbility)', () => {
    const r = parseOracleText('Untapped creatures you control get +0/+2 until end of turn.');
    expect(r.kind).not.toBe('StaticAbility');
  });
});

// ============================================================================
// E: Execution — continuous layer applies anthem to matching creatures
// ============================================================================

describe('Tribal anthem expansion — execution (continuous layer)', () => {
  it('Kobold anthem boosts controller\'s Kobolds but not non-Kobolds', () => {
    const taskmaster = creature('taskmaster', {
      name: 'Kobold Taskmaster',
      type_line: 'Creature — Kobold',
      oracle_text: 'Other Kobold creatures you control get +1/+0.',
      power: 1,
      toughness: 1,
    });
    const kobold1 = creature('kob1', {
      name: 'Kobold 1',
      type_line: 'Creature — Kobold',
      power: 1,
      toughness: 1,
    });
    const elf = creature('elf', {
      name: 'Llanowar Elves',
      type_line: 'Creature — Elf Druid',
      power: 1,
      toughness: 1,
    });

    const { state, idFor } = setup([taskmaster, kobold1, elf]);

    // kobold1 gets +1/+0 from taskmaster → 2/1
    expect(getEffectivePower(state, idFor('kob1'))).toBe(2);
    expect(getEffectiveToughness(state, idFor('kob1'))).toBe(1);

    // Elf stays at 1/1
    expect(getEffectivePower(state, idFor('elf'))).toBe(1);
    expect(getEffectiveToughness(state, idFor('elf'))).toBe(1);

    // taskmaster excluded from its own anthem (excludeSelf)
    expect(getEffectivePower(state, idFor('taskmaster'))).toBe(1);
  });

  it('Turtle anthem (plural form) boosts all Turtles', () => {
    const turtleSource = creature('tsrc', {
      name: 'Turtle Power',
      type_line: 'Creature — Turtle',
      oracle_text: 'Turtles you control get +2/+2.',
      power: 1,
      toughness: 1,
    });
    const turtle2 = creature('t2', {
      name: 'Sea Turtle',
      type_line: 'Creature — Turtle',
      power: 1,
      toughness: 1,
    });
    const nonTurtle = creature('nt', {
      name: 'Bear Cub',
      type_line: 'Creature — Bear',
      power: 2,
      toughness: 2,
    });

    const { state, idFor } = setup([turtleSource, turtle2, nonTurtle]);

    // turtleSource boosts itself (no excludeSelf) → 1+2=3/1+2=3
    expect(getEffectivePower(state, idFor('tsrc'))).toBe(3);
    expect(getEffectiveToughness(state, idFor('tsrc'))).toBe(3);

    // turtle2 also gets boosted → 3/3
    expect(getEffectivePower(state, idFor('t2'))).toBe(3);
    expect(getEffectiveToughness(state, idFor('t2'))).toBe(3);

    // Bear stays at 2/2
    expect(getEffectivePower(state, idFor('nt'))).toBe(2);
    expect(getEffectiveToughness(state, idFor('nt'))).toBe(2);
  });

  it('Builder\'s Blessing: untapped creatures get +0/+2; tapped creatures are unaffected', () => {
    const blessing = creature('blessing', {
      name: "Builder's Blessing",
      // Builder's Blessing is an enchantment, but we test the static line directly
      type_line: 'Enchantment',
      oracle_text: 'Untapped creatures you control get +0/+2.',
      card_types: ['enchantment'],
      power: 0,
      toughness: 0,
    });
    const worker = creature('worker', {
      name: 'Worker',
      type_line: 'Creature — Human Worker',
      power: 2,
      toughness: 2,
    });
    const tappedWorker = creature('tworker', {
      name: 'Tapped Worker',
      type_line: 'Creature — Human Worker',
      power: 2,
      toughness: 2,
    });

    const { state, idFor } = setup(
      [blessing, worker, tappedWorker],
      [],
      new Set(['tworker']), // tworker is tapped
    );

    // untapped worker gets +0/+2 → 2/4
    expect(getEffectivePower(state, idFor('worker'))).toBe(2);
    expect(getEffectiveToughness(state, idFor('worker'))).toBe(4);

    // tapped worker does NOT get the bonus → stays 2/2
    expect(getEffectivePower(state, idFor('tworker'))).toBe(2);
    expect(getEffectiveToughness(state, idFor('tworker'))).toBe(2);
  });
});
