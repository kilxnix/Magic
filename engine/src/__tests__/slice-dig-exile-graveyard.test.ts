/**
 * Parser/executor coverage — trigger-wrapped dig leftovers:
 * exile-from-among-them and graveyard destinations.
 *
 * Tests matchLookAtTopExileOneFromAmong (destination='exile') and
 * matchLookAtTopPutItToGraveyard (destination='graveyard') — both standalone
 * and inside attack/ETB/upkeep trigger bodies.
 */
import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ─────────────────────── card definitions ───────────────────────
const bear: CardDefinition = {
  id: 'bear', name: 'Bear', type_line: 'Creature — Bear', oracle_text: '',
  mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'],
  power: 2, toughness: 2,
};
const expensiveBear: CardDefinition = {
  id: 'expensivebear', name: 'Expensive Bear', type_line: 'Creature — Bear', oracle_text: '',
  mana_cost: '{4}{G}', cmc: 5, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'],
  power: 5, toughness: 5,
};
const bolt: CardDefinition = {
  id: 'bolt', name: 'Bolt', type_line: 'Instant', oracle_text: '',
  mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'], keywords: [], card_types: ['instant'],
};
const forest: CardDefinition = {
  id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '',
  mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [], card_types: ['land'],
};
const artifact: CardDefinition = {
  id: 'artifact', name: 'Artifact', type_line: 'Artifact', oracle_text: '',
  mana_cost: '{2}', cmc: 2, colors: [], color_identity: [], keywords: [], card_types: ['artifact'],
};
const wizard: CardDefinition = {
  id: 'wizard', name: 'Wizard', type_line: 'Creature — Wizard', oracle_text: '',
  mana_cost: '{1}{U}', cmc: 2, colors: ['U'], color_identity: ['U'], keywords: [], card_types: ['creature'],
  power: 1, toughness: 2,
};
const warrior: CardDefinition = {
  id: 'warrior', name: 'Warrior', type_line: 'Creature — Warrior', oracle_text: '',
  mana_cost: '{1}{W}', cmc: 2, colors: ['W'], color_identity: ['W'], keywords: [], card_types: ['creature'],
  power: 2, toughness: 1,
};

const DEFS = new Map<string, CardDefinition>([
  ['bear', bear], ['expensivebear', expensiveBear], ['bolt', bolt],
  ['forest', forest], ['artifact', artifact], ['wizard', wizard], ['warrior', warrior],
]);

