/**
 * Slice 12/12: "as though it had flash" alternative-cast statics.
 *
 * Tests cover:
 *  1. Parser recognition (all three verified shapes).
 *  2. Engine enforcement: canCastSpell returns true at instant speed.
 *  3. Pay-more surcharge: effective cast cost increases outside sorcery window.
 *  4. Ferocious condition gate: only grants flash when creature w/ power ≥4 is present.
 *  5. Sorcery-speed baseline: casting at sorcery speed works without surcharge.
 *  6. Honesty: unrecognised narrative follow-ons decline cleanly.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { canCastSpell, getEffectiveCastCost } from '../stack';
import { initGameState, getCardsInZone } from '../game-state';
import type { CardDefinition } from '../types';
import { emptyManaPool } from '../types';

// ---------------------------------------------------------------------------
// Card definition helpers
// ---------------------------------------------------------------------------

function makeCard(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Instant',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{2}{R}',
    cmc: opts.cmc ?? 3,
    colors: opts.colors ?? ['R'],
    color_identity: opts.color_identity ?? ['R'],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['instant'],
    power: opts.power,
    toughness: opts.toughness,
  };
}

/**
 * Build a two-player game state with a sorcery spell (so it needs flash to
 * cast outside the sorcery window) in p1's hand.
 *
 * Phase defaults to 'precombat_main' so p1 IS in the sorcery window.
 * Adjust `state.phase` / `state.stack` / `state.activePlayerIndex` to test
 * non-sorcery windows.
 */
function setup(spellDef: CardDefinition, extraCards: CardDefinition[] = []) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: [spellDef, ...extraCards], commanderId: 'cmd1' },
    { playerId: 'p2', name: 'Bob', cards: [makeCard('dummy', { type_line: 'Creature — Beast', card_types: ['creature'], oracle_text: '', power: 1, toughness: 1 })], commanderId: 'cmd2' },
  ];
  let state = initGameState(decks);

  // Move the spell to hand
  const spellInstance = getCardsInZone(state, 'p1', 'library').find(
    c => state.cards.get(c.instanceId)!.definitionId === spellDef.id,
  )!;
  state.cards.set(spellInstance.instanceId, { ...spellInstance, zone: 'hand' });

  // Give p1 enough generic mana (3 colorless covers {2}{R} and {2}{R}+{2} surcharge)
  state = {
    ...state,
    phase: 'precombat_main' as any,
    step: 'main' as any,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    players: state.players.map(p =>
      p.id === 'p1'
        ? { ...p, manaPool: { W: 0, U: 0, B: 0, R: 5, G: 0, C: 5 } }
        : p,
    ),
  };

  const spellId = spellInstance.instanceId;
  return { state, spellId };
}

// ---------------------------------------------------------------------------
// SHAPE 1 — bare flash grant
// ---------------------------------------------------------------------------

const BARE_FLASH_ORACLE =
  'You may cast this spell as though it had flash.';

const ASININE_ANTICS_ORACLE =
  "You may cast this spell as though it had flash if you pay {2} more to cast it. Until end of turn, target player's creatures lose all abilities.";

// Oracle for pure pay-more rider (keyword-only rest)
const PAY_MORE_FLASH_ORACLE =
  'You may cast this spell as though it had flash if you pay {2} more to cast it.';

// Ferocious form (Dragon Grip / Oakshade Stalker pattern)
const FEROCIOUS_ORACLE =
  'Ferocious — If you control a creature with power 4 or greater, you may cast this spell as though it had flash.';

// ---------------------------------------------------------------------------
// 1. Parser recognition
// ---------------------------------------------------------------------------

