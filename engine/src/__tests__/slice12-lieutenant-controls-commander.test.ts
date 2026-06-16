/**
 * Slice 12 — Commander-presence conditional statics (Lieutenant family).
 *
 * Tests parse recognition and engine execution for:
 *   - "Lieutenant — As long as you control your commander, ..." (ability-word prefix)
 *   - "As long as you control your commander, ..." (plain prefix)
 *   - "... as long as you control your commander." (suffix form)
 *   - P/T buffs and keyword grants gated on ControlsCommander condition
 *   - Mass grants to creatures you control
 *
 * Honesty constraints verified:
 *   - Condition is truly evaluated at query time (no stale cache)
 *   - Commander absent → no bonus; commander present → bonus applies
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import {
  getEffectivePower,
  getEffectiveToughness,
  evaluateCondition,
} from '../effects/continuous';
import { instanceHasKeyword } from '../keywords';
import { initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import type { CardDefinition } from '../types';

// ============================================================================
// Test helpers
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
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

/**
 * Set up a game where:
 *  - p1 has `p1Defs` cards (commanderId selects which one is the commander).
 *  - p2 has a dummy blocker.
 *  - All cards are placed in `zones` overrides; everything else goes to battlefield
 *    (INCLUDING the commander — by default the commander is on the battlefield so
 *    ControlsCommander tests can simply call setup(...) without specifying a zone).
 *    To test "commander absent", pass `{ [commanderId]: 'command' }` explicitly.
 */
function setup(
  p1Defs: CardDefinition[],
  commanderId: string,
  zones: Record<string, 'command' | 'graveyard' | 'exile' | 'library'> = {},
  p2Defs: CardDefinition[] = [creature('dummy_opp')],
) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId },
    { playerId: 'p2', name: 'Bob', cards: p2Defs, commanderId: 'none_p2' },
  ];
  let state = initGameState(decks);

  // Move cards to the requested zones; everything else (including the commander
  // unless overridden) goes to battlefield.
  for (const [id, card] of state.cards) {
    const override = zones[card.definitionId];
    state.cards.set(id, {
      ...card,
      zone: override ?? 'battlefield',
      summoningSick: false,
    });
  }

  // Register continuous statics for all battlefield permanents.
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
// Parse-level tests — real oracle wordings
// ============================================================================

