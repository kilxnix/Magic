/**
 * Parser/executor coverage — slice 3/12 (oracle-parser round 8):
 * Reorder-top, target-player's-library dig, plural/up-to-N filtered take,
 * and Dark Confidant upkeep-reveal families.
 */
import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ─────────────────────── card definitions ───────────────────────
const forest: CardDefinition = {
  id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '',
  mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [], card_types: ['land'],
};
const snowForest: CardDefinition = {
  id: 'snowforest', name: 'Snow-Covered Forest', type_line: 'Basic Snow Land — Forest', oracle_text: '',
  mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [], card_types: ['land'],
  // supertypes not in the card_types array — stored in type_line per engine convention
};
const bear: CardDefinition = {
  id: 'bear', name: 'Bear', type_line: 'Creature — Bear', oracle_text: '',
  mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'],
  power: 2, toughness: 2,
};
const smallBear: CardDefinition = {
  id: 'smallbear', name: 'Small Bear', type_line: 'Creature — Bear', oracle_text: '',
  mana_cost: '{G}', cmc: 1, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'],
  power: 1, toughness: 1,
};
const bolt: CardDefinition = {
  id: 'bolt', name: 'Bolt', type_line: 'Instant', oracle_text: '',
  mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'], keywords: [], card_types: ['instant'],
};
const artifact: CardDefinition = {
  id: 'artifact', name: 'Artifact', type_line: 'Artifact', oracle_text: '',
  mana_cost: '{2}', cmc: 2, colors: [], color_identity: [], keywords: [], card_types: ['artifact'],
};
const shrine: CardDefinition = {
  id: 'shrine', name: 'Shrine', type_line: 'Enchantment', oracle_text: '',
  mana_cost: '{1}{W}', cmc: 2, colors: ['W'], color_identity: ['W'], keywords: [], card_types: ['enchantment'],
};
const expensiveBear: CardDefinition = {
  id: 'expensivebear', name: 'Expensive Bear', type_line: 'Creature — Bear', oracle_text: '',
  mana_cost: '{4}{G}', cmc: 5, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'],
  power: 5, toughness: 5,
};

const DEFS = new Map<string, CardDefinition>([
  ['forest', forest], ['snowforest', snowForest], ['bear', bear], ['smallbear', smallBear],
  ['bolt', bolt], ['artifact', artifact], ['shrine', shrine], ['expensivebear', expensiveBear],
]);

function makeInstance(id: string, defId: string, zone: CardInstance['zone'], ownerId = 'p0'): CardInstance {
  return { instanceId: id, definitionId: defId, ownerId, zone, tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false };
}