describe('matchAsThoughFlash — parser recognition', () => {
  it('SHAPE 1: bare grant parses as StaticAbility(AsThoughFlash, surcharge=0)', () => {
    const r = parseOracleText(BARE_FLASH_ORACLE);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('AsThoughFlash');
    expect((r.ability.modifier as { surcharge: number }).surcharge).toBe(0);
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.condition).toBeUndefined();
  });

  it('SHAPE 2: pay-more rider (bare) parses as StaticAbility(AsThoughFlash, surcharge=2)', () => {
    const r = parseOracleText(PAY_MORE_FLASH_ORACLE);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('AsThoughFlash');
    expect((r.ability.modifier as { surcharge: number }).surcharge).toBe(2);
    expect(r.ability.condition).toBeUndefined();
  });

  it('SHAPE 3: Ferocious condition parses as StaticAbility(AsThoughFlash) with ControlsType condition', () => {
    const r = parseOracleText(FEROCIOUS_ORACLE);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('AsThoughFlash');
    expect(r.ability.condition?.kind).toBe('ControlsType');
  });

  it('HONESTY: an unrecognised follow-on sentence declines the whole face', () => {
    // Asinine Antics has a real effect ("target player's creatures lose all abilities")
    // alongside the flash grant — the parser should NOT claim this as a static.
    const r = parseOracleText(ASININE_ANTICS_ORACLE);
    // Should either be Unparsed or parse as a Spell effect — NOT StaticAbility.
    expect(r.kind).not.toBe('StaticAbility');
  });

  it('a plain sorcery with no flash text stays Unparsed (baseline)', () => {
    const r = parseOracleText('Destroy target creature.');
    expect(r.kind).not.toBe('StaticAbility');
  });
});

// ---------------------------------------------------------------------------
// 2. Engine enforcement: canCastSpell at instant speed
// ---------------------------------------------------------------------------

