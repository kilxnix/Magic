/**
 * Slice 3 — Mass temporary pump/grant on attacking or blocking creatures
 * (one-shot SPELL form, "until end of turn").
 *
 * Cards covered by matchAttackingBlockingPump:
 *   - Army of Allah: "Attacking creatures get +2/+0 until end of turn."
 *   - Piety: "Blocking creatures get +0/+3 until end of turn."
 *   - Vampiric Fury: "Vampire creatures you control get +2/+0 and gain first strike until end of turn."
 *
 * Parser tests verify the correct AST shape is emitted.
 * Execution tests verify the executor applies the pump only to the correct
 * creatures (attackers/blockers only, or the right subtype) and NOT to others.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import { initGameState } from '../game-state';
import { declareAttackers, declareBlockers } from '../combat';
import type { CardDefinition, GameState } from '../types';
import type { Effect, ModifyPTEffect, GrantKeywordEffect } from '../effects/ast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function creatureDef(
  id: string,
  opts: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Creature — Test',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{2}',
    cmc: opts.cmc ?? 2,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

/**
 * Build a two-player game state. p1 controls p1Defs, p2 controls p2Defs.
 * All cards start on the battlefield with no summoning sickness.
 * Returns state + idFor helper.
 */
function setup(
  p1Defs: CardDefinition[],
  p2Defs: CardDefinition[] = [],
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
  state = { ...state, phase: 'combat', step: 'declare_attackers' };
  const idFor = (defId: string, owner = 'p1') =>
    [...state.cards.values()].find(c => c.definitionId === defId && c.ownerId === owner)!.instanceId;
  return { state, idFor };
}

function spellEffects(text: string): Effect[] {
  const parsed = parseOracleText(text);
  if (parsed.kind !== 'Spell') {
    throw new Error(`Expected Spell, got ${parsed.kind} for: ${text}`);
  }
  return parsed.effects;
}

// ---------------------------------------------------------------------------
// Parser tests
// ---------------------------------------------------------------------------

