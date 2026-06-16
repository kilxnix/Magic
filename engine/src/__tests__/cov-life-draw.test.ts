import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import type { Effect, ForEachAmount } from '../effects/ast';

/**
 * Coverage tests for the life-draw category: dynamic "equal to the number of ..."
 * amounts wired to GainLife / LoseLife / Draw / Mill, all backed by the executor's
 * ForEach amount resolver (zone counts and battlefield subtype/type counts).
 */

function spellEffects(text: string): Effect[] {
  const parsed = parseOracleText(text);
  expect(parsed.kind, `expected Spell for: ${text}`).toBe('Spell');
  if (parsed.kind !== 'Spell') throw new Error('not a spell');
  return parsed.effects;
}

function expectForEach(amount: unknown): ForEachAmount {
  expect(amount && typeof amount === 'object').toBe(true);
  const a = amount as ForEachAmount;
  expect(a.kind).toBe('ForEach');
  return a;
}

describe('life-draw: gain life equal to number of ...', () => {
  it('you gain life equal to the number of cards in your hand', () => {
    const [eff] = spellEffects('You gain life equal to the number of cards in your hand.');
    expect(eff.kind).toBe('GainLife');
    if (eff.kind !== 'GainLife') return;
    expect(eff.player).toEqual({ kind: 'Controller' });
    const fe = expectForEach(eff.amount);
    expect(fe.zone).toBe('hand');
    expect(fe.controller).toBe('you');
    expect(fe.filter).toBeUndefined();
  });

  it('you gain life equal to the number of Elves you control (creature subtype)', () => {
    const [eff] = spellEffects('You gain life equal to the number of Elves you control.');
    expect(eff.kind).toBe('GainLife');
    if (eff.kind !== 'GainLife') return;
    const fe = expectForEach(eff.amount);
    expect(fe.zone).toBe('battlefield');
    expect(fe.controller).toBe('you');
    expect(fe.filter).toEqual({ types: ['creature'], subtypes: ['elf'] });
  });
});

describe('life-draw: lose life equal to number of ...', () => {
  it('you lose life equal to the number of cards in your graveyard', () => {
    const [eff] = spellEffects('You lose life equal to the number of cards in your graveyard.');
    expect(eff.kind).toBe('LoseLife');
    if (eff.kind !== 'LoseLife') return;
    expect(eff.player).toEqual({ kind: 'Controller' });
    const fe = expectForEach(eff.amount);
    expect(fe.zone).toBe('graveyard');
    expect(fe.controller).toBe('you');
  });
});

describe('life-draw: draw cards equal to number of ...', () => {
  it('draw cards equal to the number of cards in your library', () => {
    const [eff] = spellEffects('Draw cards equal to the number of cards in your library.');
    expect(eff.kind).toBe('Draw');
    if (eff.kind !== 'Draw') return;
    expect(eff.player).toEqual({ kind: 'Controller' });
    const fe = expectForEach(eff.count);
    expect(fe.zone).toBe('library');
    expect(fe.controller).toBe('you');
  });

  it('draw cards equal to the number of artifacts you control', () => {
    const [eff] = spellEffects('Draw cards equal to the number of artifacts you control.');
    expect(eff.kind).toBe('Draw');
    if (eff.kind !== 'Draw') return;
    const fe = expectForEach(eff.count);
    expect(fe.zone).toBe('battlefield');
    expect(fe.filter).toEqual({ types: ['artifact'] });
  });
});

describe('life-draw: mill cards equal to number of ...', () => {
  it('mill cards equal to the number of cards in your hand', () => {
    const [eff] = spellEffects('Mill cards equal to the number of cards in your hand.');
    expect(eff.kind).toBe('Mill');
    if (eff.kind !== 'Mill') return;
    expect(eff.player).toEqual({ kind: 'Controller' });
    const fe = expectForEach(eff.count);
    expect(fe.zone).toBe('hand');
  });
});

describe('life-draw: target opponent loses life equal to number of ...', () => {
  it('target opponent loses life equal to the number of Vampires you control', () => {
    const parsed = parseOracleText('Target opponent loses life equal to the number of Vampires you control.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets.length).toBe(1);
    expect(parsed.targets[0].type).toBe('Player');
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('LoseLife');
    if (eff.kind !== 'LoseLife') return;
    expect(eff.player.kind).toBe('Chosen');
    const fe = expectForEach(eff.amount);
    expect(fe.zone).toBe('battlefield');
    expect(fe.filter).toEqual({ types: ['creature'], subtypes: ['vampire'] });
  });
});
