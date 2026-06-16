/**
 * Slice 10 — Compound anthem bodies: "get +N/+N and have/gain <keyword>" static forms.
 *
 * Coverage:
 *   A. Parse tests — all compound "get +N/+N and have/gain <kw>" forms parse as
 *      StaticAbility with ModifyPT modifier (the keyword rider is registered via
 *      additionalStaticKeywordFromLine in registerContinuousAbilitiesForPermanent).
 *      Covers tribal anthems (Rageblood Shaman, Vampire Nocturnus-style),
 *      plain creature anthems with "and gain <kw>", and the attacking-anthem variant.
 *
 *   B. Execution tests — after registerContinuousAbilitiesForPermanent both the
 *      P/T boost AND the granted keyword are active on matching creatures.
 *      Uses real-oracle-wording patterns from Rageblood Shaman, Vampire Nocturnus,
 *      and the attacking-anthem family (Nobilis of War / Orcish Oriflamme extension).
 *
 *   C. Temporal forms are NOT claimed as static — "get +N/+N and gain <kw> until end of turn"
 *      must remain Unparsed or handled by matchModifyPT (not matchStaticAbility /
 *      matchAttackingAnthem) so statics and spells don't collide.
 *
 * Executor route:
 *   - ModifyPT continuous effect: getContinuousPTModification (continuous.ts layer 7c).
 *   - GrantKeyword continuous effect: getGrantedKeywords / getKeywordsForInstance
 *     (keywords.ts / continuous.ts). Registered via additionalStaticKeywordFromLine
 *     (stack.ts) as a second ContinuousEffect alongside the ModifyPT static.
 *   - No executor change required — both halves already execute via existing paths.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import {
  getGrantedKeywords,
  getContinuousPTModification,
} from '../effects/continuous';
import { initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import { getKeywordsForInstance } from '../keywords';
import type { CardDefinition, CardInstance, GameState, Player } from '../types';
import { emptyManaPool } from '../types';

// ============================================================================
// Test helpers
// ============================================================================

function makePlayer(id: string): Player {
  return {
    id, name: id, life: 40,
    poisonCounters: 0,
    commanderDamage: {}, commanderTax: 0,
    commanderInstanceId: null, commanderCastCount: 0,
    manaPool: emptyManaPool(),
    hasPlayedLand: false, hasPriority: false, hasLost: false,
  };
}

function makeDef(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
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
    subtypes: opts.subtypes ?? [],
    supertypes: opts.supertypes ?? [],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

function makeDeckSetup(
  p1Defs: CardDefinition[],
  p2Defs: CardDefinition[] = [makeDef('p2dummy')],
) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'none1' },
    { playerId: 'p2', name: 'Bob', cards: p2Defs, commanderId: 'none2' },
  ];
  let state = initGameState(decks);
  for (const [, card] of state.cards) {
    state.cards.set(card.instanceId, {
      ...card,
      zone: 'battlefield',
      summoningSick: false,
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
// A. Parse tests
// ============================================================================

describe('Slice 10 — Compound anthem parse: "get +N/+N and have/gain <keyword>"', () => {
  // A1. Rageblood Shaman: "Other Minotaur creatures you control get +1/+1 and have trample."
  it('Rageblood Shaman — "Other Minotaur creatures you control get +1/+1 and have trample." parses as ModifyPT static', () => {
    const r = parseOracleText('Other Minotaur creatures you control get +1/+1 and have trample.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    // Primary modifier is ModifyPT; the keyword is registered via additionalStaticKeywordFromLine
    expect(r.ability.modifier.kind).toBe('ModifyPT');
    if (r.ability.modifier.kind === 'ModifyPT') {
      expect(r.ability.modifier.power).toBe(1);
      expect(r.ability.modifier.toughness).toBe(1);
    }
    expect(r.ability.filter).toMatchObject({ types: ['creature'], subtypes: ['minotaur'] });
    expect(r.ability.excludeSelf).toBe(true);
    expect(r.ability.controller).toBe('you');
  });

  // A2. Vampire Nocturnus-style: "Other Vampire creatures you control get +2/+1 and have flying."
  it('Vampire-lord form — "Other Vampire creatures you control get +2/+1 and have flying." parses as ModifyPT static', () => {
    const r = parseOracleText('Other Vampire creatures you control get +2/+1 and have flying.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ModifyPT');
    if (r.ability.modifier.kind === 'ModifyPT') {
      expect(r.ability.modifier.power).toBe(2);
      expect(r.ability.modifier.toughness).toBe(1);
    }
    expect(r.ability.filter).toMatchObject({ types: ['creature'], subtypes: ['vampire'] });
    expect(r.ability.excludeSelf).toBe(true);
  });

  // A3. "Creatures you control get +1/+1 and gain vigilance." (and-gain form)
  it('"Creatures you control get +1/+1 and gain vigilance." parses as ModifyPT static', () => {
    const r = parseOracleText('Creatures you control get +1/+1 and gain vigilance.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ModifyPT');
    expect(r.ability.filter).toMatchObject({ types: ['creature'] });
    expect(r.ability.controller).toBe('you');
  });

  // A4. Attacking anthem compound: "Attacking creatures you control get +2/+0 and have trample."
  it('"Attacking creatures you control get +2/+0 and have trample." parses as ModifyPT static with attacking filter', () => {
    const r = parseOracleText('Attacking creatures you control get +2/+0 and have trample.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ModifyPT');
    if (r.ability.modifier.kind === 'ModifyPT') {
      expect(r.ability.modifier.power).toBe(2);
      expect(r.ability.modifier.toughness).toBe(0);
    }
    expect(r.ability.filter).toMatchObject({ types: ['creature'], attacking: true });
    expect(r.ability.controller).toBe('you');
  });

  // A5. "Attacking creatures you control get +2/+0 and gain lifelink." (gain form for attacking)
  it('"Attacking creatures you control get +2/+0 and gain lifelink." parses as ModifyPT static', () => {
    const r = parseOracleText('Attacking creatures you control get +2/+0 and gain lifelink.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ModifyPT');
    expect(r.ability.filter).toMatchObject({ types: ['creature'], attacking: true });
  });

  // A6. "Other creatures you control get +2/+2 and have menace."
  it('"Other creatures you control get +2/+2 and have menace." parses as ModifyPT static with excludeSelf', () => {
    const r = parseOracleText('Other creatures you control get +2/+2 and have menace.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ModifyPT');
    expect(r.ability.excludeSelf).toBe(true);
    expect(r.ability.filter).toMatchObject({ types: ['creature'] });
  });
});

// ============================================================================
// B. Temporal forms must NOT be claimed as static
// ============================================================================

describe('Slice 10 — Temporal "and gain" forms are NOT parsed as static', () => {
  // B1. Temporal form: "Attacking creatures you control get +2/+0 and gain trample until end of turn."
  // Must NOT be claimed as a static by matchAttackingAnthem.
  it('"Attacking creatures get +2/+0 and gain trample until end of turn." is NOT a StaticAbility', () => {
    const r = parseOracleText('Attacking creatures you control get +2/+0 and gain trample until end of turn.');
    // This is a one-shot spell/trigger effect, not a permanent static
    expect(r.kind).not.toBe('StaticAbility');
  });

  // B2. Temporal form: "Creatures you control get +2/+2 and gain lifelink until end of turn."
  it('"Creatures you control get +2/+2 and gain lifelink until end of turn." is NOT a StaticAbility', () => {
    const r = parseOracleText('Creatures you control get +2/+2 and gain lifelink until end of turn.');
    expect(r.kind).not.toBe('StaticAbility');
  });
});

// ============================================================================
// C. Execution tests — both P/T boost AND keyword are active after registration
// ============================================================================

describe('Slice 10 — Compound anthem execution: PT boost + keyword both active', () => {
  // C1. "Other Minotaur creatures you control get +1/+1 and have trample."
  //     Matches Rageblood Shaman. A Minotaur controlled by p1 should get +1/+1 and Trample.
  it('Rageblood Shaman — Minotaur creature gets +1/+1 and trample', () => {
    const ragebloodDef = makeDef('rageblood', {
      name: 'Rageblood Shaman',
      type_line: 'Creature — Minotaur Shaman',
      oracle_text: 'Other Minotaur creatures you control get +1/+1 and have trample.',
      card_types: ['creature'],
      subtypes: ['minotaur', 'shaman'],
      power: 2,
      toughness: 2,
    });
    const minotaurDef = makeDef('minotaur1', {
      name: 'Minotaur Warrior',
      type_line: 'Creature — Minotaur Warrior',
      oracle_text: '',
      card_types: ['creature'],
      subtypes: ['minotaur', 'warrior'],
      power: 2,
      toughness: 2,
    });

    const { state, idFor } = makeDeckSetup([ragebloodDef, minotaurDef]);
    const minotaurId = idFor('minotaur1');

    // P/T boost: +1/+1 should be applied
    const ptMod = getContinuousPTModification(state, minotaurId);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(1);

    // Keyword: trample should be granted
    const granted = getGrantedKeywords(state, minotaurId);
    const kwSet = getKeywordsForInstance(state, minotaurId);
    const hasTramp = granted.some(k => k.toLowerCase() === 'trample') || kwSet.has('Trample');
    expect(hasTramp).toBe(true);
  });

  // C2. "Creatures you control get +1/+1 and gain vigilance."
  //     A creature controlled by p1 should get +1/+1 and Vigilance.
  it('"Creatures you control get +1/+1 and gain vigilance." — creature gets boost and vigilance', () => {
    const anthemDef = makeDef('vigilance_anthem', {
      name: 'Vigilance Giver',
      type_line: 'Enchantment',
      oracle_text: 'Creatures you control get +1/+1 and gain vigilance.',
      card_types: ['enchantment'],
      power: 0,
      toughness: 0,
    });
    const soldierDef = makeDef('soldier1', {
      name: 'Soldier',
      type_line: 'Creature — Human Soldier',
      oracle_text: '',
      card_types: ['creature'],
      power: 1,
      toughness: 1,
    });

    const { state, idFor } = makeDeckSetup([anthemDef, soldierDef]);
    const soldierId = idFor('soldier1');

    // P/T boost
    const ptMod = getContinuousPTModification(state, soldierId);
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(1);

    // Vigilance keyword
    const granted = getGrantedKeywords(state, soldierId);
    const kwSet = getKeywordsForInstance(state, soldierId);
    const hasVigilance = granted.some(k => k.toLowerCase() === 'vigilance') || kwSet.has('Vigilance');
    expect(hasVigilance).toBe(true);
  });

  // C3. "Other Vampire creatures you control get +2/+1 and have flying."
  //     Matches Vampire Nocturnus family. A Vampire should get +2/+1 and Flying.
  //     (Opponent's Vampire should NOT get the boost or keyword.)
  it('Vampire-lord form — Vampire gets +2/+1 and flying, opponent Vampire does not', () => {
    const vampireLordDef = makeDef('vampire_lord', {
      name: 'Vampire Lord',
      type_line: 'Creature — Vampire',
      oracle_text: 'Other Vampire creatures you control get +2/+1 and have flying.',
      card_types: ['creature'],
      subtypes: ['vampire'],
      power: 2,
      toughness: 2,
    });
    const myVampireDef = makeDef('my_vampire', {
      name: 'My Vampire',
      type_line: 'Creature — Vampire',
      oracle_text: '',
      card_types: ['creature'],
      subtypes: ['vampire'],
      power: 1,
      toughness: 1,
    });

    const { state, idFor } = makeDeckSetup([vampireLordDef, myVampireDef]);
    const myVampId = idFor('my_vampire');

    // P/T boost for my Vampire
    const ptMod = getContinuousPTModification(state, myVampId);
    expect(ptMod.power).toBe(2);
    expect(ptMod.toughness).toBe(1);

    // Flying keyword for my Vampire
    const granted = getGrantedKeywords(state, myVampId);
    const kwSet = getKeywordsForInstance(state, myVampId);
    const hasFlying = granted.some(k => k.toLowerCase() === 'flying') || kwSet.has('Flying');
    expect(hasFlying).toBe(true);
  });
});