describe('matchAttackingBlockingPump — parser', () => {
  it('Army of Allah: "Attacking creatures get +2/+0 until end of turn."', () => {
    const es = spellEffects('Attacking creatures get +2/+0 until end of turn.');
    expect(es).toHaveLength(1);
    const e = es[0] as ModifyPTEffect;
    expect(e.kind).toBe('ModifyPT');
    expect(e.power).toBe(2);
    expect(e.toughness || 0).toBe(0);
    expect(e.untilEndOfTurn).toBe(true);
    expect(e.target).toMatchObject({
      kind: 'AllOfType',
      filter: { types: ['creature'], attacking: true },
    });
    // No controllerControls since "you control" absent
    expect((e.target as { controllerControls?: boolean }).controllerControls).toBeUndefined();
  });

  it('Piety: "Blocking creatures get +0/+3 until end of turn."', () => {
    const es = spellEffects('Blocking creatures get +0/+3 until end of turn.');
    expect(es).toHaveLength(1);
    const e = es[0] as ModifyPTEffect;
    expect(e.kind).toBe('ModifyPT');
    expect(e.power || 0).toBe(0);
    expect(e.toughness).toBe(3);
    expect(e.untilEndOfTurn).toBe(true);
    expect(e.target).toMatchObject({
      kind: 'AllOfType',
      filter: { types: ['creature'], blocking: true },
    });
  });

  it('Vampiric Fury: "Vampire creatures you control get +2/+0 and gain first strike until end of turn."', () => {
    const es = spellEffects('Vampire creatures you control get +2/+0 and gain first strike until end of turn.');
    expect(es).toHaveLength(2);
    const pt = es[0] as ModifyPTEffect;
    expect(pt.kind).toBe('ModifyPT');
    expect(pt.power).toBe(2);
    expect(pt.toughness || 0).toBe(0);
    expect(pt.untilEndOfTurn).toBe(true);
    expect(pt.target).toMatchObject({
      kind: 'AllOfType',
      filter: { types: ['creature'], subtypes: ['vampire'] },
      controllerControls: true,
    });
    const kw = es[1] as GrantKeywordEffect;
    expect(kw.kind).toBe('GrantKeyword');
    expect(kw.keyword).toBe('First Strike');
    expect(kw.untilEndOfTurn).toBe(true);
    // Same target ref
    expect(kw.target).toEqual(pt.target);
  });

  it('"Attacking creatures you control get +1/+0 until end of turn." (controllerControls)', () => {
    const es = spellEffects('Attacking creatures you control get +1/+0 until end of turn.');
    expect(es).toHaveLength(1);
    const e = es[0] as ModifyPTEffect;
    expect(e.target).toMatchObject({
      kind: 'AllOfType',
      filter: { types: ['creature'], attacking: true },
      controllerControls: true,
    });
  });

  it('"Blocking creatures you control get +0/+2 and gain lifelink until end of turn."', () => {
    const es = spellEffects('Blocking creatures you control get +0/+2 and gain lifelink until end of turn.');
    expect(es).toHaveLength(2);
    expect(es[0].kind).toBe('ModifyPT');
    expect(es[1].kind).toBe('GrantKeyword');
    const kw = es[1] as GrantKeywordEffect;
    expect(kw.keyword).toBe('Lifelink');
    expect(es[0].target).toMatchObject({
      kind: 'AllOfType',
      filter: { types: ['creature'], blocking: true },
      controllerControls: true,
    });
  });

  it('does NOT parse the static form (no "until end of turn")', () => {
    // matchAttackingAnthem in static-abilities.ts should handle this as StaticAbility
    const r = parseOracleText('Attacking creatures you control get +1/+0.');
    expect(r.kind).toBe('StaticAbility');
  });

  it('NOW parses "attacking creatures you control get +2/+0 and gain shadow until end of turn" (shadow in GRANTABLE_KEYWORDS since Slice 6)', () => {
    // Shadow was added to GRANTABLE_KEYWORDS in Slice 6 (enforced via getEvasionKeywords).
    // matchAttackingBlockingPump can now parse this and produces AllOfType with filter.attacking.
    const r = parseOracleText('Attacking creatures you control get +2/+0 and gain shadow until end of turn.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    const kwEffect = r.effects.find(e => e.kind === 'GrantKeyword');
    expect(kwEffect).toBeDefined();
    if (kwEffect) {
      expect((kwEffect as any).keyword).toBe('Shadow');
      const tgt = (kwEffect as any).target;
      expect(tgt?.kind).toBe('AllOfType');
      expect(tgt?.filter?.attacking).toBe(true);
    }
  });

  it('multi-keyword: "and gain first strike, trample, and lifelink until end of turn"', () => {
    const es = spellEffects('Attacking creatures you control get +1/+1 and gain first strike, trample, and lifelink until end of turn.');
    const kwEffects = es.filter(e => e.kind === 'GrantKeyword') as GrantKeywordEffect[];
    expect(kwEffects).toHaveLength(3);
    const keywords = kwEffects.map(e => e.keyword);
    expect(keywords).toEqual(expect.arrayContaining(['First Strike', 'Trample', 'Lifelink']));
  });
});

// ---------------------------------------------------------------------------
// Executor tests
// ---------------------------------------------------------------------------

describe('matchAttackingBlockingPump — executor (Army of Allah)', () => {
  it('applies +2/+0 to attackers only, not non-attackers', () => {
    const soldier = creatureDef('soldier', { power: 2, toughness: 2 });
    const bystander = creatureDef('bystander', { power: 1, toughness: 1 });
    const { state: s0, idFor } = setup([soldier, bystander]);

    const soldierId = idFor('soldier');
    const bystanderId = idFor('bystander');

    // Declare soldier as attacker
    const s1 = declareAttackers(s0, 'p1', [
      { cardInstanceId: soldierId, defendingPlayerId: 'p2' },
    ]);

    // Execute "Attacking creatures get +2/+0 until end of turn."
    const parsed = parseOracleText('Attacking creatures get +2/+0 until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const s2 = executeEffects(s1, parsed.effects, 'p1', [], [], 0, {});

    // Soldier (attacker) gets +2/+0
    expect(getEffectivePower(s2, soldierId)).toBe(4);    // 2 + 2
    expect(getEffectiveToughness(s2, soldierId)).toBe(2); // unchanged

    // Bystander (not attacking) gets NO buff
    expect(getEffectivePower(s2, bystanderId)).toBe(1);
    expect(getEffectiveToughness(s2, bystanderId)).toBe(1);
  });
});

describe('matchAttackingBlockingPump — executor (Piety)', () => {
  it('applies +0/+3 to blockers only, not non-blockers', () => {
    const blocker = creatureDef('blocker', { power: 1, toughness: 2 });
    const watcher = creatureDef('watcher', { power: 2, toughness: 2 });
    const p2Attacker = creatureDef('p2attacker', { power: 2, toughness: 2 });
    const { state: s0, idFor } = setup([blocker, watcher], [p2Attacker]);

    const blockerId = idFor('blocker');
    const watcherId = idFor('watcher');
    const p2AttackerId = idFor('p2attacker', 'p2');

    // Switch active player to p2 so they can attack
    let s1: GameState = { ...s0, activePlayerIndex: 1, step: 'declare_attackers' };
    s1 = declareAttackers(s1, 'p2', [
      { cardInstanceId: p2AttackerId, defendingPlayerId: 'p1' },
    ]);
    s1 = { ...s1, step: 'declare_blockers' };

    // p1's blocker blocks p2's attacker
    const s2 = declareBlockers(s1, 'p1', [
      { cardInstanceId: blockerId, blockingAttackerId: p2AttackerId },
    ]);

    // Execute "Blocking creatures get +0/+3 until end of turn."
    const parsed = parseOracleText('Blocking creatures get +0/+3 until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const s3 = executeEffects(s2, parsed.effects, 'p1', [], [], 0, {});

    // Blocker gets +0/+3
    expect(getEffectivePower(s3, blockerId)).toBe(1);   // unchanged
    expect(getEffectiveToughness(s3, blockerId)).toBe(5); // 2 + 3

    // Watcher (not blocking) gets NO buff
    expect(getEffectivePower(s3, watcherId)).toBe(2);
    expect(getEffectiveToughness(s3, watcherId)).toBe(2);
  });
});

describe('matchAttackingBlockingPump — executor (Vampiric Fury subtype)', () => {
  it('applies +2/+0 and First Strike to Vampire creatures you control, not non-Vampires', () => {
    const vampire = creatureDef('vampire', {
      type_line: 'Creature — Vampire',
      power: 2,
      toughness: 2,
    });
    const zombie = creatureDef('zombie', {
      type_line: 'Creature — Zombie',
      power: 1,
      toughness: 1,
    });
    const { state: s0, idFor } = setup([vampire, zombie]);

    const vampireId = idFor('vampire');
    const zombieId = idFor('zombie');

    // Execute "Vampire creatures you control get +2/+0 and gain first strike until end of turn."
    const parsed = parseOracleText('Vampire creatures you control get +2/+0 and gain first strike until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const s1 = executeEffects(s0, parsed.effects, 'p1', [], [], 0, {});

    // Vampire gets +2/+0
    expect(getEffectivePower(s1, vampireId)).toBe(4);    // 2 + 2
    expect(getEffectiveToughness(s1, vampireId)).toBe(2); // unchanged

    // Zombie gets NO buff (not a Vampire)
    expect(getEffectivePower(s1, zombieId)).toBe(1);
    expect(getEffectiveToughness(s1, zombieId)).toBe(1);

    // Vampire should have First Strike keyword granted
    const vampireCard = s1.cards.get(vampireId)!;
    expect(vampireCard.grantedKeywords).toContain('First Strike');

    // Zombie should NOT have First Strike
    const zombieCard = s1.cards.get(zombieId)!;
    expect(zombieCard.grantedKeywords ?? []).not.toContain('First Strike');
  });
});
