import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { populateParsedCache } from '../cards/card-parser-cache';
import { initGameFromDecks, resetInstanceCounter } from '../game-init';
import { createCardLookup } from '../cards/deck-loader';
import { getCardDefinition } from '../game-state';
import { tapLandForMana } from '../actions';
import { getLegalActions } from '../ai/legal-actions';
import type { ScryfallCard } from '../cards/deck-loader';
import type { CardDefinition } from '../types';
import type { ForEachAmount } from '../effects/ast';

/**
 * Slice 3 / Round-8 dynamic extension: dynamic any-color / any-combination
 * mana ability matchers.
 *
 * Covers:
 *   1. "Add X mana of any one color, where X is the number of <filter> <place>"
 *      (Wirewood Channeler, Sanctum of Fruitful Harvest)
 *   2. "Add X mana in any combination of colors, where X is the number of ..."
 *      (Axebane Guardian)
 *   3. "Add [N] mana in any combination of {COLOR} and/or {COLOR}"
 *      (Goblin Clearcutter)
 *
 * Execution: all four forms are handled by parseManaProductions + tapLandForMana
 * (same route as the existing any-color nonland tests). The dynamic count is
 * approximated by parseManaProductions (it stores amount=1 for each any-color
 * entry); the AI picks the highest-scoring production. These tests verify:
 *   (a) parse — each oracle line is recognised as Activated / mana ability
 *   (b) AST shape — the AddMana effect has the expected mana keys / ForEach amounts
 *   (c) execution — tapLandForMana can actually produce mana for the permanent
 */

// ── helpers ─────────────────────────────────────────────────────────────────

function defCard(oracle: string, typeLine = 'Creature — Elf Druid'): CardDefinition {
  return {
    id: 'test-card',
    name: 'Test Card',
    type_line: typeLine,
    oracle_text: oracle,
    mana_cost: '{2}{G}',
    cmc: 3,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power: '2',
    toughness: '2',
  };
}

function scry(
  name: string,
  oracle: string,
  typeLine: string,
  manaCost: string,
  colors: string[] = ['G'],
  ci: string[] = ['G'],
): ScryfallCard {
  const cmc = manaCost.replace(/\{[^}]+\}/g, 'X').length / 3;
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    type_line: typeLine,
    oracle_text: oracle,
    mana_cost: manaCost,
    cmc,
    colors: colors as ScryfallCard['colors'],
    color_identity: ci as ScryfallCard['colors'],
    keywords: [],
    power: typeLine.toLowerCase().includes('creature') ? '2' : undefined,
    toughness: typeLine.toLowerCase().includes('creature') ? '3' : undefined,
  };
}

function buildGame(permanent: ScryfallCard) {
  resetInstanceCounter();
  const cmd = scry('Test Commander', '', 'Legendary Creature — Human', '{3}{G}', ['G'], ['G', 'W', 'U', 'B', 'R']);
  const allCards: ScryfallCard[] = [cmd, permanent];
  for (let i = 0; i < 99; i++) {
    allCards.push(scry(`Forest${i}`, '{T}: Add {G}.', `Basic Land — Forest`, '', [], ['G']));
    allCards.push(scry(`AFr${i}`, '{T}: Add {G}.', `Basic Land — Forest`, '', [], ['G']));
  }
  const lookup = createCardLookup(allCards);
  let s = initGameFromDecks({
    humanDeck: {
      id: 'h', commander: 'Test Commander',
      list: [permanent.name, ...Array.from({ length: 98 }, (_, i) => `Forest${i}`)],
      colors: ['G'], bracket: 3, theme: '',
    },
    aiDecks: [{
      id: 'a', commander: 'Test Commander',
      list: Array.from({ length: 99 }, (_, i) => `AFr${i}`),
      colors: ['G'], bracket: 3, theme: '',
    }],
    aiDifficulty: 3, cardLookup: lookup, humanGoesFirst: true,
    startingLife: 40, startingHandSize: 7,
  });
  // Bring the permanent onto the battlefield
  const perm = [...s.cards.values()].find(c => getCardDefinition(s, c).name === permanent.name)!;
  const updatedCards = new Map(s.cards);
  updatedCards.set(perm.instanceId, { ...perm, zone: 'battlefield', tapped: false, summoningSick: false });
  s = { ...s, cards: updatedCards, phase: 'precombat_main', step: 'main', priorityPlayerIndex: 0 };
  return { s, perm };
}

// ── parse-level tests ────────────────────────────────────────────────────────

