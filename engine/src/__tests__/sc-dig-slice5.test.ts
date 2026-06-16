/**
 * Slice 5/12 oracle-parser coverage tests:
 * - matchRevealTopPutRevealedToHand: "reveal any number ... put the revealed cards into your hand"
 *   (Forging the Anchor) and "and/or" multi-type reveals (Gift of the Gargantuan).
 * - matchLookAtTopWhereXForEach: "look at the top X cards ..., where X is the number of
 *   <filter> you control" (Machinate, Stirring Honormancer, Kayla's Reconstruction).
 */
import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ---------------------------------------------------------------------------
// Shared card definitions
// ---------------------------------------------------------------------------
const forest: CardDefinition = {
  id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
  keywords: [], card_types: ['land'],
};
const bear: CardDefinition = {
  id: 'bear', name: 'Bear', type_line: 'Creature — Bear',
  oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 2, toughness: 2,
};
const bolt: CardDefinition = {
  id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant',
  oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'],
  keywords: [], card_types: ['instant'],
};
const axe: CardDefinition = {
  id: 'axe', name: 'Axe', type_line: 'Artifact — Equipment',
  oracle_text: '', mana_cost: '{2}', cmc: 2, colors: [], color_identity: [],
  keywords: [], card_types: ['artifact'],
};
const shrine: CardDefinition = {
  id: 'shrine', name: 'Shrine', type_line: 'Enchantment',
  oracle_text: '', mana_cost: '{1}{W}', cmc: 2, colors: ['W'], color_identity: ['W'],
  keywords: [], card_types: ['enchantment'],
};

const ALL_DEFS = new Map<string, CardDefinition>([
  ['forest', forest], ['bear', bear], ['bolt', bolt], ['axe', axe], ['shrine', shrine],
]);

