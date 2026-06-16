import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { matchWardPayLife } from '../effects/matchers/static-abilities';
import { parseWardCost, applyWardForStackItem } from '../ward';
import { initGameState, getCardsInZone } from '../game-state';
import { castSpell } from '../stack';
import type { CardDefinition, StackItem } from '../types';
import { emptyManaPool } from '../types';

/**
 * Slice 12: Ward—Pay N life absorption.
 *
 * The "Ward—Pay N life." form was not being absorbed by the parser even though
 * absorbableKeywordLineParts contained the correct regex. The fix adds a dedicated
 * matchWardPayLife matcher (analogous to matchLandwalk / matchOtherEvasion) that
 * recognises keyword-only faces containing a ward-pay-life line alongside other
 * engine-enforced keywords, returning a StaticAbility recognition marker.
 *
 * Runtime enforcement is verified: ward.ts parseWardCost reads the "ward—pay N life"
 * form and returns { kind: 'life', amount: N }; applyWardForStackItem deducts life
 * from the targeting player or counters the spell/ability.
 *
 * Real oracle wordings from the example cards listed in the slice spec.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCreature(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id: overrides.id || 'test-creature',
    name: overrides.name || 'Test Creature',
    type_line: 'Creature — Bird',
    oracle_text: overrides.oracle_text || '',
    mana_cost: overrides.mana_cost || '{2}{U}',
    cmc: overrides.cmc ?? 3,
    colors: ['U'],
    color_identity: ['U'],
    keywords: overrides.keywords || [],
    card_types: ['creature'],
    power: overrides.power ?? 2,
    toughness: overrides.toughness ?? 2,
    ...overrides,
  };
}

function makeDestroyCreatureSpell(): CardDefinition {
  return {
    id: 'kill-spell',
    name: 'Kill Spell',
    type_line: 'Instant',
    oracle_text: 'Destroy target creature.',
    mana_cost: '{B}',
    cmc: 1,
    colors: ['B'],
    color_identity: ['B'],
    keywords: [],
    card_types: ['instant'],
  };
}

// ---------------------------------------------------------------------------
// RECOGNITION: parser recognises ward-pay-life faces
// ---------------------------------------------------------------------------

describe('Slice 12: Ward—Pay N life — parser recognition', () => {
  it('Owlin Shieldmage: "Flying\\nWard—Pay 3 life." — keyword-only face parses as StaticAbility', () => {
    // Real oracle text from Owlin Shieldmage (with reminder text)
    const r = parseOracleText(
      'Flying\nWard—Pay 3 life. (Whenever this creature becomes the target of a spell or ability an opponent controls, counter it unless that player pays 3 life.)',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const kw = r.ability.modifier;
    expect(kw.kind).toBe('GrantKeyword');
    if (kw.kind !== 'GrantKeyword') return;
    expect(kw.keyword).toBe('WardPayLife');
    // selfOnly is the recognition-marker pattern
    expect(r.ability.selfOnly).toBe(true);
  });

  it('Dwarven Forge-Chanter: "Ward—Pay 2 life.\\nProwess" — ward-pay-life + prowess keyword parses', () => {
    // Real oracle text from Dwarven Forge-Chanter (with reminder text)
    const r = parseOracleText(
      'Ward—Pay 2 life. (Whenever this creature becomes the target of a spell or ability an opponent controls, counter it unless that player pays 2 life.)\nProwess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const kw = r.ability.modifier;
    expect(kw.kind).toBe('GrantKeyword');
    if (kw.kind !== 'GrantKeyword') return;
    expect(kw.keyword).toBe('WardPayLife');
  });

  it('Sire of Seven Deaths: all keyword lines including Ward—Pay 7 life parses', () => {
    // Real oracle text from Sire of Seven Deaths — all lines are keywords
    const r = parseOracleText(
      'First strike, vigilance\nMenace, trample\nReach, lifelink\nWard—Pay 7 life.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const kw = r.ability.modifier;
    expect(kw.kind).toBe('GrantKeyword');
    if (kw.kind !== 'GrantKeyword') return;
    expect(kw.keyword).toBe('WardPayLife');
  });

  it('bare "Ward—Pay 3 life." with no other keywords parses as StaticAbility', () => {
    const r = parseOracleText('Ward—Pay 3 life.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const kw = r.ability.modifier;
    expect(kw.kind).toBe('GrantKeyword');
    if (kw.kind !== 'GrantKeyword') return;
    expect(kw.keyword).toBe('WardPayLife');
  });

  it('mixed face: "Ward—Pay 2 life.\\nWhen this creature enters, you gain 2 life." parses the ETB', () => {
    // Mixed face — ward line is stripped by trimLeadingKeywordOrEnchantPreamble
    // in the token path; the ETB trigger is found and parsed.
    const r = parseOracleText(
      'Ward—Pay 2 life.\nWhen this creature enters, you gain 2 life.',
    );
    expect(r.kind).toBe('ETB');
  });

  it('matchWardPayLife directly matches the Owlin Shieldmage oracle text', () => {
    const result = matchWardPayLife(
      'Flying\nWard—Pay 3 life. (Whenever this creature becomes the target of a spell or ability an opponent controls, counter it unless that player pays 3 life.)',
    );
    expect(result).not.toBeNull();
    expect(result?.modifier.kind).toBe('GrantKeyword');
    if (result?.modifier.kind === 'GrantKeyword') {
      expect(result.modifier.keyword).toBe('WardPayLife');
    }
  });

  it('matchWardPayLife rejects text with a non-keyword real ability', () => {
    // The second line is a real non-keyword ability the engine would not run
    const result = matchWardPayLife(
      'Ward—Pay 2 life.\nOther creatures you control enter with an additional +1/+1 counter on them for each opponent who lost life this turn.',
    );
    // This has a real unrun ability → should return null (don't mask it)
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RUNTIME: parseWardCost and applyWardForStackItem enforce life-cost ward
// ---------------------------------------------------------------------------

describe('Slice 12: Ward—Pay N life — runtime enforcement', () => {
  it('parseWardCost reads the ward—pay-N-life form correctly', () => {
    const def = makeCreature({ oracle_text: 'Ward—Pay 3 life.' });
    const cost = parseWardCost(def);
    expect(cost).not.toBeNull();
    expect(cost?.kind).toBe('life');
    if (cost?.kind === 'life') {
      expect(cost.amount).toBe(3);
    }
  });

  it('parseWardCost reads the form with reminder text (Owlin Shieldmage)', () => {
    const def = makeCreature({
      oracle_text:
        'Flying\nWard—Pay 3 life. (Whenever this creature becomes the target of a spell or ability an opponent controls, counter it unless that player pays 3 life.)',
    });
    const cost = parseWardCost(def);
    expect(cost).not.toBeNull();
    expect(cost?.kind).toBe('life');
    if (cost?.kind === 'life') {
      expect(cost.amount).toBe(3);
    }
  });

  it('ward—pay life counters the spell when the targeting player has insufficient life', () => {
    const killSpell = makeDestroyCreatureSpell();
    const wardCreature = makeCreature({
      id: 'owlin-ward',
      name: 'Owlin Shieldmage',
      oracle_text:
        'Flying\nWard—Pay 3 life. (Whenever this creature becomes the target of a spell or ability an opponent controls, counter it unless that player pays 3 life.)',
      keywords: ['Ward'],
    });
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [killSpell], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [wardCreature], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const spell = getCardsInZone(state, 'p1', 'library')[0];
    const target = getCardsInZone(state, 'p2', 'library')[0];
    state.cards.set(spell.instanceId, { ...spell, zone: 'hand' });
    state.cards.set(target.instanceId, { ...target, zone: 'battlefield' });
    // Caster has only 1 life — cannot pay the 3-life ward cost
    state = {
      ...state,
      phase: 'precombat_main' as any,
      players: state.players.map((p, i) => i === 0 ? { ...p, life: 1, manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 0 } } : p),
    };

    const next = castSpell(state, 'p1', spell.instanceId, [target.instanceId]);
    // Spell countered by ward (can't pay 3 life with only 1 life)
    expect(next.stack).toHaveLength(0);
    expect(next.cards.get(spell.instanceId)?.zone).toBe('graveyard');
    // Target remains on battlefield
    expect(next.cards.get(target.instanceId)?.zone).toBe('battlefield');
    // Caster's life is unchanged (ward countered, no payment taken)
    expect(next.players[0].life).toBe(1);
  });

  it('ward—pay life deducts life from the targeting player when they have enough', () => {
    const killSpell = makeDestroyCreatureSpell();
    const wardCreature = makeCreature({
      id: 'sire-ward',
      name: 'Sire of Seven Deaths',
      oracle_text: 'First strike, vigilance\nMenace, trample\nReach, lifelink\nWard—Pay 7 life.',
      keywords: ['Ward'],
    });
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [killSpell], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [wardCreature], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const spell = getCardsInZone(state, 'p1', 'library')[0];
    const target = getCardsInZone(state, 'p2', 'library')[0];
    state.cards.set(spell.instanceId, { ...spell, zone: 'hand' });
    state.cards.set(target.instanceId, { ...target, zone: 'battlefield' });
    // Caster has 40 life — can pay the 7-life ward cost
    state = {
      ...state,
      phase: 'precombat_main' as any,
      players: state.players.map((p, i) => i === 0 ? { ...p, life: 40, manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 0 } } : p),
    };

    const next = castSpell(state, 'p1', spell.instanceId, [target.instanceId]);
    // Spell is on the stack (ward paid successfully)
    expect(next.stack).toHaveLength(1);
    // Life deducted by the ward cost (40 - 7 = 33)
    expect(next.players[0].life).toBe(33);
  });

  it('ward—pay life counters when player explicitly declines to pay', () => {
    const killSpell = makeDestroyCreatureSpell();
    const wardCreature = makeCreature({
      id: 'dwarven-forge-chanter',
      name: 'Dwarven Forge-Chanter',
      oracle_text:
        'Ward—Pay 2 life. (Whenever this creature becomes the target of a spell or ability an opponent controls, counter it unless that player pays 2 life.)\nProwess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)',
      keywords: ['Ward'],
    });
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [killSpell], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [wardCreature], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const spell = getCardsInZone(state, 'p1', 'library')[0];
    const target = getCardsInZone(state, 'p2', 'library')[0];
    state.cards.set(spell.instanceId, { ...spell, zone: 'hand' });
    state.cards.set(target.instanceId, { ...target, zone: 'battlefield' });
    state = {
      ...state,
      phase: 'precombat_main' as any,
      players: state.players.map((p, i) => i === 0 ? { ...p, life: 40, manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 0 } } : p),
    };

    const next = castSpell(state, 'p1', spell.instanceId, [target.instanceId], {
      namedCardChoices: { [`ward:${target.instanceId}`]: 'decline' },
    });
    // Declined payment → spell countered
    expect(next.stack).toHaveLength(0);
    expect(next.cards.get(spell.instanceId)?.zone).toBe('graveyard');
    // Life unchanged (declined, not deducted)
    expect(next.players[0].life).toBe(40);
  });
});