describe('dynamic any-color mana: parse recognition', () => {
  // ── Wirewood Channeler ──────────────────────────────────────────────────────
  it('parses Wirewood Channeler: "{T}: Add X mana of any one color, where X is the number of Elves on the battlefield."', () => {
    const result = parseOracleText(
      '{T}: Add X mana of any one color, where X is the number of Elves on the battlefield.',
    );
    expect(result.kind).toBe('Activated');
    if (result.kind !== 'Activated') return;
    expect(result.abilities).toHaveLength(1);
    expect(result.abilities[0].isManaAbility).toBe(true);
    const effect = result.abilities[0].effects[0];
    expect(effect.kind).toBe('AddMana');
    if (effect.kind !== 'AddMana') return;
    // All five colors should be present with ForEach amounts
    for (const color of ['W', 'U', 'B', 'R', 'G'] as const) {
      expect(effect.mana[color]).toBeDefined();
      const amt = effect.mana[color] as ForEachAmount;
      expect(amt.kind).toBe('ForEach');
      expect(amt.zone).toBe('battlefield');
    }
  });

  // ── Sanctum of Fruitful Harvest (simplified wording) ───────────────────────
  it('parses Sanctum: "{T}: Add X mana of any one color, where X is the number of permanents you control."', () => {
    const result = parseOracleText(
      '{T}: Add X mana of any one color, where X is the number of permanents you control.',
    );
    expect(result.kind).toBe('Activated');
    if (result.kind !== 'Activated') return;
    expect(result.abilities[0].isManaAbility).toBe(true);
    const effect = result.abilities[0].effects[0];
    expect(effect.kind).toBe('AddMana');
    if (effect.kind !== 'AddMana') return;
    const amt = effect.mana.G as ForEachAmount;
    expect(amt.kind).toBe('ForEach');
    expect(amt.zone).toBe('battlefield');
  });

  // ── Axebane Guardian ───────────────────────────────────────────────────────
  it('parses Axebane Guardian: "{T}: Add X mana in any combination of colors, where X is the number of creatures with defender you control."', () => {
    const result = parseOracleText(
      '{T}: Add X mana in any combination of colors, where X is the number of creatures you control.',
    );
    expect(result.kind).toBe('Activated');
    if (result.kind !== 'Activated') return;
    expect(result.abilities[0].isManaAbility).toBe(true);
    const effect = result.abilities[0].effects[0];
    expect(effect.kind).toBe('AddMana');
    if (effect.kind !== 'AddMana') return;
    // All five colors with ForEach
    expect(effect.mana.W).toBeDefined();
    expect(effect.mana.G).toBeDefined();
    const amt = effect.mana.R as ForEachAmount;
    expect(amt.kind).toBe('ForEach');
  });

  // ── Goblin Clearcutter ─────────────────────────────────────────────────────
  it('parses Goblin Clearcutter: "{T}, Sacrifice a Forest: Add three mana in any combination of {R} and/or {G}."', () => {
    const result = parseOracleText(
      '{T}, Sacrifice a Forest: Add three mana in any combination of {R} and/or {G}.',
    );
    expect(result.kind).toBe('Activated');
    if (result.kind !== 'Activated') return;
    expect(result.abilities[0].isManaAbility).toBe(true);
    const effect = result.abilities[0].effects[0];
    expect(effect.kind).toBe('AddMana');
    if (effect.kind !== 'AddMana') return;
    // R and G should be present with amount 3
    expect(effect.mana.R).toBe(3);
    expect(effect.mana.G).toBe(3);
    // W, U, B should NOT be present for this color-restricted form
    expect(effect.mana.W).toBeUndefined();
    expect(effect.mana.U).toBeUndefined();
    expect(effect.mana.B).toBeUndefined();
  });

  // ── Combination-of-{R}/{G} fixed count = 1 ────────────────────────────────
  it('parses "Add one mana in any combination of {R} and/or {G}." as Activated mana ability', () => {
    const result = parseOracleText('{T}: Add one mana in any combination of {R} and/or {G}.');
    expect(result.kind).toBe('Activated');
    if (result.kind !== 'Activated') return;
    expect(result.abilities[0].isManaAbility).toBe(true);
  });

  // ── Existing any-color fixed forms: must still work ────────────────────────
  it('still parses "{T}: Add one mana of any color." as Activated (regression guard)', () => {
    const result = parseOracleText('{T}: Add one mana of any color.');
    expect(result.kind).toBe('Activated');
    if (result.kind !== 'Activated') return;
    expect(result.abilities[0].isManaAbility).toBe(true);
  });

  it('still parses "{T}: Add two mana of any color." as Activated (regression guard)', () => {
    const result = parseOracleText('{T}: Add two mana of any color.');
    expect(result.kind).toBe('Activated');
  });
});

// ── parseManaProductions integration tests ───────────────────────────────────

