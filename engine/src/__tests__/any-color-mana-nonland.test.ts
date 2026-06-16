import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { populateParsedCache } from '../cards/card-parser-cache';
import { initGameFromDecks, resetInstanceCounter } from '../game-init';
import { createCardLookup } from '../cards/deck-loader';
import { getCardDefinition, getCardsInZone } from '../game-state';
import { tapLandForMana } from '../actions';
import { getLegalActions } from '../ai/legal-actions';
import type { ScryfallCard } from '../cards/deck-loader';
import type { CardDefinition } from '../types';

/**
 * Round-8 slice-b: any-color mana ability lines on nonland permanents.
 *
 * Verifies that parser.ts now recognises "{T}: Add one mana of any color[...]"
 * (and related text variants) on creatures and artifacts, crediting those faces
 * as Activated rather than Unparsed.
 *
 * Execution route: parseManaProductions + tapLandForMana already produce the
 * correct any-color mana — these tests confirm that too.
 */

// ── helpers ────────────────────────────────────────────────────────────────

function def(oracle: string, typeLine = 'Artifact'): CardDefinition {
  return {
    id: 'test-card',
    name: 'Test Card',
    type_line: typeLine,
    oracle_text: oracle,
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: ['W', 'U', 'B', 'R', 'G'],
    keywords: [],
    card_types: typeLine.toLowerCase().includes('creature') ? ['creature'] : ['artifact'],
    power: typeLine.toLowerCase().includes('creature') ? '1' : undefined,
    toughness: typeLine.toLowerCase().includes('creature') ? '1' : undefined,
  };
}

function scry(name: string, oracle: string, typeLine: string, manaCost: string, colors: string[] = [], ci: string[] = []): ScryfallCard {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    type_line: typeLine,
    oracle_text: oracle,
    mana_cost: manaCost,
    cmc: manaCost.replace(/\{[^}]+\}/g, 'x').length / 3,
    colors: colors as ScryfallCard['colors'],
    color_identity: ci as ScryfallCard['colors'],
    keywords: [],
    power: typeLine.toLowerCase().includes('creature') ? '1' : undefined,
    toughness: typeLine.toLowerCase().includes('creature') ? '1' : undefined,
  };
}

function land(name: string, color: string): ScryfallCard {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    type_line: `Basic Land — ${name}`,
    oracle_text: `{T}: Add {${color}}.`,
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [color] as ScryfallCard['colors'],
    keywords: [],
  };
}

// ── parse-level tests ──────────────────────────────────────────────────────

