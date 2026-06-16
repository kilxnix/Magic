/**
 * Slice 5 — Self-equipped/enchanted conditional statics
 *
 * Tests for the new SelfIsEquipped / SelfIsEnchanted condition kind and the
 * matchSelfEquippedEnchantedAnthem matcher.
 *
 * Coverage:
 *   - Parse: "As long as this creature is equipped, it gets +P/+T [and has KW]"
 *   - Parse: "As long as this creature is enchanted, it gets +P/+T [and has KW]"
 *   - Parse: keyword-only form ("it has menace")
 *   - Parse: ~ (tilde) self-reference form
 *   - Execute: P/T gated on equipment being present (Skyhunter Cub model)
 *   - Execute: keyword gated on equipment being present (Armory Veteran/keyword-only model)
 *   - Execute: P/T gated on aura being present (Thran Golem model)
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import { instanceHasKeyword } from '../keywords';
import { initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import type { CardDefinition, GameState } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function creature(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
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

function equipment(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Artifact — Equipment',
    oracle_text: opts.oracle_text ?? 'Equip {2}',
    mana_cost: opts.mana_cost ?? '{2}',
    cmc: opts.cmc ?? 2,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['artifact'],
    power: opts.power ?? undefined,
    toughness: opts.toughness ?? undefined,
  };
}

function aura(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Enchantment — Aura',
    oracle_text: opts.oracle_text ?? 'Enchant creature',
    mana_cost: opts.mana_cost ?? '{1}',
    cmc: opts.cmc ?? 1,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['enchantment'],
    power: opts.power ?? undefined,
    toughness: opts.toughness ?? undefined,
  };
}

/**
 * Set up a game with p1 cards on the battlefield, register continuous effects,
 * then optionally attach an equipment/aura to a creature.
 */
function setup(
  p1Defs: CardDefinition[],
  p2Defs: CardDefinition[] = [creature('dummy')],
  attachOpts?: { attacherDefId: string; targetDefId: string },
) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'none1' },
    { playerId: 'p2', name: 'Bob', cards: p2Defs, commanderId: 'none2' },
  ];
  let state = initGameState(decks);

  // Move all cards to battlefield
  for (const [id, card] of state.cards) {
    state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
  }

  // Register continuous effects for all battlefield permanents
  for (const card of state.cards.values()) {
    if (card.zone === 'battlefield') {
      state = registerContinuousAbilitiesForPermanent(state, card.instanceId);
    }
  }

  const idFor = (defId: string) =>
    [...state.cards.values()].find(c => c.definitionId === defId)!.instanceId;

  // Optionally attach equipment/aura
  if (attachOpts) {
    const attacherInstanceId = idFor(attachOpts.attacherDefId);
    const targetInstanceId = idFor(attachOpts.targetDefId);
    const newCards = new Map(state.cards);
    const attacher = state.cards.get(attacherInstanceId)!;
    newCards.set(attacherInstanceId, { ...attacher, attachedTo: targetInstanceId });
    state = { ...state, cards: newCards };
  }

  return { state, idFor };
}

// ── Parse tests ───────────────────────────────────────────────────────────────