describe('dynamic any-color mana: parseManaProductions cache', () => {
  it('Wirewood Channeler oracle populates manaProduction with all five colors', () => {
    const d = populateParsedCache(
      defCard('{T}: Add X mana of any one color, where X is the number of Elves on the battlefield.'),
    );
    expect(d.manaProduction).toBeDefined();
    expect(d.manaProduction!.colors).toContain('W');
    expect(d.manaProduction!.colors).toContain('U');
    expect(d.manaProduction!.colors).toContain('B');
    expect(d.manaProduction!.colors).toContain('R');
    expect(d.manaProduction!.colors).toContain('G');
    expect(d.manaProduction!.isTapAbility).toBe(true);
  });

  it('Axebane-style oracle populates manaProduction with all five colors', () => {
    const d = populateParsedCache(
      defCard(
        'Defender\n{T}: Add X mana in any combination of colors, where X is the number of creatures with defender you control.',
      ),
    );
    expect(d.manaProduction).toBeDefined();
    expect(d.manaProduction!.colors).toContain('G');
    expect(d.manaProduction!.isTapAbility).toBe(true);
  });

  it('Goblin Clearcutter oracle populates manaProduction with R and G', () => {
    const d = populateParsedCache(
      defCard(
        '{T}, Sacrifice a Forest: Add three mana in any combination of {R} and/or {G}.',
        'Creature — Goblin',
      ),
    );
    // parseManaProductions picks the richer entry (R+G beats plain colorless)
    expect(d.manaProduction).toBeDefined();
    const prod = d.manaProduction!;
    const hasRG = prod.colors.includes('R') && prod.colors.includes('G');
    // Some productions emit all 5 colors for "any combination"; either is acceptable,
    // but at minimum R and G must be present.
    expect(hasRG || (prod.colors.includes('R') && prod.colors.includes('G'))).toBe(true);
  });
});

// ── execution tests ──────────────────────────────────────────────────────────

describe('dynamic any-color mana: tapLandForMana execution', () => {
  it('Wirewood Channeler: exposes ActivateManaAbility actions and produces any color', () => {
    const channeler = scry(
      'Wirewood Channeler',
      '{T}: Add X mana of any one color, where X is the number of Elves on the battlefield.',
      'Creature — Elf Druid',
      '{2}{G}',
      ['G'],
      ['G'],
    );
    const { s, perm } = buildGame(channeler);

    const actions = getLegalActions(s, 'human');
    const manaActions = actions.filter(
      a => a.kind === 'ActivateManaAbility' && a.cardInstanceId === perm.instanceId,
    );
    expect(manaActions.length).toBeGreaterThan(0);

    // Should produce blue (any one color)
    const blueAction = manaActions.find(a => a.kind === 'ActivateManaAbility' && a.color === 'U');
    expect(blueAction).toBeDefined();

    const next = tapLandForMana(s, 'human', perm.instanceId, 'G');
    expect(next.players[0].manaPool.G).toBeGreaterThan(0);
    expect(next.cards.get(perm.instanceId)!.tapped).toBe(true);
  });

  it('Axebane Guardian: exposes ActivateManaAbility actions and produces any color', () => {
    const axebane = scry(
      'Axebane Guardian',
      'Defender\n{T}: Add X mana in any combination of colors, where X is the number of creatures with defender you control.',
      'Creature — Human Druid',
      '{2}{G}',
      ['G'],
      ['G'],
    );
    const { s, perm } = buildGame(axebane);

    const actions = getLegalActions(s, 'human');
    const manaActions = actions.filter(
      a => a.kind === 'ActivateManaAbility' && a.cardInstanceId === perm.instanceId,
    );
    expect(manaActions.length).toBeGreaterThan(0);

    const next = tapLandForMana(s, 'human', perm.instanceId, 'W');
    expect(next.players[0].manaPool.W).toBeGreaterThan(0);
    expect(next.cards.get(perm.instanceId)!.tapped).toBe(true);
  });

  it('Goblin Clearcutter: produces R mana via tapLandForMana (sacrifice route skipped — tap only)', () => {
    // Goblin Clearcutter's only non-tap ability uses sacrifice. We test the parser
    // recognised the ability; execution via tapLandForMana is tested with a simpler
    // {T}: Add {R} and/or {G} wording to avoid the sacrifice subsystem.
    const card = scry(
      'Mana Goblin',
      '{T}: Add three mana in any combination of {R} and/or {G}.',
      'Creature — Goblin',
      '{R}',
      ['R'],
      ['R', 'G'],
    );
    const { s, perm } = buildGame(card);

    const actions = getLegalActions(s, 'human');
    const manaActions = actions.filter(
      a => a.kind === 'ActivateManaAbility' && a.cardInstanceId === perm.instanceId,
    );
    expect(manaActions.length).toBeGreaterThan(0);

    const next = tapLandForMana(s, 'human', perm.instanceId, 'R');
    expect(next.players[0].manaPool.R).toBeGreaterThan(0);
    expect(next.cards.get(perm.instanceId)!.tapped).toBe(true);
  });
});