describe('matchAsThoughFlash — canCastSpell at instant speed', () => {
  const bareFlashSorcery = makeCard('bare_flash_sorcery', {
    type_line: 'Sorcery',
    card_types: ['sorcery'],
    oracle_text: BARE_FLASH_ORACLE,
    mana_cost: '{2}{R}',
    cmc: 3,
    colors: ['R'],
  });

  it('can cast the bare-flash sorcery at instant speed (opponent turn)', () => {
    const { state, spellId } = setup(bareFlashSorcery);
    // Move to opponent's turn (activePlayerIndex = 1)
    const instState = {
      ...state,
      activePlayerIndex: 1,
      phase: 'precombat_main' as any,
    };
    expect(canCastSpell(instState, 'p1', spellId)).toBe(true);
  });

  it('can cast the bare-flash sorcery on a non-empty stack', () => {
    const { state, spellId } = setup(bareFlashSorcery);
    const stackState = {
      ...state,
      stack: [{ kind: 'Spell', id: 'fake_1', cardInstanceId: 'x', casterId: 'p2', targets: [], castFromZone: 'hand' } as any],
    };
    expect(canCastSpell(stackState, 'p1', spellId)).toBe(true);
  });

  it('a plain sorcery WITHOUT the text CANNOT be cast at instant speed', () => {
    const plainSorcery = makeCard('plain_sorcery', {
      type_line: 'Sorcery',
      card_types: ['sorcery'],
      oracle_text: 'Destroy target creature.',
      mana_cost: '{2}{R}',
      cmc: 3,
      colors: ['R'],
    });
    const { state, spellId } = setup(plainSorcery);
    const instState = { ...state, activePlayerIndex: 1 };
    expect(canCastSpell(instState, 'p1', spellId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Pay-more surcharge: cost increases at instant speed, not at sorcery speed
// ---------------------------------------------------------------------------

describe('matchAsThoughFlash — pay-more surcharge', () => {
  const payMoreSorcery = makeCard('pay_more_sorcery', {
    type_line: 'Sorcery',
    card_types: ['sorcery'],
    oracle_text: PAY_MORE_FLASH_ORACLE,
    mana_cost: '{2}{R}',
    cmc: 3,
    colors: ['R'],
  });

  it('when cast at SORCERY speed (main phase, no stack), effective cost is {2}{R} (no surcharge)', () => {
    const { state, spellId } = setup(payMoreSorcery);
    // Default: precombat_main, activePlayer = p1, empty stack
    const cost = getEffectiveCastCost(state, 'p1', spellId);
    expect(cost).not.toBeNull();
    // {2}{R}: generic=2, R=1, total pips=3
    expect(cost!.generic).toBe(2);
    expect(cost!.R).toBe(1);
  });

  it('when cast at INSTANT speed (opponent turn), effective cost gains {2} surcharge → {4}{R}', () => {
    const { state, spellId } = setup(payMoreSorcery);
    // Opponent's turn — outside sorcery window
    const instState = { ...state, activePlayerIndex: 1 };
    const cost = getEffectiveCastCost(instState, 'p1', spellId);
    expect(cost).not.toBeNull();
    // {2}{R} + {2} surcharge = {4}{R}: generic=4, R=1
    expect(cost!.generic).toBe(4);
    expect(cost!.R).toBe(1);
  });

  it('when cast at INSTANT speed (non-empty stack), effective cost gains {2} surcharge', () => {
    const { state, spellId } = setup(payMoreSorcery);
    const stackState = {
      ...state,
      stack: [{ kind: 'Spell', id: 'fake_2', cardInstanceId: 'y', casterId: 'p2', targets: [], castFromZone: 'hand' } as any],
    };
    const cost = getEffectiveCastCost(stackState, 'p1', spellId);
    expect(cost).not.toBeNull();
    expect(cost!.generic).toBe(4); // {2}+{2}
  });
});

// ---------------------------------------------------------------------------
// 4. Ferocious condition gate
// ---------------------------------------------------------------------------

describe('matchAsThoughFlash — Ferocious condition (power-4-or-greater gate)', () => {
  const ferociousSorcery = makeCard('ferocious_sorcery', {
    type_line: 'Sorcery',
    card_types: ['sorcery'],
    oracle_text: FEROCIOUS_ORACLE,
    mana_cost: '{R}',
    cmc: 1,
    colors: ['R'],
  });

  const bigCreature = makeCard('big_creature', {
    type_line: 'Creature — Beast',
    card_types: ['creature'],
    oracle_text: '',
    mana_cost: '{4}{G}',
    cmc: 5,
    colors: ['G'],
    power: 4,
    toughness: 4,
  });

  const smallCreature = makeCard('small_creature', {
    type_line: 'Creature — Bird',
    card_types: ['creature'],
    oracle_text: '',
    mana_cost: '{1}{W}',
    cmc: 2,
    colors: ['W'],
    power: 1,
    toughness: 2,
  });

  it('WITH a creature of power 4 on the battlefield, can cast at instant speed', () => {
    const { state, spellId } = setup(ferociousSorcery, [bigCreature]);
    // Put the big creature on the battlefield for p1
    for (const [id, card] of state.cards) {
      if (card.ownerId === 'p1' && state.cards.get(id)!.definitionId === bigCreature.id) {
        state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
      }
    }
    const instState = { ...state, activePlayerIndex: 1 };
    expect(canCastSpell(instState, 'p1', spellId)).toBe(true);
  });

  it('WITHOUT a creature of power 4 (only power-1 creature), CANNOT cast at instant speed', () => {
    const { state, spellId } = setup(ferociousSorcery, [smallCreature]);
    // Put the small creature on the battlefield for p1
    for (const [id, card] of state.cards) {
      if (card.ownerId === 'p1' && state.cards.get(id)!.definitionId === smallCreature.id) {
        state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
      }
    }
    const instState = { ...state, activePlayerIndex: 1 };
    expect(canCastSpell(instState, 'p1', spellId)).toBe(false);
  });

  it('WITHOUT any creatures on the battlefield, CANNOT cast at instant speed', () => {
    const { state, spellId } = setup(ferociousSorcery);
    const instState = { ...state, activePlayerIndex: 1 };
    expect(canCastSpell(instState, 'p1', spellId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Sorcery-speed baseline — flash grant does not block normal cast
// ---------------------------------------------------------------------------

describe('matchAsThoughFlash — sorcery-speed cast still works', () => {
  it('a spell with bare flash grant can still be cast at sorcery speed normally', () => {
    const bareFlashSorcery = makeCard('bare_flash_sorcery_2', {
      type_line: 'Sorcery',
      card_types: ['sorcery'],
      oracle_text: BARE_FLASH_ORACLE,
      mana_cost: '{2}{R}',
      cmc: 3,
      colors: ['R'],
    });
    const { state, spellId } = setup(bareFlashSorcery);
    // Sorcery window: main phase, active player = p1, empty stack
    expect(canCastSpell(state, 'p1', spellId)).toBe(true);
  });
});