function buildState(libDefs: string[], battlefieldDefs: string[] = [], p0Life = 20): GameState {
  const cards = new Map<string, CardInstance>();
  battlefieldDefs.forEach((d, i) => cards.set(`bf${i}`, makeInstance(`bf${i}`, d, 'battlefield')));
  libDefs.forEach((d, i) => cards.set(`lib${i}`, makeInstance(`lib${i}`, d, 'library')));
  const players = [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')];
  players[0] = { ...players[0], life: p0Life };
  return {
    players,
    cards,
    cardDefinitions: DEFS,
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat',
    turnNumber: 2, hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function zoneIds(s: GameState, zone: CardInstance['zone']): string[] {
  return [...s.cards.values()].filter(c => c.zone === zone).map(c => c.instanceId);
}

// ═══════════════════════════════════════════════════════════════
// 1. Reorder-top family
// ═══════════════════════════════════════════════════════════════

describe('reorder-top family (Sage Owl / Elemental Augury)', () => {
  const sageOwlText =
    'When Sage Owl enters the battlefield, look at the top four cards of your library, then put them back in any order.';
  const elementalAuguryText =
    'Look at the top three cards of target player\'s library, then put them back in any order.';

  it('Sage Owl ETB: parses to ChooseFromTopOfLibrary with restDestination top', () => {
    const p = parseOracleText(sageOwlText);
    if (p.kind !== 'ETB') throw new Error(`expected ETB, got ${p.kind}`);
    const e = p.ability.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.count).toBe(4);
    expect(e.maxSelections).toBe(0);
    expect(e.restDestination).toBe('top');
    expect(e.player).toEqual({ kind: 'Controller' });
  });

  it('Sage Owl ETB: all top N cards remain in the library (no zone change)', () => {
    const p = parseOracleText(sageOwlText);
    if (p.kind !== 'ETB') throw new Error('x');
    const s0 = buildState(['bear', 'bolt', 'forest', 'artifact', 'shrine']);
    const s = executeEffects(s0, p.ability.effects, 'p0', [], []);
    // All library cards stay in the library (no card moved to hand/graveyard).
    expect(zoneIds(s, 'library')).toHaveLength(5);
    expect(zoneIds(s, 'hand')).toHaveLength(0);
    expect(zoneIds(s, 'graveyard')).toHaveLength(0);
  });

  it('Elemental Augury (activated ability on target player library): parses to ChooseFromTopOfLibrary with target', () => {
    // Bare spell wording (activated ability body)
    const text = 'Look at the top three cards of target player\'s library, then put them back in any order.';
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.count).toBe(3);
    expect(e.maxSelections).toBe(0);
    expect(e.restDestination).toBe('top');
    // Player should be a Chosen target ref (from the target player spec).
    expect(e.player.kind).toBe('Chosen');
    // There should be exactly one target spec for the player.
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
  });

  it('reorder-top does not conflict with the existing matchLookAtTopPutOneIntoHand matcher', () => {
    // This wording (no "back", no "any order") should still go to SearchLibrary.
    const p = parseOracleText(
      'Look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.'
    );
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    expect(p.effects[0].kind).toBe('SearchLibrary');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Plural/up-to-N filter with extended support
// ═══════════════════════════════════════════════════════════════

describe('plural/up-to-N filter (Forging the Anchor / Glacial Revelation / Knight-Errant of Eos)', () => {
  describe('Forging the Anchor — "reveal any number ... and put them into your hand"', () => {
    const text =
      'Look at the top five cards of your library. Reveal any number of artifact cards from among them and put them into your hand. Put the rest on the bottom of your library in a random order.';

    it('parses to ChooseFromTopOfLibrary with artifact filter', () => {
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
      const e = p.effects[0];
      if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
      expect(e.count).toBe(5);
      expect(e.restDestination).toBe('bottom');
      expect(e.minSelections).toBe(0);
      expect(e.filter).toEqual({ types: ['artifact'] });
    });

    it('puts only artifact cards into hand and bottoms the rest', () => {
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error('x');
      const s = executeEffects(
        buildState(['artifact', 'bear', 'artifact', 'bolt', 'forest', 'bear']),
        p.effects, 'p0', [], []
      );
      expect(zoneIds(s, 'hand').sort()).toEqual(['lib0', 'lib2']);
      expect(zoneIds(s, 'library')).toHaveLength(4); // 3 non-artifact bottomed + 1 unrevealed
    });
  });

  describe('Glacial Revelation — "put any number of snow permanent cards"', () => {
    const text =
      'Look at the top five cards of your library. Put any number of snow permanent cards from among them into your hand. Put the rest on the bottom of your library in a random order.';

    it('parses to ChooseFromTopOfLibrary with snow+permanent filter', () => {
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
      const e = p.effects[0];
      if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
      expect(e.count).toBe(5);
      expect(e.restDestination).toBe('bottom');
      expect(e.filter).toMatchObject({ supertypes: ['snow'], permanent: true });
    });
  });

  describe('Knight-Errant of Eos — "creature cards with mana value 2 or less"', () => {
    const text =
      'Look at the top five cards of your library. You may put any number of creature cards with mana value 2 or less from among them into your hand. Put the rest on the bottom of your library in a random order.';

    it('parses to ChooseFromTopOfLibrary with creature + cmc lte 2 filter', () => {
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
      const e = p.effects[0];
      if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
      expect(e.count).toBe(5);
      expect(e.restDestination).toBe('bottom');
      expect(e.filter).toMatchObject({ types: ['creature'], cmc: { op: 'lte', value: 2 } });
    });

    it('takes creatures with cmc <= 2 only; expensive creature stays on the bottom', () => {
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error('x');
      // Top 5: small bear (cmc 1), bear (cmc 2), expensive bear (cmc 5), bolt, forest
      const s = executeEffects(
        buildState(['smallbear', 'bear', 'expensivebear', 'bolt', 'forest', 'artifact']),
        p.effects, 'p0', [], []
      );
      // Small bear (cmc 1) and bear (cmc 2) go to hand; expensive bear (cmc 5) stays.
      const hand = zoneIds(s, 'hand').sort();
      expect(hand).toEqual(['lib0', 'lib1']);
      expect(zoneIds(s, 'library')).toHaveLength(4); // expensivebear + bolt + forest bottomed + 1 unrevealed
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Dark Confidant upkeep-reveal family
// ═══════════════════════════════════════════════════════════════

describe('Dark Confidant upkeep-reveal family', () => {
  const darkConfidantText =
    'At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.';

  it('parses to an Upkeep-triggered ability with RevealTopMatch + LoseLife', () => {
    const p = parseOracleText(darkConfidantText);
    if (p.kind !== 'Triggered') throw new Error(`expected Triggered, got ${p.kind}`);
    expect(p.ability.trigger.kind).toBe('Upkeep');
    expect(p.ability.effects).toHaveLength(2);
    const [reveal, lose] = p.ability.effects;
    expect(reveal.kind).toBe('RevealTopMatch');
    if (reveal.kind !== 'RevealTopMatch') throw new Error('x');
    expect(reveal.filter).toEqual({});
    expect(reveal.matchDestination).toBe('hand');
    expect(lose.kind).toBe('LoseLife');
    if (lose.kind !== 'LoseLife') throw new Error('x');
    expect(lose.amount).toEqual({ kind: 'RevealedTopCardManaValue' });
  });

  it('moves top card to hand and loses life equal to its cmc', () => {
    const p = parseOracleText(darkConfidantText);
    if (p.kind !== 'Triggered') throw new Error('x');
    // Top card is bear (cmc 2).
    const s0 = buildState(['bear', 'bolt'], [], 20);
    const s = executeEffects(s0, p.ability.effects, 'p0', [], []);
    // Bear moved to hand.
    expect(s.cards.get('lib0')!.zone).toBe('hand');
    // p0 lost 2 life (bear's cmc).
    expect(s.players[0].life).toBe(18);
    // lib1 (bolt) untouched in library.
    expect(s.cards.get('lib1')!.zone).toBe('library');
  });

  it('loses 0 life for a 0-cmc card', () => {
    const p = parseOracleText(darkConfidantText);
    if (p.kind !== 'Triggered') throw new Error('x');
    // Top card is forest (cmc 0).
    const s0 = buildState(['forest', 'bear'], [], 20);
    const s = executeEffects(s0, p.ability.effects, 'p0', [], []);
    expect(s.cards.get('lib0')!.zone).toBe('hand');
    expect(s.players[0].life).toBe(20); // no life lost for cmc 0
  });

  it('loses life equal to higher cmc cards (bolt cmc 1, expensive bear cmc 5)', () => {
    const p = parseOracleText(darkConfidantText);
    if (p.kind !== 'Triggered') throw new Error('x');
    const s1 = executeEffects(buildState(['bolt'], [], 20), p.ability.effects, 'p0', [], []);
    expect(s1.players[0].life).toBe(19); // bolt cmc 1

    const s2 = executeEffects(buildState(['expensivebear'], [], 20), p.ability.effects, 'p0', [], []);
    expect(s2.players[0].life).toBe(15); // expensivebear cmc 5
  });

  it('older "converted mana value" wording also parses correctly', () => {
    const oldText =
      'At the beginning of your upkeep, reveal the top card of your library and put it into your hand. You lose life equal to its converted mana value.';
    const p = parseOracleText(oldText);
    if (p.kind !== 'Triggered') throw new Error(`expected Triggered, got ${p.kind}`);
    const [reveal, lose] = p.ability.effects;
    expect(reveal.kind).toBe('RevealTopMatch');
    expect(lose.kind).toBe('LoseLife');
    if (lose.kind !== 'LoseLife') throw new Error('x');
    expect(lose.amount).toEqual({ kind: 'RevealedTopCardManaValue' });
  });

  it('handles empty library gracefully (no card revealed, 0 life lost)', () => {
    const p = parseOracleText(darkConfidantText);
    if (p.kind !== 'Triggered') throw new Error('x');
    const s0 = buildState([], [], 20); // empty library
    const s = executeEffects(s0, p.ability.effects, 'p0', [], []);
    expect(s.players[0].life).toBe(20); // no life change
    expect(zoneIds(s, 'hand')).toHaveLength(0);
  });
});