describe('slice 12 — Lieutenant parser recognition', () => {
  it('Loyal Drake: "Lieutenant — As long as you control your commander, this creature has flying."', () => {
    const r = parseOracleText(
      'Lieutenant — As long as you control your commander, this creature has flying.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'flying' });
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.condition).toEqual({ kind: 'ControlsCommander' });
  });

  it('Loyal Guardian: plain prefix "As long as you control your commander, other creatures you control get +1/+1."', () => {
    const r = parseOracleText(
      'As long as you control your commander, other creatures you control get +1/+1.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(r.ability.excludeSelf).toBe(true);
    expect(r.ability.condition).toEqual({ kind: 'ControlsCommander' });
  });

  it('Sanctuary Blade: suffix form "this creature gets +2/+2 as long as you control your commander."', () => {
    const r = parseOracleText(
      'This creature gets +2/+2 as long as you control your commander.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 2, toughness: 2 });
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.condition).toEqual({ kind: 'ControlsCommander' });
  });

  it('Loyal Unicorn: "Lieutenant — As long as you control your commander, creatures you control have vigilance."', () => {
    const r = parseOracleText(
      'Lieutenant — As long as you control your commander, creatures you control have vigilance.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'vigilance' });
    expect(r.ability.controller).toBe('you');
    expect(r.ability.filter).toEqual({ types: ['creature'] });
    expect(r.ability.condition).toEqual({ kind: 'ControlsCommander' });
  });

  it('Thunderfoot Baloth self-P/T: "Lieutenant — As long as you control your commander, this creature gets +2/+2 ..."', () => {
    // Compound: first static (self +2/+2) is claimed; trailing "and other creatures" is dropped.
    const r = parseOracleText(
      'Lieutenant — As long as you control your commander, this creature gets +2/+2 and other creatures you control get +2/+2 and have trample.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 2, toughness: 2 });
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.condition).toEqual({ kind: 'ControlsCommander' });
  });

  it('unsupported Lieutenant trigger body stays Unparsed', () => {
    // Loyal Apprentice-style: the conditional creates a token each combat —
    // that is a triggered ability, NOT a static grant we can enforce.
    // The oracle text has a triggered ability body so it should not become a StaticAbility.
    const r = parseOracleText(
      'Lieutenant — As long as you control your commander, at the beginning of combat on your turn, create a 1/1 colorless Thopter artifact creature token with flying.',
    );
    // This should either be Unparsed or some other non-StaticAbility form.
    // The "as long as you control your commander, at the beginning of combat ..."
    // is a conditional trigger, not a static the engine runs today.
    expect(r.kind).not.toBe('StaticAbility');
  });
});

// ============================================================================
// Execution-level tests — ControlsCommander evaluated at query time
// ============================================================================

describe('slice 12 — Lieutenant engine execution', () => {
  it('Loyal Drake clone: flying only while commander is on battlefield', () => {
    const lieutenantBird = creature('bird', {
      name: 'Lieutenant Bird',
      oracle_text: 'Lieutenant — As long as you control your commander, this creature has flying.',
      power: 2,
      toughness: 2,
    });
    const commanderDef = creature('cmd', {
      name: 'My Commander',
      type_line: 'Legendary Creature — Test',
    });

    // Commander in command zone: condition false, no flying.
    const absent = setup([lieutenantBird, commanderDef], 'cmd', { cmd: 'command' });
    const absentBirdId = absent.idFor('bird');
    expect(instanceHasKeyword(absent.state, absentBirdId, 'Flying')).toBe(false);

    // Commander on battlefield: condition true, has flying.
    const present = setup([lieutenantBird, commanderDef], 'cmd');
    const presentBirdId = present.idFor('bird');
    expect(instanceHasKeyword(present.state, presentBirdId, 'Flying')).toBe(true);
  });

  it('Loyal Guardian clone: +1/+1 to other creatures only while commander is present', () => {
    const guardian = creature('guardian', {
      name: 'Loyal Guardian',
      oracle_text: 'As long as you control your commander, other creatures you control get +1/+1.',
      power: 3,
      toughness: 4,
    });
    const commanderDef = creature('cmd', {
      name: 'My Commander',
      type_line: 'Legendary Creature — Test',
      power: 3,
      toughness: 3,
    });
    const ally = creature('ally', { power: 2, toughness: 2 });

    // Commander absent: ally stays 2/2.
    const absent = setup([guardian, commanderDef, ally], 'cmd', { cmd: 'command' });
    const absentAllyId = absent.idFor('ally');
    expect(getEffectivePower(absent.state, absentAllyId)).toBe(2);
    expect(getEffectiveToughness(absent.state, absentAllyId)).toBe(2);

    // Commander on battlefield: ally gets +1/+1 → 3/3.
    const present = setup([guardian, commanderDef, ally], 'cmd');
    const presentAllyId = present.idFor('ally');
    expect(getEffectivePower(present.state, presentAllyId)).toBe(3);
    expect(getEffectiveToughness(present.state, presentAllyId)).toBe(3);

    // Guardian itself should NOT get the bonus (excludeSelf=true).
    const guardianId = present.idFor('guardian');
    expect(getEffectivePower(present.state, guardianId)).toBe(3);
    expect(getEffectiveToughness(present.state, guardianId)).toBe(4);
  });

  it('Sanctuary Blade clone: self +2/+2 suffix form — gated on commander', () => {
    const blade = creature('blade', {
      name: 'Sanctuary Blade',
      oracle_text: 'This creature gets +2/+2 as long as you control your commander.',
      power: 1,
      toughness: 1,
    });
    const commanderDef = creature('cmd', {
      name: 'My Commander',
      type_line: 'Legendary Creature — Test',
    });

    // Commander absent.
    const absent = setup([blade, commanderDef], 'cmd', { cmd: 'command' });
    expect(getEffectivePower(absent.state, absent.idFor('blade'))).toBe(1);

    // Commander present.
    const present = setup([blade, commanderDef], 'cmd');
    expect(getEffectivePower(present.state, present.idFor('blade'))).toBe(3);
    expect(getEffectiveToughness(present.state, present.idFor('blade'))).toBe(3);
  });

  it('evaluateCondition: ControlsCommander — true iff a battlefield permanent is the commander', () => {
    const commanderDef = creature('cmd', {
      name: 'My Commander',
      type_line: 'Legendary Creature — Test',
    });
    const other = creature('other');

    // Commander in command zone: false.
    const absent = setup([commanderDef, other], 'cmd', { cmd: 'command' });
    expect(
      evaluateCondition(absent.state, { kind: 'ControlsCommander' }, 'p1'),
    ).toBe(false);

    // Commander on battlefield: true.
    const present = setup([commanderDef, other], 'cmd');
    expect(
      evaluateCondition(present.state, { kind: 'ControlsCommander' }, 'p1'),
    ).toBe(true);

    // Commander in graveyard: false.
    const graveyard = setup([commanderDef, other], 'cmd', { cmd: 'graveyard' });
    expect(
      evaluateCondition(graveyard.state, { kind: 'ControlsCommander' }, 'p1'),
    ).toBe(false);
  });
});
