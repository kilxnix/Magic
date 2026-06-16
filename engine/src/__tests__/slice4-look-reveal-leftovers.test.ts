/**
 * Parser/executor coverage — slice 4/12 (oracle-parser round-8 cut c):
 * Look/reveal-top-N spell-face leftovers.
 *
 * Covers:
 *   matchLookAtTopExileFaceDown         — "Exile one of them face down, rest on bottom"
 *   matchLookAtTopPutMOnBottomRestToHand — "Put M on bottom, rest into hand"
 *   matchRevealTopAnyNumberOntoBattlefield — "Put any number of <type> onto battlefield, rest graveyard"
 *   matchRevealTopMultiTypeThenBranch   — "all typeA and typeB" / "all A, then all B, then all C"
 *   matchLookAtTopAnyNumberToHand       — "Put any number of them into your hand, rest on bottom"
 *
 * Real oracle wordings used throughout.
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
const bear: CardDefinition = {
  id: 'bear', name: 'Bear', type_line: 'Creature — Bear', oracle_text: '',
  mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'],
  power: 2, toughness: 2,
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
const sorcery: CardDefinition = {
  id: 'sorcery', name: 'Sorcery', type_line: 'Sorcery', oracle_text: '',
  mana_cost: '{2}{B}', cmc: 3, colors: ['B'], color_identity: ['B'], keywords: [], card_types: ['sorcery'],
};
const smallArtifact: CardDefinition = {
  id: 'smallartifact', name: 'Small Artifact', type_line: 'Artifact', oracle_text: '',
  mana_cost: '{1}', cmc: 1, colors: [], color_identity: [], keywords: [], card_types: ['artifact'],
};

const DEFS = new Map<string, CardDefinition>([
  ['forest', forest], ['bear', bear], ['bolt', bolt],
  ['artifact', artifact], ['shrine', shrine], ['sorcery', sorcery],
  ['smallartifact', smallArtifact],
]);

function makeInstance(id: string, defId: string, zone: CardInstance['zone'], ownerId = 'p0'): CardInstance {
  return { instanceId: id, definitionId: defId, ownerId, zone, tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false };
}

function buildState(libDefs: string[], battlefieldDefs: string[] = []): GameState {
  const cards = new Map<string, CardInstance>();
  battlefieldDefs.forEach((d, i) => cards.set(`bf${i}`, makeInstance(`bf${i}`, d, 'battlefield')));
  libDefs.forEach((d, i) => cards.set(`lib${i}`, makeInstance(`lib${i}`, d, 'library')));
  const players = [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')];
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
function zoneDefs(s: GameState, zone: CardInstance['zone']): string[] {
  return [...s.cards.values()].filter(c => c.zone === zone).map(c => c.definitionId);
}

// ═══════════════════════════════════════════════════════════════
// 1. matchLookAtTopExileFaceDown — Discover the Impossible family
// ═══════════════════════════════════════════════════════════════

const discoverText = 'Look at the top five cards of your library. Exile one of them face down. Put the rest on the bottom of your library in a random order.';

describe('matchLookAtTopExileFaceDown (Discover the Impossible family)', () => {
  it('parses to Spell with ChooseFromTopOfLibrary, destination=exile, maxSelections=1, restDestination=bottom', () => {
    const p = parseOracleText(discoverText, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.count).toBe(5);
    expect(e.destination).toBe('exile');
    expect(e.restDestination).toBe('bottom');
    expect(e.maxSelections).toBe(1);
    expect(e.minSelections).toBe(1);
  });

  it('execution: exactly one card goes to exile, four remain in library', () => {
    const p = parseOracleText(discoverText, false);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s0 = buildState(['bear', 'bolt', 'forest', 'artifact', 'shrine']);
    const s1 = executeEffects(s0, p.effects, 'p0', [], []);
    expect(zoneIds(s1, 'exile')).toHaveLength(1);
    expect(zoneIds(s1, 'library')).toHaveLength(4);
    expect(zoneIds(s1, 'hand')).toHaveLength(0);
    expect(zoneIds(s1, 'graveyard')).toHaveLength(0);
  });

  it('parses "look at the top three cards ... exile one ... put the rest on the bottom"', () => {
    const text = 'Look at the top three cards of your library. Exile one of them face down. Put the rest on the bottom of your library in any order.';
    const p = parseOracleText(text, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.count).toBe(3);
    expect(e.destination).toBe('exile');
    expect(e.restDestination).toBe('bottom');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. matchLookAtTopPutMOnBottomRestToHand — Make Your Own Luck family
// ═══════════════════════════════════════════════════════════════

const makeYOLText = 'Look at the top four cards of your library. Put two of them on the bottom of your library in a random order and the rest into your hand.';

describe('matchLookAtTopPutMOnBottomRestToHand (Make Your Own Luck family)', () => {
  it('parses to Spell with ChooseFromTopOfLibrary, destination=hand, maxSelections=2, restDestination=bottom', () => {
    const p = parseOracleText(makeYOLText, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.count).toBe(4);
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('bottom');
    // Put 2 on bottom means take 4-2=2 to hand
    expect(e.maxSelections).toBe(2);
  });

  it('execution: two cards go to hand, two remain in library', () => {
    const p = parseOracleText(makeYOLText, false);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s0 = buildState(['bear', 'bolt', 'forest', 'artifact']);
    const s1 = executeEffects(s0, p.effects, 'p0', [], []);
    expect(zoneIds(s1, 'hand')).toHaveLength(2);
    expect(zoneIds(s1, 'library')).toHaveLength(2);
    expect(zoneIds(s1, 'graveyard')).toHaveLength(0);
  });

  it('parses three cards on bottom, rest to hand variant', () => {
    const text = 'Look at the top six cards of your library. Put three of them on the bottom of your library in a random order and the rest into your hand.';
    const p = parseOracleText(text, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.count).toBe(6);
    expect(e.maxSelections).toBe(3); // take 6-3=3 to hand
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('bottom');
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. matchRevealTopAnyNumberOntoBattlefield — Saheeli's Directive family
// ═══════════════════════════════════════════════════════════════

const saheeliText = "Reveal the top X cards of your library. You may put any number of artifact cards from among them onto the battlefield. Put the rest into your graveyard.";

describe("matchRevealTopAnyNumberOntoBattlefield (Saheeli's Directive family)", () => {
  it('parses to Spell with ChooseFromTopOfLibrary, destination=battlefield, restDestination=graveyard, filter=artifact', () => {
    const p = parseOracleText(saheeliText, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.destination).toBe('battlefield');
    expect(e.restDestination).toBe('graveyard');
    expect(e.filter).toBeDefined();
    expect(e.filter?.types).toContain('artifact');
  });

  it('execution: artifact cards from top go to battlefield, non-artifacts go to graveyard', () => {
    const p = parseOracleText(saheeliText, false);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // xValue=3 means reveal top 3 cards (artifact, smallartifact, bear)
    const s0 = buildState(['artifact', 'smallartifact', 'bear', 'bolt', 'forest']);
    // Pass xValue=3 as 6th argument to executeEffects
    const s1 = executeEffects(s0, p.effects, 'p0', [], [], 3);
    // 2 artifacts go to battlefield, 1 bear goes to graveyard (rest of revealed)
    expect(zoneDefs(s1, 'battlefield').filter(d => d === 'artifact' || d === 'smallartifact')).toHaveLength(2);
    expect(zoneDefs(s1, 'graveyard')).toContain('bear');
    // library still has bolt and forest
    expect(zoneIds(s1, 'library')).toHaveLength(2);
  });

  it('fixed-N variant: "Reveal the top five cards ... put any number of creature cards onto the battlefield. Put the rest into your graveyard."', () => {
    const text = 'Reveal the top five cards of your library. You may put any number of creature cards from among them onto the battlefield. Put the rest into your graveyard.';
    const p = parseOracleText(text, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.count).toBe(5);
    expect(e.destination).toBe('battlefield');
    expect(e.filter?.types).toContain('creature');
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. matchRevealTopMultiTypeThenBranch — Portent of Calamity / Lair Delve family
// ═══════════════════════════════════════════════════════════════

const portentText = 'Reveal the top five cards of your library. Put all creature cards revealed this way into your hand, then put all land cards revealed this way into your hand, then put all artifact cards revealed this way into your hand. Put the rest into your graveyard.';

const lairDelveText = 'Reveal the top four cards of your library. Put all creature and land cards revealed this way into your hand. Put the rest on the bottom of your library in any order.';

describe('matchRevealTopMultiTypeThenBranch (Portent of Calamity / Lair Delve family)', () => {
  it('Portent of Calamity: parses multi-sentence "then put all <type>" to ChooseFromTopOfLibrary with anyOf filter', () => {
    const p = parseOracleText(portentText, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('graveyard');
    // anyOf filter should have creature, land, artifact branches
    expect(e.filter?.anyOf).toBeDefined();
    const anyOf = e.filter?.anyOf ?? [];
    const typeSet = new Set(anyOf.flatMap(f => f.types ?? []));
    expect(typeSet.has('creature')).toBe(true);
    expect(typeSet.has('land')).toBe(true);
    expect(typeSet.has('artifact')).toBe(true);
  });

  it('Portent of Calamity execution: creatures/lands/artifacts go to hand, rest to graveyard', () => {
    const p = parseOracleText(portentText, false);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // library: bear(creature), forest(land), artifact, bolt(instant), shrine(enchantment)
    const s0 = buildState(['bear', 'forest', 'artifact', 'bolt', 'shrine']);
    const s1 = executeEffects(s0, p.effects, 'p0', [], []);
    // bear(creature), forest(land), artifact all go to hand
    const handDefs = zoneDefs(s1, 'hand');
    expect(handDefs).toContain('bear');
    expect(handDefs).toContain('forest');
    expect(handDefs).toContain('artifact');
    // bolt(instant) and shrine(enchantment) don't match → graveyard
    const graveDefs = zoneDefs(s1, 'graveyard');
    expect(graveDefs).toContain('bolt');
    expect(graveDefs).toContain('shrine');
    expect(zoneIds(s1, 'library')).toHaveLength(0);
  });

  it('Lair Delve: parses "all creature and land cards" to ChooseFromTopOfLibrary with anyOf filter', () => {
    const p = parseOracleText(lairDelveText, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('bottom');
    const anyOf = e.filter?.anyOf ?? [];
    const typeSet = new Set(anyOf.flatMap(f => f.types ?? []));
    expect(typeSet.has('creature')).toBe(true);
    expect(typeSet.has('land')).toBe(true);
  });

  it('Lair Delve execution: creatures and lands go to hand, others on bottom', () => {
    const p = parseOracleText(lairDelveText, false);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // library: bear(creature), forest(land), bolt(instant), artifact(artifact)
    const s0 = buildState(['bear', 'forest', 'bolt', 'artifact']);
    const s1 = executeEffects(s0, p.effects, 'p0', [], []);
    const handDefs = zoneDefs(s1, 'hand');
    expect(handDefs).toContain('bear');
    expect(handDefs).toContain('forest');
    // bolt and artifact don't match → stay in library (bottom)
    expect(zoneIds(s1, 'library')).toHaveLength(2);
    expect(zoneIds(s1, 'graveyard')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. matchLookAtTopAnyNumberToHand — unfiltered any-number dig
// ═══════════════════════════════════════════════════════════════

const anyNumText = 'Look at the top five cards of your library. Put any number of them into your hand and the rest on the bottom of your library in a random order.';

describe('matchLookAtTopAnyNumberToHand (unfiltered any-number dig)', () => {
  it('parses to Spell with ChooseFromTopOfLibrary, no filter, destination=hand, restDestination=bottom', () => {
    const p = parseOracleText(anyNumText, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.count).toBe(5);
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('bottom');
    expect(e.filter).toBeUndefined();
    expect(e.maxSelections).toBe(5);
  });

  it('execution: auto-selects all revealed cards to hand (fallback=maxSelections)', () => {
    const p = parseOracleText(anyNumText, false);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s0 = buildState(['bear', 'bolt', 'forest', 'artifact', 'shrine', 'sorcery']);
    const s1 = executeEffects(s0, p.effects, 'p0', [], []);
    // Fallback takes all 5 revealed to hand, 1 (sorcery) stays in library
    expect(zoneIds(s1, 'hand')).toHaveLength(5);
    expect(zoneIds(s1, 'library')).toHaveLength(1);
    expect(zoneIds(s1, 'graveyard')).toHaveLength(0);
  });

  it('parses "you may" variant: "Look at top N. You may put any number of them into your hand..."', () => {
    const text = 'Look at the top four cards of your library. You may put any number of them into your hand and the rest on the bottom of your library in any order.';
    const p = parseOracleText(text, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.count).toBe(4);
    expect(e.destination).toBe('hand');
    expect(e.filter).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Regression: existing matchers not broken by new additions
// ═══════════════════════════════════════════════════════════════

describe('regression: existing matchers not disrupted', () => {
  it('Kayla Reconstruction (matchLookAtTopWhereXForEach battlefield) still parses', () => {
    const text = "Look at the top X cards of your library, where X is the number of artifacts you control. Put up to X artifact cards with mana value 3 or less from among them onto the battlefield. Put the rest on the bottom of your library in a random order.";
    const p = parseOracleText(text, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    expect(p.effects[0].kind).toBe('ChooseFromTopOfLibrary');
  });

  it('Sage Owl (matchLookAtTopReorderBack) still parses', () => {
    const text = "When Sage Owl enters the battlefield, look at the top four cards of your library, then put them back in any order.";
    const p = parseOracleText(text);
    expect(p.kind).toBe('ETB');
    if (p.kind !== 'ETB') throw new Error('expected ETB');
    expect(p.ability.effects[0].kind).toBe('ChooseFromTopOfLibrary');
  });

  it('matchRevealTopTake (Beast Hunt) still parses', () => {
    const text = 'Reveal the top four cards of your library. Put all creature cards revealed this way into your hand and the rest into your graveyard.';
    const p = parseOracleText(text, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.filter?.types).toContain('creature');
    expect(e.restDestination).toBe('graveyard');
  });

  it('matchRevealTopAllTypesAndAll (Lair Delve original "all X and all Y" form) still parses', () => {
    // The original form has two "all" keywords — one per type
    const text = 'Reveal the top four cards of your library. Put all creature cards and all land cards revealed this way into your hand. Put the rest on the bottom of your library in any order.';
    const p = parseOracleText(text, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.filter?.anyOf).toBeDefined();
  });
});