describe('slice5: SelfIsEquipped/SelfIsEnchanted — parser recognition', () => {
  it('Skyhunter Cub: "As long as this creature is equipped, it gets +1/+1 and has flying."', () => {
    const r = parseOracleText(
      'As long as this creature is equipped, it gets +1/+1 and has flying.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.condition).toEqual({ kind: 'SelfIsEquipped' });
  });

  it('Armory Veteran: "As long as this creature is equipped, it has menace." (keyword-only)', () => {
    const r = parseOracleText('As long as this creature is equipped, it has menace.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'Menace' });
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.condition).toEqual({ kind: 'SelfIsEquipped' });
  });

  it('Leonin Den-Guard: "As long as this creature is equipped, it gets +1/+1 and has vigilance."', () => {
    const r = parseOracleText(
      'As long as this creature is equipped, it gets +1/+1 and has vigilance.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(r.ability.condition).toEqual({ kind: 'SelfIsEquipped' });
  });

  it('Thran Golem: "As long as this creature is enchanted, it gets +2/+2 and has flying, first strike, and trample."', () => {
    const r = parseOracleText(
      'As long as this creature is enchanted, it gets +2/+2 and has flying, first strike, and trample.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 2, toughness: 2 });
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.condition).toEqual({ kind: 'SelfIsEnchanted' });
  });

  it('Tilde form: "As long as ~ is equipped, it gets +1/+1 and has flying."', () => {
    const r = parseOracleText('As long as ~ is equipped, it gets +1/+1 and has flying.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(r.ability.condition).toEqual({ kind: 'SelfIsEquipped' });
  });

  it('Pure PT form (no keyword): "As long as this creature is equipped, it gets +0/+2."', () => {
    const r = parseOracleText('As long as this creature is equipped, it gets +0/+2.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 0, toughness: 2 });
    expect(r.ability.condition).toEqual({ kind: 'SelfIsEquipped' });
  });

  it('Keyword-only enchanted form: "As long as this creature is enchanted, it has haste."', () => {
    const r = parseOracleText('As long as this creature is enchanted, it has haste.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'Haste' });
    expect(r.ability.condition).toEqual({ kind: 'SelfIsEnchanted' });
  });

  it('Kor Duelist: "As long as this creature is equipped, it has double strike."', () => {
    const r = parseOracleText('As long as this creature is equipped, it has double strike.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'Double Strike' });
    expect(r.ability.condition).toEqual({ kind: 'SelfIsEquipped' });
  });
});

// ── Execution tests ───────────────────────────────────────────────────────────

describe('slice5: SelfIsEquipped/SelfIsEnchanted — engine executes the condition gate', () => {
  it('Skyhunter Cub: +1/+1 only while equipped (P/T gate)', () => {
    const cub = creature('cub', {
      name: 'Skyhunter Cub',
      oracle_text: 'As long as this creature is equipped, it gets +1/+1 and has flying.',
      power: 1,
      toughness: 1,
    });
    const sword = equipment('sword');

    // Without equipment: base 1/1
    const unequipped = setup([cub, sword]);
    const cubId = unequipped.idFor('cub');
    expect(getEffectivePower(unequipped.state, cubId)).toBe(1);
    expect(getEffectiveToughness(unequipped.state, cubId)).toBe(1);

    // With equipment attached: 2/2
    const equipped = setup([cub, sword], undefined, {
      attacherDefId: 'sword',
      targetDefId: 'cub',
    });
    const cubIdEq = equipped.idFor('cub');
    expect(getEffectivePower(equipped.state, cubIdEq)).toBe(2);
    expect(getEffectiveToughness(equipped.state, cubIdEq)).toBe(2);
  });

  it('Skyhunter Cub: flying granted by side-channel only while equipped', () => {
    const cub = creature('cub', {
      name: 'Skyhunter Cub',
      oracle_text: 'As long as this creature is equipped, it gets +1/+1 and has flying.',
      power: 1,
      toughness: 1,
    });
    const sword = equipment('sword');

    // Unequipped: no flying
    const unequipped = setup([cub, sword]);
    expect(instanceHasKeyword(unequipped.state, unequipped.idFor('cub'), 'Flying')).toBe(false);

    // Equipped: flying granted (via additionalStaticKeywordFromLine side-channel)
    const equipped = setup([cub, sword], undefined, {
      attacherDefId: 'sword',
      targetDefId: 'cub',
    });
    expect(instanceHasKeyword(equipped.state, equipped.idFor('cub'), 'Flying')).toBe(true);
  });

  it('Armory Veteran: menace granted only while equipped (keyword-only form)', () => {
    const veteran = creature('vet', {
      name: 'Armory Veteran',
      oracle_text: 'As long as this creature is equipped, it has menace.',
      power: 2,
      toughness: 2,
    });
    const gear = equipment('gear');

    // Unequipped: no menace
    const unequipped = setup([veteran, gear]);
    expect(instanceHasKeyword(unequipped.state, unequipped.idFor('vet'), 'Menace')).toBe(false);

    // Equipped: menace active
    const equipped = setup([veteran, gear], undefined, {
      attacherDefId: 'gear',
      targetDefId: 'vet',
    });
    expect(instanceHasKeyword(equipped.state, equipped.idFor('vet'), 'Menace')).toBe(true);
  });

  it('Thran Golem: +2/+2 only while enchanted (SelfIsEnchanted)', () => {
    const golem = creature('golem', {
      name: 'Thran Golem',
      oracle_text:
        'As long as this creature is enchanted, it gets +2/+2 and has flying, first strike, and trample.',
      power: 3,
      toughness: 3,
    });
    const enchant = aura('enchant');

    // Without aura: base 3/3
    const bare = setup([golem, enchant]);
    expect(getEffectivePower(bare.state, bare.idFor('golem'))).toBe(3);
    expect(getEffectiveToughness(bare.state, bare.idFor('golem'))).toBe(3);

    // With aura attached: 5/5
    const withAura = setup([golem, enchant], undefined, {
      attacherDefId: 'enchant',
      targetDefId: 'golem',
    });
    expect(getEffectivePower(withAura.state, withAura.idFor('golem'))).toBe(5);
    expect(getEffectiveToughness(withAura.state, withAura.idFor('golem'))).toBe(5);
  });

  it('SelfIsEquipped: equipment attached to OTHER creature does NOT trigger condition', () => {
    const cub = creature('cub', {
      name: 'Skyhunter Cub',
      oracle_text: 'As long as this creature is equipped, it gets +1/+1 and has flying.',
      power: 1,
      toughness: 1,
    });
    const other = creature('other', { power: 2, toughness: 2 });
    const sword = equipment('sword');

    // Sword attached to OTHER creature, not cub
    const s = setup([cub, other, sword]);
    const cubId = s.idFor('cub');
    const otherId = s.idFor('other');
    const swordId = s.idFor('sword');

    // Attach sword to other creature
    const newCards = new Map(s.state.cards);
    newCards.set(swordId, { ...s.state.cards.get(swordId)!, attachedTo: otherId });
    const stateWithEquippedOther = { ...s.state, cards: newCards };

    // Cub is NOT equipped — no buff
    expect(getEffectivePower(stateWithEquippedOther, cubId)).toBe(1);
    expect(getEffectiveToughness(stateWithEquippedOther, cubId)).toBe(1);
    expect(instanceHasKeyword(stateWithEquippedOther, cubId, 'Flying')).toBe(false);
  });
});
