/**
 * ETB/attack dig trigger tails (slice 3/12: topLibrary family)
 *
 * Covers the named-card attacks trigger prefix and the trigger-tail bodies
 * (look/reveal top of library) for the ETB and attack trigger families:
 *
 * - Named-card attacks trigger: "Whenever [CardName] attacks, <dig body>"
 *   previously parsed as Spell; now correctly parses as Triggered.
 *   (Traveling Botanist, Parker Luck, Deceiver of Form families)
 *
 * - ETB dig trigger tails: "When this creature enters, look at the top N
 *   cards of your library. <filter take> Put the rest on the bottom."
 *   (Knight-Errant of Eos body with fixed N)
 *
 * - Dark Confidant reveal body in attack trigger context: "reveal the top
 *   card of your library and put that card into your hand. You lose life
 *   equal to its mana value." — RevealTopMatch + LoseLife(RevealedTopCardManaValue)
 *
 * - RevealTopIfMatchWithElse in attack trigger context: "If it's a land
 *   card, you may reveal it and put it into your hand."
 *   (Traveling Botanist oracle wording)
 *
 * Honesty: Deceiver of Form's "creatures you control become copies" tail is
 * declined (no copy-to-creature-shape subsystem). Knight-Errant's exact oracle
 * "where X is the number of creature spells you've cast this turn" is declined
 * (no cast-this-turn counter in executor). Both remain Unparsed — tests confirm.
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { initGameState } from '../game-state';
import {
  resolveTopOfStack,
  putTriggersOnStack,
  registerBattlefieldAbilities,
} from '../stack';
import { declareAttackers } from '../combat';

// ---------------------------------------------------------------------------
// Card definitions used in execution tests
// ---------------------------------------------------------------------------

const forestDef: CardDefinition = {
  id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
  keywords: [], card_types: ['land'],
};
const bearDef: CardDefinition = {
  id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear',
  oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 2, toughness: 2,
};
const boltDef: CardDefinition = {
  id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant',
  oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'],
  keywords: [], card_types: ['instant'],
};

// A creature with the Traveling Botanist attack-trigger body (named-card form)
function makeBotanistCreature(): CardDefinition {
  return {
    id: 'botanist', name: 'Traveling Botanist',
    type_line: 'Creature — Human Scout',
    oracle_text: "Whenever Traveling Botanist attacks, reveal the top card of your library. If it's a land card, you may reveal it and put it into your hand. If you don't, put it on the bottom of your library.",
    mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'],
    keywords: [], card_types: ['creature'], power: 2, toughness: 2,
  };
}

// A creature with the Parker Luck attack-trigger body (named-card form)
function makeParkerLuckCreature(): CardDefinition {
  return {
    id: 'parkerluck', name: 'Parker Luck',
    type_line: 'Creature — Human Rogue',
    oracle_text: 'Whenever Parker Luck attacks, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.',
    mana_cost: '{1}{R}', cmc: 2, colors: ['R'], color_identity: ['R'],
    keywords: [], card_types: ['creature'], power: 2, toughness: 1,
  };
}

// A creature with the Knight-Errant of Eos ETB body (fixed-N variant — honest)
function makeKnightErrantCreature(): CardDefinition {
  return {
    id: 'knight', name: 'Knight-Errant of Eos',
    type_line: 'Creature — Human Knight',
    oracle_text: 'When this creature enters, look at the top six cards of your library. You may put any number of creature cards with mana value 2 or less from among them into your hand. Put the rest on the bottom of your library in a random order.',
    mana_cost: '{4}{W}', cmc: 5, colors: ['W'], color_identity: ['W'],
    keywords: [], card_types: ['creature'], power: 4, toughness: 4,
  };
}

// ---------------------------------------------------------------------------
// State builders
// ---------------------------------------------------------------------------

/** Build a minimal state with a specified library (top-first) for p0. */
function libState(libraryDefs: string[]): GameState {
  const cards = new Map<string, CardInstance>();
  libraryDefs.forEach((defId, i) => {
    cards.set(`lib${i}`, {
      instanceId: `lib${i}`, definitionId: defId, ownerId: 'p0', zone: 'library',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    });
  });
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards,
    cardDefinitions: new Map<string, CardDefinition>([
      ['forest', forestDef], ['bear', bearDef], ['bolt', boltDef],
    ]),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main',
    step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function zoneOf(s: GameState, id: string): string {
  return s.cards.get(id)!.zone;
}

function handOf(s: GameState, playerId: string): CardInstance[] {
  return [...s.cards.values()].filter(c => c.zone === 'hand' && c.ownerId === playerId);
}

function lifeOf(s: GameState, playerId: string): number {
  return s.players.find(p => p.id === playerId)!.life;
}

// ---------------------------------------------------------------------------
// Parser tests
// ---------------------------------------------------------------------------

describe('etb-attack-dig trigger tails: parsing', () => {

  describe('named-card attacks trigger prefix', () => {
    it('Traveling Botanist: "Whenever Traveling Botanist attacks" parses as Triggered', () => {
      const oracle = "Whenever Traveling Botanist attacks, reveal the top card of your library. If it's a land card, you may reveal it and put it into your hand. If you don't, put it on the bottom of your library.";
      const r = parseOracleText(oracle);
      expect(r.kind).toBe('Triggered');
      if (r.kind !== 'Triggered') return;
      expect(r.ability.trigger.kind).toBe('Attacks');
    });

    it('Parker Luck: "Whenever Parker Luck attacks" parses as Triggered with RevealTopMatch + LoseLife', () => {
      const oracle = 'Whenever Parker Luck attacks, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.';
      const r = parseOracleText(oracle);
      expect(r.kind).toBe('Triggered');
      if (r.kind !== 'Triggered') return;
      expect(r.ability.trigger.kind).toBe('Attacks');
      // Body produces two effects: RevealTopMatch and LoseLife
      expect(r.ability.effects.some(e => e.kind === 'RevealTopMatch')).toBe(true);
      expect(r.ability.effects.some(e => e.kind === 'LoseLife')).toBe(true);
    });

    it('multi-word card name "Whenever Wandering Mind attacks" parses as Triggered', () => {
      const r = parseOracleText('Whenever Wandering Mind attacks, draw a card.');
      expect(r.kind).toBe('Triggered');
      if (r.kind !== 'Triggered') return;
      expect(r.ability.trigger.kind).toBe('Attacks');
    });

    it('"Whenever ~ attacks" still works (no regression)', () => {
      const r = parseOracleText('Whenever ~ attacks, draw a card.');
      expect(r.kind).toBe('Triggered');
      if (r.kind !== 'Triggered') return;
      expect(r.ability.trigger).toEqual({ kind: 'Attacks', who: 'self' });
    });

    it('"Whenever this creature attacks" still works (no regression)', () => {
      const r = parseOracleText('Whenever this creature attacks, draw a card.');
      expect(r.kind).toBe('Triggered');
      if (r.kind !== 'Triggered') return;
      expect(r.ability.trigger.kind).toBe('Attacks');
    });
  });

  describe('ETB dig trigger bodies', () => {
    it('Knight-Errant fixed-N: "When this creature enters, look at top 6..." parses as ETB', () => {
      const oracle = 'When this creature enters, look at the top six cards of your library. You may put any number of creature cards with mana value 2 or less from among them into your hand. Put the rest on the bottom of your library in a random order.';
      const r = parseOracleText(oracle);
      expect(r.kind).toBe('ETB');
      if (r.kind !== 'ETB') return;
      const eff = r.ability.effects.find(e => e.kind === 'ChooseFromTopOfLibrary') as any;
      expect(eff).toBeDefined();
      expect(eff.count).toBe(6);
      expect(eff.filter.types).toEqual(['creature']);
      expect(eff.filter.cmc).toEqual({ op: 'lte', value: 2 });
      expect(eff.destination).toBe('hand');
      expect(eff.restDestination).toBe('bottom');
    });

    it('Honesty: Knight-Errant exact oracle "where X is the number of creature spells you\'ve cast this turn" stays Unparsed', () => {
      const oracle = "When this creature enters, look at the top X cards of your library, where X is the number of creature spells you've cast this turn. You may put any number of creature cards with mana value 2 or less from among them into your hand. Put the rest on the bottom of your library in a random order.";
      const r = parseOracleText(oracle);
      // No "cast this turn" counter in the executor — must stay Unparsed.
      expect(r.kind).toBe('Unparsed');
    });

    it('Honesty: Deceiver of Form "become copies" tail stays Unparsed (no copy-to-creature subsystem)', () => {
      const oracle = "Whenever Deceiver of Form attacks, reveal the top card of your library. If it's a creature card, creatures you control become copies of that card until end of turn. Otherwise, put it on the bottom of your library.";
      const r = parseOracleText(oracle);
      // Copy-to-creature-shape is not implemented — must stay Unparsed.
      expect(r.kind).toBe('Unparsed');
    });
  });

  describe('Traveling Botanist attack trigger body', () => {
    it('Body parses to ChooseFromTopOfLibrary with land filter, hand destination, bottom rest', () => {
      const oracle = "Whenever Traveling Botanist attacks, reveal the top card of your library. If it's a land card, you may reveal it and put it into your hand. If you don't, put it on the bottom of your library.";
      const r = parseOracleText(oracle);
      expect(r.kind).toBe('Triggered');
      if (r.kind !== 'Triggered') return;
      const eff = r.ability.effects.find(e => e.kind === 'ChooseFromTopOfLibrary') as any;
      expect(eff).toBeDefined();
      expect(eff.count).toBe(1);
      expect(eff.filter).toEqual({ types: ['land'] });
      expect(eff.destination).toBe('hand');
      expect(eff.restDestination).toBe('bottom');
    });
  });
});

// ---------------------------------------------------------------------------
// Execution tests
// ---------------------------------------------------------------------------

describe('etb-attack-dig trigger tails: execution', () => {

  describe('Parker Luck attack trigger — RevealTopMatch + LoseLife(RevealedTopCardManaValue)', () => {
    const bodyText = 'Reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.';

    it('reveals top card to hand and loses life equal to its mana value (bear, cmc=2)', () => {
      const p = parseOracleText(bodyText);
      expect(p.kind).toBe('Spell');
      if (p.kind !== 'Spell') return;
      const s0 = libState(['bear', 'forest']);
      const s = executeEffects(s0, p.effects, 'p0', [], []);
      // The bear (cmc 2) went to hand
      expect(zoneOf(s, 'lib0')).toBe('hand');
      // Life lost = 2 (bear's cmc)
      expect(lifeOf(s, 'p0')).toBe(40 - 2);
    });

    it('reveals top land (cmc=0): no life lost', () => {
      const p = parseOracleText(bodyText);
      if (p.kind !== 'Spell') return;
      const s0 = libState(['forest', 'bear']);
      const s = executeEffects(s0, p.effects, 'p0', [], []);
      expect(zoneOf(s, 'lib0')).toBe('hand');
      // Forest cmc=0 → 0 life lost
      expect(lifeOf(s, 'p0')).toBe(40);
    });

    it('empty library: no effect, no crash', () => {
      const p = parseOracleText(bodyText);
      if (p.kind !== 'Spell') return;
      const s0 = libState([]);
      const s = executeEffects(s0, p.effects, 'p0', [], []);
      expect(lifeOf(s, 'p0')).toBe(40);
    });
  });

  describe('Traveling Botanist attack trigger — RevealTopIfMatchWithElse', () => {
    const bodyText = "Reveal the top card of your library. If it's a land card, you may reveal it and put it into your hand. If you don't, put it on the bottom of your library.";

    it('top card is a land → goes to hand', () => {
      const p = parseOracleText(bodyText);
      expect(p.kind).toBe('Spell');
      if (p.kind !== 'Spell') return;
      const s0 = libState(['forest', 'bear']);
      const s = executeEffects(s0, p.effects, 'p0', [], []);
      expect(zoneOf(s, 'lib0')).toBe('hand');
      expect(zoneOf(s, 'lib1')).toBe('library');
    });

    it('top card is not a land → goes to bottom of library', () => {
      const p = parseOracleText(bodyText);
      if (p.kind !== 'Spell') return;
      const s0 = libState(['bear', 'forest']);
      const s = executeEffects(s0, p.effects, 'p0', [], []);
      // bear stays in library (went to bottom)
      expect(zoneOf(s, 'lib0')).toBe('library');
      // forest (the second card) is still in library too
      expect(zoneOf(s, 'lib1')).toBe('library');
      // No cards in hand
      expect(handOf(s, 'p0')).toHaveLength(0);
    });
  });

  describe('Knight-Errant ETB dig — ChooseFromTopOfLibrary with creature filter + cmc cap', () => {
    const bodyText = 'Look at the top six cards of your library. You may put any number of creature cards with mana value 2 or less from among them into your hand. Put the rest on the bottom of your library in a random order.';

    it('takes all creature cards with cmc ≤ 2 from the top 6, bottoms the rest', () => {
      const p = parseOracleText(bodyText);
      expect(p.kind).toBe('Spell');
      if (p.kind !== 'Spell') return;
      // Library top-6: bear(2), bolt(1 instant - no match), forest(0 land - no match),
      //                bear(2), bolt(1), forest(0); plus a 7th untouched
      const s0 = libState(['bear', 'bolt', 'forest', 'bear', 'bolt', 'forest', 'bear']);
      const s = executeEffects(s0, p.effects, 'p0', [], []);

      const inHand = handOf(s, 'p0');
      // lib0 (bear cmc 2) and lib3 (bear cmc 2) are creatures with cmc ≤ 2
      expect(inHand.map(c => c.instanceId).sort()).toEqual(['lib0', 'lib3']);

      // The rest of the revealed top-6 went to bottom (still in library)
      const inLib = [...s.cards.values()].filter(c => c.zone === 'library').map(c => c.instanceId);
      expect(inLib).toContain('lib1');  // bolt
      expect(inLib).toContain('lib2');  // forest
      expect(inLib).toContain('lib4');  // bolt
      expect(inLib).toContain('lib5');  // forest
      expect(inLib).toContain('lib6');  // untouched 7th card

      // 7 original cards - 2 taken to hand = 5 in library
      expect(inLib).toHaveLength(5);
    });

    it('takes nothing when no creature cmc ≤ 2 in top 6', () => {
      const p = parseOracleText(bodyText);
      if (p.kind !== 'Spell') return;
      // bolt (instant cmc 1) does not match creature filter
      const s0 = libState(['bolt', 'forest', 'bolt', 'forest', 'bolt', 'forest', 'bear']);
      const s = executeEffects(s0, p.effects, 'p0', [], []);
      expect(handOf(s, 'p0')).toHaveLength(0);
      // All cards still in library
      expect([...s.cards.values()].filter(c => c.zone === 'library')).toHaveLength(7);
    });
  });

  describe('named-card attacks trigger integration (full trigger pipeline)', () => {
    function setupAttackState(creatureDef: CardDefinition): GameState {
      const land: CardDefinition = {
        id: 'island', name: 'Island', type_line: 'Basic Land — Island',
        oracle_text: '{T}: Add {U}.', mana_cost: '', cmc: 0, colors: [],
        color_identity: ['U'], keywords: [], card_types: ['land'],
      };
      return initGameState([
        { playerId: 'p1', name: 'P1', cards: [creatureDef, land, forestDef, forestDef], commanderId: 'nonexistent-cmd-1' },
        { playerId: 'p2', name: 'P2', cards: [land], commanderId: 'nonexistent-cmd-2' },
      ]);
    }

    function findCard(state: GameState, defId: string): CardInstance {
      for (const c of state.cards.values()) {
        if (c.definitionId === defId) return c;
      }
      throw new Error(`Not found: ${defId}`);
    }

    function moveToBattlefield(state: GameState, instanceId: string): GameState {
      const card = state.cards.get(instanceId)!;
      const newCards = new Map(state.cards);
      newCards.set(instanceId, { ...card, zone: 'battlefield', summoningSick: false });
      return { ...state, cards: newCards };
    }

    it('Traveling Botanist named-card trigger fires when it attacks (land goes to hand)', () => {
      const botanistDef = makeBotanistCreature();
      let state = setupAttackState(botanistDef);
      const inst = findCard(state, 'botanist');
      state = moveToBattlefield(state, inst.instanceId);
      state = registerBattlefieldAbilities(state, inst.instanceId);
      state = { ...state, activePlayerIndex: 0, phase: 'combat' as any, step: 'declare_attackers' as any };

      // Put a land on top of p1's library
      const p1LibCards = [...state.cards.values()].filter(c => c.zone === 'library' && c.ownerId === 'p1');
      // Make the first lib card a land
      if (p1LibCards.length > 0) {
        const newCards = new Map(state.cards);
        newCards.set(p1LibCards[0].instanceId, { ...p1LibCards[0], definitionId: 'forest' });
        state = { ...state, cards: newCards };
        // Ensure forest is in cardDefinitions
        const newDefs = new Map(state.cardDefinitions);
        newDefs.set('forest', forestDef);
        state = { ...state, cardDefinitions: newDefs };
      }

      const beforeHand = [...state.cards.values()].filter(c => c.zone === 'hand' && c.ownerId === 'p1').length;
      state = declareAttackers(state, 'p1', [{ cardInstanceId: inst.instanceId, defendingPlayerId: 'p2' }]);
      expect(state.pendingTriggers.length).toBeGreaterThanOrEqual(1);

      state = putTriggersOnStack(state);
      state = resolveTopOfStack(state);

      const afterHand = [...state.cards.values()].filter(c => c.zone === 'hand' && c.ownerId === 'p1').length;
      // A land was on top → should have moved to hand
      expect(afterHand).toBeGreaterThan(beforeHand);
    });
  });
});