describe('any-color mana ability parser recognition', () => {
  it('parses "{T}: Add one mana of any color." as Activated (mana-line-only artifact)', () => {
    // Orochi Leafcaller / Command Tower style
    const result = parseOracleText('{T}: Add one mana of any color.');
    expect(result.kind).toBe('Activated');
    if (result.kind === 'Activated') {
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0].isManaAbility).toBe(true);
    }
  });

  it('parses "{T}: Add one mana of any color in your commander\'s color identity." (Arcane Signet)', () => {
    const result = parseOracleText("{T}: Add one mana of any color in your commander's color identity.");
    expect(result.kind).toBe('Activated');
    if (result.kind === 'Activated') {
      expect(result.abilities[0].isManaAbility).toBe(true);
    }
  });

  it('parses "Flying\\n{T}: Add one mana of any color." (Birds of Paradise) as Activated', () => {
    // Multi-line mixed face: keyword + mana ability
    const result = parseOracleText('Flying\n{T}: Add one mana of any color.');
    expect(result.kind).toBe('Activated');
    if (result.kind === 'Activated') {
      expect(result.abilities[0].isManaAbility).toBe(true);
    }
  });

  it('parses "Deathtouch\\n{T}: Add one mana of any color." (Deathbloom Gardener) as Activated', () => {
    const result = parseOracleText('Deathtouch\n{T}: Add one mana of any color.');
    expect(result.kind).toBe('Activated');
    if (result.kind === 'Activated') {
      expect(result.abilities[0].isManaAbility).toBe(true);
    }
  });

  it('parses "{T}: Add one mana of any one color." (alternate wording) as Activated', () => {
    const result = parseOracleText('{T}: Add one mana of any one color.');
    expect(result.kind).toBe('Activated');
  });

  it('parses "{T}: Add two mana of any color." as Activated with amount=2', () => {
    const result = parseOracleText('{T}: Add two mana of any color.');
    expect(result.kind).toBe('Activated');
    if (result.kind === 'Activated') {
      const mana = result.abilities[0].effects[0];
      expect(mana.kind).toBe('AddMana');
      if (mana.kind === 'AddMana') {
        expect(mana.mana.W).toBe(2);
        expect(mana.mana.G).toBe(2);
      }
    }
  });

  it('parses "{T}, Sacrifice this artifact: Add one mana of any color." (Lotus Petal) as Activated', () => {
    const result = parseOracleText('{T}, Sacrifice this artifact: Add one mana of any color.');
    expect(result.kind).toBe('Activated');
    if (result.kind === 'Activated') {
      expect(result.abilities[0].isManaAbility).toBe(true);
    }
  });

  it('parses "{G}: Add one mana of any color." (Orochi Leafcaller, non-tap cost) as Activated', () => {
    // The ability has a {G} mana cost rather than {T}; parseCostTokens recognises {G} as mana cost.
    const result = parseOracleText('{G}: Add one mana of any color.');
    expect(result.kind).toBe('Activated');
    if (result.kind === 'Activated') {
      expect(result.abilities[0].isManaAbility).toBe(true);
    }
  });

  it('does NOT claim "{T}: Add {G}." (explicit symbol form) — handled by matchAddMana already', () => {
    // This tests that matchAddManaAnyColor does NOT interfere with the existing path
    const result = parseOracleText('{T}: Add {G}.');
    expect(result.kind).toBe('Activated');
  });
});

// ── card-parser-cache integration ─────────────────────────────────────────

describe('parseManaProductions integration for any-color nonland permanents', () => {
  it('populateParsedCache returns any-color manaProduction for Birds of Paradise oracle', () => {
    const d = populateParsedCache(def('Flying\n{T}: Add one mana of any color.', 'Creature — Bird'));
    expect(d.manaProduction).toBeDefined();
    expect(d.manaProduction!.colors).toContain('W');
    expect(d.manaProduction!.colors).toContain('G');
    expect(d.manaProduction!.isTapAbility).toBe(true);
  });

  it('populateParsedCache returns any-color manaProduction for Arcane Signet oracle', () => {
    const d = populateParsedCache(def("{T}: Add one mana of any color in your commander's color identity."));
    expect(d.manaProduction).toBeDefined();
    expect(d.manaProduction!.colors).toContain('W');
    expect(d.manaProduction!.colors).toContain('U');
  });

  it('populateParsedCache returns any-color manaProduction for Lotus Petal oracle', () => {
    const d = populateParsedCache(def('{T}, Sacrifice this artifact: Add one mana of any color.'));
    expect(d.manaProduction).toBeDefined();
    expect(d.manaProduction!.requiresSacrifice).toBe(true);
    expect(d.manaProduction!.colors).toContain('G');
  });
});

// ── execution tests ────────────────────────────────────────────────────────

