import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

const forest: CardDefinition = { id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [], card_types: ['land'] };
const island: CardDefinition = { id: 'island', name: 'Island', type_line: 'Basic Land — Island', oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['U'], keywords: [], card_types: ['land'] };
const bear: CardDefinition = { id: 'bear', name: 'Bear', type_line: 'Creature — Bear', oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'], power: 2, toughness: 2 };
const bolt: CardDefinition = { id: 'bolt', name: 'Bolt', type_line: 'Instant', oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'], keywords: [], card_types: ['instant'] };
const shrine: CardDefinition = { id: 'shrine', name: 'Shrine', type_line: 'Enchantment', oracle_text: '', mana_cost: '{1}{W}', cmc: 2, colors: ['W'], color_identity: ['W'], keywords: [], card_types: ['enchantment'] };

const DEFS = new Map<string, CardDefinition>([
  ['forest', forest], ['island', island], ['bear', bear], ['bolt', bolt], ['shrine', shrine],
]);

function makeInstance(instanceId: string, defId: string, zone: CardInstance['zone']): CardInstance {
  return {
    instanceId, definitionId: defId, ownerId: 'p0', zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

/**
 * Build a state whose library (in iteration order = top-first) is the given def
 * ids, optionally with battlefield permanents (all owned by p0).
 */
function state(libraryDefs: string[], battlefieldDefs: string[] = []): GameState {
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
    cardDefinitions: DEFS,
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function zoneIds(s: GameState, zone: CardInstance['zone']): string[] {
  return [...s.cards.values()].filter(c => c.zone === zone).map(c => c.instanceId);
}

describe('library-dig variants (slice 3)', () => {
  describe('and/or filtered take with rest to graveyard (Benefaction of Rhonas)', () => {
    const text = 'Reveal the top five cards of your library. You may put a creature card and/or an enchantment card from among them into your hand. Put the rest into your graveyard.';

    it('parses to a filtered ChooseFromTopOfLibrary capped at one card per type', () => {
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error('expected Spell');
      expect(p.effects).toHaveLength(1);
      const e = p.effects[0];
      if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary');
      expect(e.count).toBe(5);
      expect(e.destination).toBe('hand');
      expect(e.restDestination).toBe('graveyard');
      expect(e.minSelections).toBe(0);
      expect(e.maxSelections).toBe(2);
      expect(e.maxPerAnyOfBranch).toBe(1);
      expect(e.filter).toEqual({ anyOf: [{ types: ['creature'] }, { types: ['enchantment'] }] });
    });

    it('takes at most ONE creature and ONE enchantment; the rest go to the graveyard', () => {
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error('x');
      // Top 5: bear, bear, shrine, bolt, forest ; plus a 6th card untouched.
      const s = executeEffects(state(['bear', 'bear', 'shrine', 'bolt', 'forest', 'forest']), p.effects, 'p0', [], []);
      // First creature + the enchantment to hand — NOT both bears.
      expect(zoneIds(s, 'hand').sort()).toEqual(['lib0', 'lib2']);
      // The other three revealed cards go to the graveyard.
      expect(zoneIds(s, 'graveyard').sort()).toEqual(['lib1', 'lib3', 'lib4']);
      // The unrevealed 6th card stays in the library.
      expect(zoneIds(s, 'library')).toEqual(['lib5']);
    });
  });

  describe('"put all <type> cards revealed this way" with rest to graveyard (Beast Hunt)', () => {
    const text = 'Reveal the top three cards of your library. Put all creature cards revealed this way into your hand and the rest into your graveyard.';

    it('parses with a creature filter and graveyard rest', () => {
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error('expected Spell');
      const e = p.effects[0];
      if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary');
      expect(e.count).toBe(3);
      expect(e.restDestination).toBe('graveyard');
      expect(e.maxSelections).toBe(3);
      expect(e.filter).toEqual({ types: ['creature'] });
    });

    it('takes every revealed creature into hand and bins the rest', () => {
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error('x');
      const s = executeEffects(state(['bear', 'forest', 'bear', 'bolt']), p.effects, 'p0', [], []);
      expect(zoneIds(s, 'hand').sort()).toEqual(['lib0', 'lib2']);
      expect(zoneIds(s, 'graveyard')).toEqual(['lib1']);
      expect(zoneIds(s, 'library')).toEqual(['lib3']); // unrevealed card untouched
    });
  });

  describe('Domain X-count dig (Worldly Counsel)', () => {
    const text = 'Domain — Look at the top X cards of your library, where X is the number of basic land types among lands you control. Put one of those cards into your hand and the rest on the bottom of your library in any order.';

    it('parses the X count into a DomainCount amount', () => {
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error('expected Spell');
      const e = p.effects[0];
      if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary');
      expect(e.count).toEqual({ kind: 'DomainCount' });
      expect(e.destination).toBe('hand');
      expect(e.restDestination).toBe('bottom');
      expect(e.maxSelections).toBe(1);
      expect(e.fallbackSelectionCount).toBe(1);
    });

    it('digs as deep as the number of basic land types you control', () => {
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error('x');
      // Two basic land types (Forest + Island, second Forest adds nothing) -> X = 2.
      const s0 = state(['bolt', 'bear', 'shrine'], ['forest', 'island', 'forest']);
      const s = executeEffects(s0, p.effects, 'p0', [], []);
      expect(zoneIds(s, 'hand')).toEqual(['lib0']); // takes the first revealed card
      // The other revealed card was bottomed; the third was never revealed.
      expect(zoneIds(s, 'library').sort()).toEqual(['lib1', 'lib2']);
    });

    it('reveals nothing with zero basic land types', () => {
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error('x');
      const s = executeEffects(state(['bolt', 'bear']), p.effects, 'p0', [], []);
      expect(zoneIds(s, 'hand')).toEqual([]);
      expect(zoneIds(s, 'library').length).toBe(2);
    });
  });

  describe('top-card conditional onto the battlefield tapped (Lantern of Revealing)', () => {
    const text = "{4}, {T}: Look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped.";

    it('parses as an activated ability with a battlefield RevealTopMatch', () => {
      const p = parseOracleText(text);
      if (p.kind !== 'Activated') throw new Error('expected Activated');
      expect(p.abilities).toHaveLength(1);
      const e = p.abilities[0].effects[0];
      if (e.kind !== 'RevealTopMatch') throw new Error('expected RevealTopMatch');
      expect(e.filter).toEqual({ types: ['land'] });
      expect(e.matchDestination).toBe('battlefield');
      expect(e.tapped).toBe(true);
    });

    it('puts a matching land onto the battlefield tapped', () => {
      const p = parseOracleText(text);
      if (p.kind !== 'Activated') throw new Error('x');
      const s = executeEffects(state(['forest', 'bear']), p.abilities[0].effects, 'p0', [], []);
      expect(s.cards.get('lib0')!.zone).toBe('battlefield');
      expect(s.cards.get('lib0')!.tapped).toBe(true);
      expect(s.cards.get('lib1')!.zone).toBe('library');
    });

    it('leaves a non-matching top card on the library', () => {
      const p = parseOracleText(text);
      if (p.kind !== 'Activated') throw new Error('x');
      const s = executeEffects(state(['bear', 'forest']), p.abilities[0].effects, 'p0', [], []);
      expect(s.cards.get('lib0')!.zone).toBe('library');
      expect(zoneIds(s, 'battlefield')).toEqual([]);
    });
  });

  describe('dig shapes inside trigger bodies (Kaslem\'s Stonetree family)', () => {
    it('parses an ETB "look at the top six ... put up to one of them" dig', () => {
      const p = parseOracleText('When this artifact enters, look at the top six cards of your library. Put up to one of them into your hand and the rest on the bottom of your library in a random order.');
      if (p.kind !== 'ETB') throw new Error('expected ETB');
      const e = p.ability.effects[0];
      if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary');
      expect(e.count).toBe(6);
      expect(e.maxSelections).toBe(1);
      expect(e.restDestination).toBe('bottom');

      const s = executeEffects(state(['bolt', 'bear', 'forest', 'shrine', 'bear', 'bolt', 'forest']), p.ability.effects, 'p0', [], []);
      expect(zoneIds(s, 'hand')).toEqual(['lib0']);
      expect(zoneIds(s, 'library').length).toBe(6); // 5 bottomed + 1 unrevealed
    });

    it('parses an ETB reveal-take with an and/or filter', () => {
      const p = parseOracleText('When this creature enters, reveal the top four cards of your library. You may put a creature card and/or a land card from among them into your hand. Put the rest into your graveyard.');
      if (p.kind !== 'ETB') throw new Error('expected ETB');
      const e = p.ability.effects[0];
      if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary');
      expect(e.count).toBe(4);
      expect(e.maxPerAnyOfBranch).toBe(1);
      expect(e.restDestination).toBe('graveyard');
    });
  });

  describe('mandatory take-one with rest to graveyard (Strategic Planning)', () => {
    const text = 'Look at the top three cards of your library. Put one of them into your hand and the rest into your graveyard.';

    it('parses and executes with graveyard rest', () => {
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error('expected Spell');
      const e = p.effects[0];
      if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary');
      expect(e.count).toBe(3);
      expect(e.restDestination).toBe('graveyard');
      expect(e.maxSelections).toBe(1);

      const s = executeEffects(state(['bear', 'bolt', 'forest', 'forest']), p.effects, 'p0', [], []);
      expect(zoneIds(s, 'hand')).toEqual(['lib0']);
      expect(zoneIds(s, 'graveyard').sort()).toEqual(['lib1', 'lib2']);
      expect(zoneIds(s, 'library')).toEqual(['lib3']);
    });

    it('honors an explicitly submitted selection', () => {
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error('x');
      const s = executeEffects(state(['bear', 'bolt', 'forest']), p.effects, 'p0', [], [], 0, {
        namedCardChoices: { digTopTakeIds: 'lib2' },
      });
      expect(zoneIds(s, 'hand')).toEqual(['lib2']);
      expect(zoneIds(s, 'graveyard').sort()).toEqual(['lib0', 'lib1']);
    });
  });

  describe('regression guards', () => {
    it('keeps the existing SearchLibrary parse for take-one digs with bottom rest (Anticipate)', () => {
      const p = parseOracleText('Look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.');
      if (p.kind !== 'Spell') throw new Error('expected Spell');
      expect(p.effects[0].kind).toBe('SearchLibrary');
    });

    it('keeps the existing hand/graveyard RevealTopMatch wordings parsing', () => {
      const p = parseOracleText("Reveal the top card of your library. If it's a land card, put it into your hand.");
      if (p.kind !== 'Spell') throw new Error('expected Spell');
      const e = p.effects[0];
      if (e.kind !== 'RevealTopMatch') throw new Error('expected RevealTopMatch');
      expect(e.matchDestination).toBe('hand');
      expect(e.tapped).toBeUndefined();
    });
  });
});
