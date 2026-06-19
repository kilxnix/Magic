/**
 * Sisay, Weatherlight Captain interaction with Leyline of the Guildpact.
 *
 * Sisay: "Sisay gets +1/+1 for each color among other legendary permanents you
 *   control."  (Layer 7c, reads colors)
 * Leyline of the Guildpact: "Each nonland permanent you control is all colors."
 *   (Layer 5 color-defining static, CR 613.4b — applies before 7c reads it)
 *
 * With Leyline out, a single OTHER mono/colorless legend should be all 5 colors,
 * so Sisay should get +5/+5. Without Leyline, only the printed colors count.
 */

import { describe, it, expect } from 'vitest';
import { getContinuousPTModification } from '../effects/continuous';
import { initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import type { CardDefinition } from '../types';

function permanent(
  id: string,
  opts: Partial<CardDefinition> & { card_types: CardDefinition['card_types'] },
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Artifact',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{1}',
    cmc: opts.cmc ?? 1,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types,
    power: opts.power,
    toughness: opts.toughness,
  };
}

const leylineDef: CardDefinition = permanent('leyline', {
  name: 'Leyline of the Guildpact',
  type_line: 'Enchantment',
  card_types: ['enchantment'],
  colors: ['W', 'U', 'B', 'R', 'G'],
  color_identity: ['W', 'U', 'B', 'R', 'G'],
  oracle_text: 'Each nonland permanent you control is all colors.',
});

const sisayDef: CardDefinition = permanent('sisay', {
  name: 'Sisay, Weatherlight Captain',
  type_line: 'Legendary Creature — Human Soldier',
  card_types: ['creature'],
  colors: ['W'],
  color_identity: ['W'],
  power: 2,
  toughness: 2,
  oracle_text:
    'Sisay gets +1/+1 for each color among other legendary permanents you control.',
});

/** Mono-white legendary dog (Yoshimaru-style: 1 printed color) */
const yoshimaruDef: CardDefinition = permanent('yoshimaru', {
  name: 'Yoshimaru, Ever Faithful',
  type_line: 'Legendary Creature — Dog',
  card_types: ['creature'],
  colors: ['W'],
  color_identity: ['W'],
  power: 1,
  toughness: 1,
});

/** Colorless legendary artifact (0 printed colors) */
const solRingDef: CardDefinition = permanent('solring', {
  name: 'Sol Ring',
  type_line: 'Legendary Artifact',
  card_types: ['artifact'],
  colors: [],
  color_identity: [],
});

function setup(p1Defs: CardDefinition[]) {
  const dummyLand: CardDefinition = permanent('dummy_land', {
    name: 'Plains',
    type_line: 'Basic Land — Plains',
    card_types: ['land'],
    cmc: 0,
  });
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'none1' },
    { playerId: 'p2', name: 'Bob', cards: [dummyLand], commanderId: 'none2' },
  ];
  let state = initGameState(decks);
  for (const [id, card] of state.cards) {
    state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
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

describe('Sisay + Leyline of the Guildpact — effective colors in P/T', () => {
  it('without Leyline: mono-color Yoshimaru gives Sisay only +1/+1', () => {
    const { state, idFor } = setup([sisayDef, yoshimaruDef]);
    const mod = getContinuousPTModification(state, idFor('sisay'));
    expect(mod).toEqual({ power: 1, toughness: 1 });
  });

  it('with Leyline: mono-color Yoshimaru is all 5 colors -> Sisay gets +5/+5', () => {
    const { state, idFor } = setup([sisayDef, yoshimaruDef, leylineDef]);
    const mod = getContinuousPTModification(state, idFor('sisay'));
    expect(mod).toEqual({ power: 5, toughness: 5 });
  });

  it('with Leyline: colorless legendary artifact also contributes all 5 colors', () => {
    const { state, idFor } = setup([sisayDef, solRingDef, leylineDef]);
    const mod = getContinuousPTModification(state, idFor('sisay'));
    expect(mod).toEqual({ power: 5, toughness: 5 });
  });

  it('without Leyline: colorless legendary artifact contributes 0 colors', () => {
    const { state, idFor } = setup([sisayDef, solRingDef]);
    const mod = getContinuousPTModification(state, idFor('sisay'));
    expect(mod).toEqual({ power: 0, toughness: 0 });
  });
});