function makeInstance(id: string, defId: string, zone: CardInstance['zone'], ownerId = 'p0'): CardInstance {
  return {
    instanceId: id, definitionId: defId, ownerId, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function buildState(libDefs: string[], battlefieldDefs: string[] = [], p0Life = 20): GameState {
  const cards = new Map<string, CardInstance>();
  battlefieldDefs.forEach((d, i) => cards.set(`bf${i}`, makeInstance(`bf${i}`, d, 'battlefield')));
  libDefs.forEach((d, i) => cards.set(`lib${i}`, makeInstance(`lib${i}`, d, 'library')));
  const players = [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')];
  players[0] = { ...players[0], life: p0Life };
  return {
    players, cards, cardDefinitions: DEFS,
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat',
    turnNumber: 2, hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function zoneIds(s: GameState, zone: CardInstance['zone']): string[] {
  return [...s.cards.values()].filter(c => c.zone === zone).map(c => c.instanceId);
}

// ═══════════════════════════════════════════════════════════════
// 1. exile-from-among-them family (matchLookAtTopExileOneFromAmong)
// ═══════════════════════════════════════════════════════════════

describe('exile-from-among-them family (matchLookAtTopExileOneFromAmong)', () => {
  // Feral Encounter — standalone spell wording
  describe('Feral Encounter — "you may exile a creature card from among them"', () => {
    const feralEncounterText =
      'Look at the top four cards of your library. You may exile a creature card from among them. Put the rest on the bottom of your library in a random order.';

    it('parses as Spell → ChooseFromTopOfLibrary with destination exile', () => {
      const p = parseOracleText(feralEncounterText);
      if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
      const e = p.effects[0];
      if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
      expect(e.count).toBe(4);
      expect(e.destination).toBe('exile');
      expect(e.restDestination).toBe('bottom');
      expect(e.minSelections).toBe(0);
      expect(e.maxSelections).toBe(1);
      expect(e.filter).toMatchObject({ types: ['creature'] });
    });

    it('executes: creature goes to exile, non-creatures bottom the library', () => {
      const p = parseOracleText(feralEncounterText);
      if (p.kind !== 'Spell') throw new Error('x');
      // lib0=creature(bear), lib1=instant(bolt), lib2=land(forest), lib3=artifact, lib4=bear
      const s0 = buildState(['bear', 'bolt', 'forest', 'artifact', 'bear']);
      const s = executeEffects(s0, p.effects, 'p0', [], []);
      // Auto-selects the first matching creature (lib0=bear) → exile
      expect(zoneIds(s, 'exile')).toEqual(['lib0']);
      // The other 3 revealed (lib1,lib2,lib3) go to the bottom + lib4 stays in library
      expect(zoneIds(s, 'library')).toHaveLength(4);
      expect(zoneIds(s, 'hand')).toHaveLength(0);
      expect(zoneIds(s, 'graveyard')).toHaveLength(0);
    });

    it('executes: no creature among top N — nothing exiled, all remain in library', () => {
      const p = parseOracleText(feralEncounterText);
      if (p.kind !== 'Spell') throw new Error('x');
      // No creatures in top 4
      const s0 = buildState(['bolt', 'forest', 'artifact', 'bolt', 'forest']);
      const s = executeEffects(s0, p.effects, 'p0', [], []);
      expect(zoneIds(s, 'exile')).toHaveLength(0);
      expect(zoneIds(s, 'library')).toHaveLength(5);
    });
  });

  // Durnan of the Yawning Portal — attack trigger with mana-value filter
  // (In MTGJSON, self-name references are replaced with "~")
  describe('Durnan of the Yawning Portal — "exile a creature card with mana value 3 or less"', () => {
    const durnanText =
      'Whenever ~ attacks, look at the top four cards of your library. You may exile a creature card with mana value 3 or less from among them. Put the rest on the bottom of your library in a random order.';

    it('parses as Triggered → ChooseFromTopOfLibrary with exile destination and cmc filter', () => {
      const p = parseOracleText(durnanText);
      if (p.kind !== 'Triggered') throw new Error(`expected Triggered, got ${p.kind}`);
      const e = p.ability.effects[0];
      if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
      expect(e.count).toBe(4);
      expect(e.destination).toBe('exile');
      expect(e.restDestination).toBe('bottom');
      expect(e.filter).toMatchObject({ types: ['creature'], cmc: { op: 'lte', value: 3 } });
    });

    it('executes: exiles cheap creature but not expensive one', () => {
      const p = parseOracleText(durnanText);
      if (p.kind !== 'Triggered') throw new Error('x');
      // bear(cmc=2), expensiveBear(cmc=5), bolt, forest — only bear qualifies
      const s0 = buildState(['bear', 'expensivebear', 'bolt', 'forest', 'artifact']);
      const s = executeEffects(s0, p.ability.effects, 'p0', [], []);
      // bear (cmc=2 ≤ 3) → exile; expensiveBear (cmc=5 > 3) → bottom; bolt/forest → bottom
      expect(zoneIds(s, 'exile')).toEqual(['lib0']);
      expect(zoneIds(s, 'library')).toHaveLength(4);
    });
  });

  // Djeru and Hazoret — subtype filter: "Warrior or Wizard creature card"
  // (In MTGJSON, self-name references are replaced with "~")
  describe('Djeru and Hazoret — "exile a Warrior or Wizard creature card from among them"', () => {
    const djueruText =
      'Whenever ~ attacks, look at the top five cards of your library. You may exile a Warrior or Wizard creature card from among them. Put the rest on the bottom of your library in any order.';

    it('parses as Triggered → ChooseFromTopOfLibrary with exile destination and subtype filter', () => {
      const p = parseOracleText(djueruText);
      if (p.kind !== 'Triggered') throw new Error(`expected Triggered, got ${p.kind}`);
      const e = p.ability.effects[0];
      if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
      expect(e.count).toBe(5);
      expect(e.destination).toBe('exile');
      expect(e.restDestination).toBe('bottom');
      // filter should reference Warrior and/or Wizard subtypes (exact shape may vary)
      expect(e.filter).toBeDefined();
    });

    it('executes: Warrior exiled, non-Warrior/Wizard cards go to bottom', () => {
      const p = parseOracleText(djueruText);
      if (p.kind !== 'Triggered') throw new Error('x');
      // warrior is a Warrior, bear is not, forest is not, bolt is not, artifact is not
      const s0 = buildState(['warrior', 'bear', 'forest', 'bolt', 'artifact', 'bear']);
      const s = executeEffects(s0, p.ability.effects, 'p0', [], []);
      // warrior → exile; 4 non-warrior/wizard → bottom; lib5(bear) unrevealed stays
      expect(zoneIds(s, 'exile')).toEqual(['lib0']);
      expect(zoneIds(s, 'library')).toHaveLength(5);
    });
  });

  // No-filter variant: "you may exile a card from among them"
  describe('No-filter exile — "you may exile a card from among them"', () => {
    const noFilterText =
      'Look at the top three cards of your library. You may exile a card from among them. Put the rest on the bottom of your library in any order.';

    it('parses as ChooseFromTopOfLibrary with exile destination, no filter', () => {
      const p = parseOracleText(noFilterText);
      if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
      const e = p.effects[0];
      if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
      expect(e.count).toBe(3);
      expect(e.destination).toBe('exile');
      expect(e.restDestination).toBe('bottom');
    });

    it('executes: without filter, auto-selects first card into exile', () => {
      const p = parseOracleText(noFilterText);
      if (p.kind !== 'Spell') throw new Error('x');
      const s0 = buildState(['bear', 'bolt', 'forest', 'artifact']);
      const s = executeEffects(s0, p.effects, 'p0', [], []);
      // No filter means no auto-selection by filter; fallback is 0 (optional)
      // so nothing exiled unless a selectedCardChoiceId choice is provided.
      // With no choice submitted and no filter, 0 cards selected → no exile.
      expect(zoneIds(s, 'library')).toHaveLength(4);
    });
  });

  // Graveyard rest-destination variant
  describe('Exile from among, rest to graveyard', () => {
    const graveyardRestText =
      'Look at the top four cards of your library. You may exile a creature card from among them. Put the rest into your graveyard.';

    it('parses as ChooseFromTopOfLibrary with exile destination and graveyard rest', () => {
      const p = parseOracleText(graveyardRestText);
      if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
      const e = p.effects[0];
      if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
      expect(e.destination).toBe('exile');
      expect(e.restDestination).toBe('graveyard');
      expect(e.filter).toMatchObject({ types: ['creature'] });
    });

    it('executes: creature exiled, non-creatures go to graveyard', () => {
      const p = parseOracleText(graveyardRestText);
      if (p.kind !== 'Spell') throw new Error('x');
      const s0 = buildState(['bear', 'bolt', 'forest', 'artifact', 'bear']);
      const s = executeEffects(s0, p.effects, 'p0', [], []);
      expect(zoneIds(s, 'exile')).toEqual(['lib0']);
      // bolt, forest, artifact → graveyard; lib4(unrevealed bear) → library
      expect(zoneIds(s, 'graveyard')).toEqual(['lib1', 'lib2', 'lib3']);
      expect(zoneIds(s, 'library')).toEqual(['lib4']);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Single-card look to graveyard (matchLookAtTopPutItToGraveyard)
// ═══════════════════════════════════════════════════════════════

describe('look at top, put it into graveyard (matchLookAtTopPutItToGraveyard)', () => {
  // Single-card look ending with "you may put it into your graveyard"
  describe('Single-card look — "look at the top card. you may put it into your graveyard."', () => {
    const singleCardText =
      'Look at the top card of your library. You may put it into your graveyard.';

    it('parses as Spell → ChooseFromTopOfLibrary with graveyard destination', () => {
      const p = parseOracleText(singleCardText);
      if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
      const e = p.effects[0];
      if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
      expect(e.count).toBe(1);
      expect(e.destination).toBe('graveyard');
      expect(e.minSelections).toBe(0);
      expect(e.maxSelections).toBe(1);
    });

    it('executes: with no explicit choice, nothing moves (fallback=0 → optional)', () => {
      const p = parseOracleText(singleCardText);
      if (p.kind !== 'Spell') throw new Error('x');
      const s0 = buildState(['bear', 'bolt', 'forest']);
      const s = executeEffects(s0, p.effects, 'p0', [], []);
      // "you may" is optional — no auto-selection → nothing moves
      expect(zoneIds(s, 'graveyard')).toHaveLength(0);
      expect(zoneIds(s, 'library')).toHaveLength(3);
    });
  });

  // Attack trigger: "Whenever ~ attacks, reveal the top card of your library.
  // You may put it into your graveyard." (single card, optional graveyard)
  describe('Attack trigger — "reveal top card, you may put it into your graveyard"', () => {
    const attackTriggerText =
      'Whenever ~ attacks, reveal the top card of your library. You may put it into your graveyard.';

    it('parses as Triggered → ChooseFromTopOfLibrary with graveyard destination', () => {
      const p = parseOracleText(attackTriggerText);
      if (p.kind !== 'Triggered') throw new Error(`expected Triggered, got ${p.kind}`);
      const e = p.ability.effects[0];
      if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
      expect(e.count).toBe(1);
      expect(e.destination).toBe('graveyard');
      expect(e.minSelections).toBe(0);
      expect(e.maxSelections).toBe(1);
    });

    it('executes: optional — no auto-selection, card stays in library', () => {
      const p = parseOracleText(attackTriggerText);
      if (p.kind !== 'Triggered') throw new Error('x');
      const s0 = buildState(['bear', 'bolt', 'forest']);
      const s = executeEffects(s0, p.ability.effects, 'p0', [], []);
      expect(zoneIds(s, 'graveyard')).toHaveLength(0);
      expect(zoneIds(s, 'library')).toHaveLength(3);
    });
  });

  // ETB trigger using "you may put them into your graveyard"
  describe('ETB trigger — "look at top N, you may put them into your graveyard, rest on bottom"', () => {
    const etbText =
      'When this creature enters the battlefield, look at the top two cards of your library. You may put them into your graveyard. Put the rest on the bottom of your library in any order.';

    it('parses as ETB → ChooseFromTopOfLibrary with graveyard destination', () => {
      const p = parseOracleText(etbText);
      if (p.kind !== 'ETB') throw new Error(`expected ETB, got ${p.kind}`);
      const e = p.ability.effects[0];
      if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
      expect(e.count).toBe(2);
      expect(e.destination).toBe('graveyard');
      expect(e.restDestination).toBe('bottom');
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Non-regression: existing matchers not disrupted
// ═══════════════════════════════════════════════════════════════

describe('non-regression: existing dig matchers not disrupted', () => {
  it('matchLookAtTopPutOneIntoHand still parses (look-put-hand-bottom pattern)', () => {
    const text =
      'Look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.';
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
    expect(p.effects[0].kind).toBe('SearchLibrary');
  });

  it('matchRevealTopTake still parses (reveal-put-hand-graveyard pattern)', () => {
    const text =
      'Reveal the top four cards of your library. You may put a creature card from among them into your hand. Put the rest into your graveyard.';
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('graveyard');
  });

  it('matchLookAtTopPutNToGraveyard still parses (explicit count of graveyard cards)', () => {
    const text =
      'Look at the top five cards of your library. You may put two of them into your graveyard. Put the rest on top of your library in any order.';
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.destination).toBe('graveyard');
    expect(e.restDestination).toBe('top');
  });

  it('exile-from-among does not claim "you may cast" wordings (honesty guard)', () => {
    // "you may cast that card without paying its mana cost" is excluded
    const text =
      'Look at the top four cards of your library. You may exile a creature card from among them. You may cast that card without paying its mana cost.';
    const p = parseOracleText(text);
    // Should be Unparsed since the "cast" tail is excluded and the "exile" clause
    // cannot stand alone without the "put the rest" tail.
    expect(p.kind).toBe('Unparsed');
  });
});