function makeInstance(instanceId: string, defId: string, zone: CardInstance['zone']): CardInstance {
  return {
    instanceId, definitionId: defId, ownerId: 'p0', zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

/**
 * Build a state with library cards (top-first) and optional battlefield permanents.
 */
function makeState(libraryDefs: string[], battlefieldDefs: string[] = []): GameState {
  const cards = new Map<string, CardInstance>();
  battlefieldDefs.forEach((defId, i) => {
    cards.set(`bf${i}`, makeInstance(`bf${i}`, defId, 'battlefield'));
  });
  libraryDefs.forEach((defId, i) => {
    cards.set(`lib${i}`, makeInstance(`lib${i}`, defId, 'library'));
  });
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards,
    cardDefinitions: ALL_DEFS,
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function zoneIds(s: GameState, zone: CardInstance['zone']): string[] {
  return [...s.cards.values()].filter(c => c.zone === zone).map(c => c.instanceId).sort();
}

// ---------------------------------------------------------------------------
// 1. matchRevealTopPutRevealedToHand — "any number" variant (Forging the Anchor)
// ---------------------------------------------------------------------------
describe('Slice 5 — Forging the Anchor: "reveal any number ... put the revealed cards"', () => {
  const ANCHOR_TEXT =
    'Look at the top five cards of your library. You may reveal any number of artifact cards from among them and put the revealed cards into your hand. Put the rest on the bottom of your library in any order.';

  it('parses into ChooseFromTopOfLibrary with artifact filter and unlimited maxSelections', () => {
    const p = parseOracleText(ANCHOR_TEXT);
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary, got ' + e.kind);
    expect(e.count).toBe(5);
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('bottom');
    expect(e.minSelections).toBe(0);
    // maxSelections = revealN (all artifacts up to 5 may be taken)
    expect(e.maxSelections).toBe(5);
    expect(e.filter).toEqual({ types: ['artifact'] });
  });

  it('takes all revealed artifacts into hand; non-artifacts go to bottom', () => {
    const p = parseOracleText(ANCHOR_TEXT);
    if (p.kind !== 'Spell') throw new Error('x');
    // Top 5: axe, bear, axe, bolt, forest ; plus 1 more untouched
    const s = executeEffects(
      makeState(['axe', 'bear', 'axe', 'bolt', 'forest', 'forest']),
      p.effects, 'p0', [], [],
    );
    // 2 artifacts taken into hand
    expect(zoneIds(s, 'hand')).toEqual(['lib0', 'lib2']);
    // 3 non-artifacts bottomed
    expect(zoneIds(s, 'library')).toContain('lib5'); // unrevealed
    expect(zoneIds(s, 'library').length).toBe(4); // 6 - 2 taken
  });

  it('takes nothing when no artifact is among the top N; all bottomed', () => {
    const p = parseOracleText(ANCHOR_TEXT);
    if (p.kind !== 'Spell') throw new Error('x');
    const s = executeEffects(
      makeState(['bear', 'bolt', 'forest', 'bear', 'bolt', 'forest']),
      p.effects, 'p0', [], [],
    );
    expect(zoneIds(s, 'hand')).toHaveLength(0);
    expect(zoneIds(s, 'library').length).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// 2. matchRevealTopPutRevealedToHand — "and/or" variant (Gift of the Gargantuan)
// ---------------------------------------------------------------------------
describe('Slice 5 — Gift of the Gargantuan: "and/or" multi-type put-revealed', () => {
  const GIFT_TEXT =
    'Look at the top four cards of your library. You may reveal a creature card and/or a land card from among them and put the revealed cards into your hand. Put the rest on the bottom of your library.';

  it('parses into ChooseFromTopOfLibrary with anyOf creature/land filter and maxPerAnyOfBranch=1', () => {
    const p = parseOracleText(GIFT_TEXT);
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary, got ' + e.kind);
    expect(e.count).toBe(4);
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('bottom');
    expect(e.minSelections).toBe(0);
    expect(e.maxSelections).toBe(2); // one per branch
    expect(e.maxPerAnyOfBranch).toBe(1);
    expect(e.filter).toEqual({ anyOf: [{ types: ['creature'] }, { types: ['land'] }] });
  });

  it('takes at most one creature and one land; non-matching cards go to bottom', () => {
    const p = parseOracleText(GIFT_TEXT);
    if (p.kind !== 'Spell') throw new Error('x');
    // Top 4: bear, forest, bear, bolt — plus 2 untouched
    const s = executeEffects(
      makeState(['bear', 'forest', 'bear', 'bolt', 'forest', 'axe']),
      p.effects, 'p0', [], [],
    );
    // First creature (lib0) + first land (lib1) taken; second bear and bolt are rest
    expect(zoneIds(s, 'hand')).toEqual(['lib0', 'lib1']);
    // bolt (lib3) and second bear (lib2) → bottom
    expect(zoneIds(s, 'library').length).toBe(4); // 6 - 2 taken
    // Untouched cards stay in library
    expect(zoneIds(s, 'library')).toContain('lib4');
    expect(zoneIds(s, 'library')).toContain('lib5');
  });
});

// ---------------------------------------------------------------------------
// 3. matchLookAtTopWhereXForEach — "one into hand" variant (Machinate)
// ---------------------------------------------------------------------------
describe('Slice 5 — Machinate: "look at top X where X is the number of artifacts"', () => {
  const MACHINATE_TEXT =
    'Look at the top X cards of your library, where X is the number of artifacts you control. Put one into your hand and the rest on the bottom of your library in any order.';

  it('parses into ChooseFromTopOfLibrary with ForEach count (artifacts you control)', () => {
    const p = parseOracleText(MACHINATE_TEXT);
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary, got ' + e.kind);
    expect(e.count).toEqual({ kind: 'ForEach', zone: 'battlefield', controller: 'you', filter: { types: ['artifact'] } });
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('bottom');
    expect(e.maxSelections).toBe(1);
    expect(e.fallbackSelectionCount).toBe(1);
  });

  it('looks at top 2 and takes the first when controller has 2 artifacts', () => {
    const p = parseOracleText(MACHINATE_TEXT);
    if (p.kind !== 'Spell') throw new Error('x');
    // 2 artifacts on battlefield → look at top 2; take 1 into hand
    const s = executeEffects(
      makeState(['bear', 'bolt', 'forest'], ['axe', 'axe']),
      p.effects, 'p0', [], [],
    );
    expect(zoneIds(s, 'hand')).toHaveLength(1);
    expect(zoneIds(s, 'hand')).toContain('lib0'); // first card taken
    // lib1 goes to bottom; lib2 stays untouched
    expect(zoneIds(s, 'library').length).toBe(2);
  });

  it('looks at 0 cards when no artifacts are controlled', () => {
    const p = parseOracleText(MACHINATE_TEXT);
    if (p.kind !== 'Spell') throw new Error('x');
    // 0 artifacts → look at 0, take 0
    const s = executeEffects(
      makeState(['bear', 'forest', 'bolt']),
      p.effects, 'p0', [], [],
    );
    expect(zoneIds(s, 'hand')).toHaveLength(0);
    expect(zoneIds(s, 'library').length).toBe(3); // library unchanged
  });
});

// ---------------------------------------------------------------------------
// 4. matchLookAtTopWhereXForEach — ETB variant (Stirring Honormancer)
// ---------------------------------------------------------------------------
describe('Slice 5 — Stirring Honormancer ETB: "where X is the number of creatures you control"', () => {
  const HONORMANCER_TEXT =
    'When this creature enters, look at the top X cards of your library, where X is the number of creatures you control. Put one into your hand and the rest on the bottom of your library in any order.';

  it('parses as an ETB triggered ability with ForEach creature count', () => {
    const p = parseOracleText(HONORMANCER_TEXT);
    if (p.kind !== 'ETB') throw new Error('expected ETB, got ' + p.kind);
    const eff = p.ability.effects[0];
    if (eff.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary, got ' + eff.kind);
    expect(eff.count).toEqual({ kind: 'ForEach', zone: 'battlefield', controller: 'you', filter: { types: ['creature'] } });
    expect(eff.destination).toBe('hand');
    expect(eff.maxSelections).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. matchLookAtTopWhereXForEach — battlefield variant (Kayla's Reconstruction)
// ---------------------------------------------------------------------------
describe("Slice 5 — Kayla's Reconstruction: 'put up to X <filter> cards onto the battlefield'", () => {
  const KAYLA_TEXT =
    "Look at the top X cards of your library, where X is the number of artifacts you control. Put up to X artifact cards from among them onto the battlefield. Put the rest on the bottom of your library in any order.";

  it('parses into ChooseFromTopOfLibrary with ForEach count and battlefield destination', () => {
    const p = parseOracleText(KAYLA_TEXT);
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary, got ' + e.kind);
    expect(e.count).toEqual({ kind: 'ForEach', zone: 'battlefield', controller: 'you', filter: { types: ['artifact'] } });
    expect(e.destination).toBe('battlefield');
    expect(e.restDestination).toBe('bottom');
    expect(e.filter).toEqual({ types: ['artifact'] });
    expect(e.minSelections).toBe(0);
  });

  it('puts matching artifacts onto battlefield and bottoms non-artifacts; with 2 artifacts controlled', () => {
    const p = parseOracleText(KAYLA_TEXT);
    if (p.kind !== 'Spell') throw new Error('x');
    // 2 artifacts controlled → look at top 2; both are artifacts → can go to battlefield
    const s = executeEffects(
      makeState(['axe', 'bear', 'forest'], ['axe', 'axe']),
      p.effects, 'p0', [], [],
    );
    // lib0 (axe) should go to battlefield; lib1 (bear) is a non-artifact that matched no filter
    const bf = zoneIds(s, 'battlefield');
    expect(bf).toContain('lib0');
    // bear and the original artifacts remain on battlefield too
    expect(bf.length).toBeGreaterThanOrEqual(3); // 2 controlled + lib0
  });
});