describe('any-color mana ability execution on nonland permanents', () => {
  function buildGame(creatureOrArtifact: ScryfallCard) {
    resetInstanceCounter();
    const cmdCard = scry('Test Commander', '', 'Legendary Creature — Human', '{3}{G}', ['G'], ['G', 'W', 'U', 'B', 'R']);
    const cards: ScryfallCard[] = [cmdCard, creatureOrArtifact];
    // Fill decks with basic lands
    for (let i = 0; i < 99; i++) {
      cards.push(land(`Forest${i}`, 'G'));
      cards.push(land(`AFr${i}`, 'G'));
    }
    const lookup = createCardLookup(cards);
    let s = initGameFromDecks({
      humanDeck: { id: 'h', commander: 'Test Commander', list: [creatureOrArtifact.name, ...Array.from({ length: 98 }, (_, i) => `Forest${i}`)], colors: ['G'], bracket: 3, theme: '' },
      aiDecks: [{ id: 'a', commander: 'Test Commander', list: Array.from({ length: 99 }, (_, i) => `AFr${i}`), colors: ['G'], bracket: 3, theme: '' }],
      aiDifficulty: 3, cardLookup: lookup, humanGoesFirst: true, startingLife: 40, startingHandSize: 7,
    });
    // Move the permanent to the battlefield
    const permanent = [...s.cards.values()].find(c => getCardDefinition(s, c).name === creatureOrArtifact.name)!;
    const newCards = new Map(s.cards);
    newCards.set(permanent.instanceId, { ...permanent, zone: 'battlefield', tapped: false, summoningSick: false });
    s = { ...s, cards: newCards, phase: 'precombat_main', step: 'main', priorityPlayerIndex: 0 };
    return { s, permanent };
  }

  it('Birds of Paradise: exposes any-color ActivateManaAbility actions and produces mana via tapLandForMana', () => {
    const bop = scry('Birds of Paradise', 'Flying\n{T}: Add one mana of any color.', 'Creature — Bird', '{G}', ['G'], ['G']);
    const { s, permanent } = buildGame(bop);

    const actions = getLegalActions(s, 'human');
    const manaActions = actions.filter(a => a.kind === 'ActivateManaAbility' && a.cardInstanceId === permanent.instanceId);
    expect(manaActions.length).toBeGreaterThan(0);

    // Should be able to produce blue (any color)
    const blueAction = manaActions.find(a => a.kind === 'ActivateManaAbility' && a.color === 'U');
    expect(blueAction).toBeDefined();

    // Activate for blue
    const next = tapLandForMana(s, 'human', permanent.instanceId, 'U');
    expect(next.players[0].manaPool.U).toBe(1);
    expect(next.cards.get(permanent.instanceId)!.tapped).toBe(true);
  });

  it('Arcane Signet: exposes any-color ActivateManaAbility actions and produces mana', () => {
    const signet = scry('Arcane Signet', "{T}: Add one mana of any color in your commander's color identity.", 'Artifact', '{2}', [], []);
    const { s, permanent } = buildGame(signet);

    const actions = getLegalActions(s, 'human');
    const manaActions = actions.filter(a => a.kind === 'ActivateManaAbility' && a.cardInstanceId === permanent.instanceId);
    expect(manaActions.length).toBeGreaterThan(0);

    // Tap for white
    const next = tapLandForMana(s, 'human', permanent.instanceId, 'W');
    expect(next.players[0].manaPool.W).toBe(1);
    expect(next.cards.get(permanent.instanceId)!.tapped).toBe(true);
  });

  it('Deathbloom Gardener: Deathtouch + {T}: Add one mana of any color. — produces any color via tapLandForMana', () => {
    // Mixed face: keyword line + tap-for-any-color
    const gardener = scry('Deathbloom Gardener', 'Deathtouch\n{T}: Add one mana of any color.', 'Creature — Fungus Druid', '{1}{G}', ['G'], ['G']);
    const { s, permanent } = buildGame(gardener);

    const actions = getLegalActions(s, 'human');
    const manaActions = actions.filter(a => a.kind === 'ActivateManaAbility' && a.cardInstanceId === permanent.instanceId);
    expect(manaActions.length).toBeGreaterThan(0);

    const redAction = manaActions.find(a => a.kind === 'ActivateManaAbility' && a.color === 'R');
    expect(redAction).toBeDefined();

    const next = tapLandForMana(s, 'human', permanent.instanceId, 'R');
    expect(next.players[0].manaPool.R).toBe(1);
    expect(next.cards.get(permanent.instanceId)!.tapped).toBe(true);
  });
});
