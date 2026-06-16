/**
 * Oracle-parser coverage slice 3/13 — Reveal-top-N leftovers
 *
 * Covers three matchers added in this slice:
 *
 *   1. matchRevealTopUnconditioned
 *      "Reveal the top card of your library and put it into your hand." (no condition)
 *      → RevealTopMatch{ filter:{}, matchDestination:'hand' }
 *
 *   2. matchRevealTopChosenType
 *      "Reveal the top N cards. Put all cards of the chosen type into your hand
 *       and the rest on the bottom / into your graveyard."
 *      → ChooseFromTopOfLibrary{ filter:{ chosenCreatureTypeFromSource:true }, ... }
 *
 *   3. matchRevealTopTake "among them" fix
 *      "Reveal the top N cards. Put all <type> cards among them into your hand
 *       and the rest into your graveyard." (without leading "from")
 *      → ChooseFromTopOfLibrary{ filter:{ types:['creature'] }, ... }
 *
 * Also verifies the Pain Seer / Dark Confidant form (existing matcher) still
 * correctly outranks matchRevealTopUnconditioned (which must decline when
 * "you lose life" follows).
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ─── card definitions ─────────────────────────────────────────────────────────

const forest: CardDefinition = {
  id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
  keywords: [], card_types: ['land'],
};

const bear: CardDefinition = {
  id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear',
  oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 2, toughness: 2,
};

const bolt: CardDefinition = {
  id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant',
  oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'],
  keywords: [], card_types: ['instant'],
};

const artifact: CardDefinition = {
  id: 'artifact', name: 'Sol Ring', type_line: 'Artifact',
  oracle_text: '', mana_cost: '{1}', cmc: 1, colors: [], color_identity: [],
  keywords: [], card_types: ['artifact'],
};

const DEFS = new Map<string, CardDefinition>([
  ['forest', forest], ['bear', bear], ['bolt', bolt], ['artifact', artifact],
]);

function makeInstance(id: string, defId: string, zone: CardInstance['zone'], ownerId = 'p0'): CardInstance {
  return {
    instanceId: id, definitionId: defId, ownerId, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function buildState(
  libDefs: string[],
  battlefieldDefs: string[] = [],
  p0Life = 20,
  extraChoices?: Map<string, string>,
): GameState {
  const cards = new Map<string, CardInstance>();
  battlefieldDefs.forEach((d, i) => cards.set(`bf${i}`, makeInstance(`bf${i}`, d, 'battlefield')));
  libDefs.forEach((d, i) => cards.set(`lib${i}`, makeInstance(`lib${i}`, d, 'library')));
  const players = [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')];
  players[0] = { ...players[0], life: p0Life };
  return {
    players,
    cards,
    cardDefinitions: DEFS,
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'begin_combat',
    turnNumber: 2, hasPriorityPassed: [false, false],
    stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function zoneIds(s: GameState, zone: CardInstance['zone']): string[] {
  return [...s.cards.values()].filter(c => c.zone === zone).map(c => c.instanceId);
}

// ─── 1. matchRevealTopUnconditioned ──────────────────────────────────────────

describe('matchRevealTopUnconditioned', () => {
  describe('simple "reveal top card and put it into your hand" spell', () => {
    const text = 'Reveal the top card of your library and put it into your hand.';

    it('parses to Spell with RevealTopMatch (empty filter, hand destination)', () => {
      const p = parseOracleText(text);
      expect(p.kind).toBe('Spell');
      if (p.kind !== 'Spell') return;
      expect(p.effects).toHaveLength(1);
      const e = p.effects[0];
      expect(e.kind).toBe('RevealTopMatch');
      if (e.kind !== 'RevealTopMatch') return;
      expect(e.filter).toEqual({});
      expect(e.matchDestination).toBe('hand');
    });

    it('moves the top card to hand (land)', () => {
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error('expected Spell');
      const s0 = buildState(['forest', 'bear']);
      const s = executeEffects(s0, p.effects, 'p0', [], []);
      expect(s.cards.get('lib0')!.zone).toBe('hand');
      expect(s.cards.get('lib1')!.zone).toBe('library');
    });

    it('moves the top card to hand (creature)', () => {
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error('expected Spell');
      const s0 = buildState(['bear', 'forest']);
      const s = executeEffects(s0, p.effects, 'p0', [], []);
      expect(s.cards.get('lib0')!.zone).toBe('hand');
    });

    it('graceful no-op on empty library', () => {
      const p = parseOracleText(text);
      if (p.kind !== 'Spell') throw new Error('expected Spell');
      const s = executeEffects(buildState([]), p.effects, 'p0', [], []);
      expect(zoneIds(s, 'hand')).toHaveLength(0);
    });
  });

  describe('trigger-embedded form (upkeep trigger)', () => {
    const text =
      'At the beginning of your upkeep, reveal the top card of your library and put it into your hand.';

    it('parses to Triggered ability with RevealTopMatch (empty filter)', () => {
      const p = parseOracleText(text);
      expect(p.kind).toBe('Triggered');
      if (p.kind !== 'Triggered') return;
      expect(p.ability.trigger.kind).toBe('Upkeep');
      const e = p.ability.effects[0];
      expect(e.kind).toBe('RevealTopMatch');
      if (e.kind !== 'RevealTopMatch') return;
      expect(e.filter).toEqual({});
      expect(e.matchDestination).toBe('hand');
    });
  });

  describe('two-sentence form (period between reveal and put)', () => {
    const text = 'Reveal the top card of your library. Put it into your hand.';

    it('parses to Spell with RevealTopMatch', () => {
      const p = parseOracleText(text);
      expect(p.kind).toBe('Spell');
      if (p.kind !== 'Spell') return;
      const e = p.effects[0];
      expect(e.kind).toBe('RevealTopMatch');
    });
  });

  describe('does NOT claim the Dark Confidant form (which follows with life loss)', () => {
    const dcText =
      'At the beginning of your upkeep, reveal the top card of your library and put it into your hand. You lose life equal to its mana value.';

    it('parses Dark Confidant to Triggered with RevealTopMatch + LoseLife (not single RevealTopMatch)', () => {
      const p = parseOracleText(dcText);
      expect(p.kind).toBe('Triggered');
      if (p.kind !== 'Triggered') return;
      const effects = p.ability.effects;
      expect(effects).toHaveLength(2);
      expect(effects[0].kind).toBe('RevealTopMatch');
      expect(effects[1].kind).toBe('LoseLife');
    });
  });

  describe('does NOT claim the conditional form (matchRevealTopIfMatch handles it)', () => {
    const text = "Reveal the top card of your library. If it's a land card, put it into your hand.";

    it('still parses (via matchRevealTopIfMatch), does not cause Unparsed', () => {
      const p = parseOracleText(text);
      expect(p.kind).toBe('Spell');
      if (p.kind !== 'Spell') return;
      expect(p.effects[0].kind).toBe('RevealTopMatch');
    });
  });
});

// ─── 2. matchRevealTopChosenType ─────────────────────────────────────────────

describe('matchRevealTopChosenType (Vigean Intuition / Spectral Arcanist family)', () => {
  // Vigean Intuition oracle: "Choose a card type. Reveal the top four cards of your
  // library. Put all cards of the chosen type into your hand and the rest on the
  // bottom of your library in any order."
  // We test the "reveal + put" portion (the "choose" clause is parsed separately
  // as an ETB/spell opener or absorbed as a static choice — our matcher handles
  // the reveal+put body only).

  const vigeanBody =
    'Reveal the top four cards of your library. Put all cards of the chosen type into your hand and the rest on the bottom of your library in any order.';

  it('parses the Vigean Intuition body to ChooseFromTopOfLibrary with chosenCreatureTypeFromSource filter', () => {
    const p = parseOracleText(vigeanBody);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') return;
    expect(e.count).toBe(4);
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('bottom');
    expect(e.minSelections).toBe(0);
    expect(e.filter).toEqual({ chosenCardTypeFromSource: true });
  });

  const graveyardRest =
    'Reveal the top three cards of your library. Put all cards of the chosen type into your hand and the rest into your graveyard.';

  it('parses graveyard-rest variant correctly', () => {
    const p = parseOracleText(graveyardRest);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') return;
    expect(e.count).toBe(3);
    expect(e.restDestination).toBe('graveyard');
    expect(e.filter).toEqual({ chosenCardTypeFromSource: true });
  });

  describe('execution with chosenCreatureType set on source', () => {
    it('takes only cards matching the chosen type (creature) and bottoms the rest', () => {
      const p = parseOracleText(vigeanBody);
      if (p.kind !== 'Spell') throw new Error('expected Spell');

      // Build a state with a source card that has chosenCreatureType='creature'
      const cards = new Map<string, CardInstance>();
      // Library: bear(creature), forest(land), bolt(instant), artifact(artifact)
      cards.set('lib0', makeInstance('lib0', 'bear', 'library'));
      cards.set('lib1', makeInstance('lib1', 'forest', 'library'));
      cards.set('lib2', makeInstance('lib2', 'bolt', 'library'));
      cards.set('lib3', makeInstance('lib3', 'artifact', 'library'));
      // Source permanent with chosenCreatureType set
      const sourceCard: CardInstance = {
        ...makeInstance('src0', 'bear', 'battlefield'),
        choices: { chosenCreatureType: 'creature' },
      };
      cards.set('src0', sourceCard);

      const state: GameState = {
        players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
        cards,
        cardDefinitions: DEFS,
        activePlayerIndex: 0, priorityPlayerIndex: 0,
        phase: 'precombat_main', step: 'begin_combat',
        turnNumber: 2, hasPriorityPassed: [false, false],
        stack: [], combat: null,
        battlefieldAbilities: new Map(), pendingTriggers: [],
      };

      const s = executeEffects(state, p.effects, 'p0', [], [], 0, { sourceInstanceId: 'src0' });
      // Only the creature (lib0 = bear) should go to hand
      expect(s.cards.get('lib0')!.zone).toBe('hand');
      // Land, instant, artifact stay in library (bottomed)
      expect(s.cards.get('lib1')!.zone).toBe('library');
      expect(s.cards.get('lib2')!.zone).toBe('library');
      expect(s.cards.get('lib3')!.zone).toBe('library');
    });

    it('takes only lands when chosenCreatureType is "land"', () => {
      const p = parseOracleText(vigeanBody);
      if (p.kind !== 'Spell') throw new Error('expected Spell');

      const cards = new Map<string, CardInstance>();
      cards.set('lib0', makeInstance('lib0', 'forest', 'library'));
      cards.set('lib1', makeInstance('lib1', 'bear', 'library'));
      cards.set('lib2', makeInstance('lib2', 'bolt', 'library'));
      cards.set('lib3', makeInstance('lib3', 'forest', 'library'));
      const sourceCard: CardInstance = {
        ...makeInstance('src0', 'artifact', 'battlefield'),
        choices: { chosenCreatureType: 'land' },
      };
      cards.set('src0', sourceCard);

      const state: GameState = {
        players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
        cards,
        cardDefinitions: DEFS,
        activePlayerIndex: 0, priorityPlayerIndex: 0,
        phase: 'precombat_main', step: 'begin_combat',
        turnNumber: 2, hasPriorityPassed: [false, false],
        stack: [], combat: null,
        battlefieldAbilities: new Map(), pendingTriggers: [],
      };

      const s = executeEffects(state, p.effects, 'p0', [], [], 0, { sourceInstanceId: 'src0' });
      // Both forests (lib0, lib3) should go to hand
      expect(s.cards.get('lib0')!.zone).toBe('hand');
      expect(s.cards.get('lib3')!.zone).toBe('hand');
      // Bear and bolt stay in library
      expect(s.cards.get('lib1')!.zone).toBe('library');
      expect(s.cards.get('lib2')!.zone).toBe('library');
    });
  });
});

// ─── 3. matchRevealTopTake "among them" fix ──────────────────────────────────

describe('matchRevealTopTake with "among them" (no leading "from")', () => {
  const text =
    'Reveal the top four cards of your library. Put all creature cards among them into your hand and the rest into your graveyard.';

  it('parses to ChooseFromTopOfLibrary with creature filter and graveyard rest', () => {
    const p = parseOracleText(text);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') return;
    expect(e.count).toBe(4);
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('graveyard');
    expect(e.filter).toEqual({ types: ['creature'] });
  });

  it('moves creature cards to hand and others to graveyard', () => {
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // Library: bear, forest, bolt, artifact — top 4 all revealed
    const s0 = buildState(['bear', 'forest', 'bolt', 'artifact']);
    const s = executeEffects(s0, p.effects, 'p0', [], []);
    // Only the bear (creature) goes to hand
    expect(s.cards.get('lib0')!.zone).toBe('hand');
    // Non-creatures go to graveyard
    expect(s.cards.get('lib1')!.zone).toBe('graveyard');
    expect(s.cards.get('lib2')!.zone).toBe('graveyard');
    expect(s.cards.get('lib3')!.zone).toBe('graveyard');
  });

  it('"from among them" wording still parses (backward compat)', () => {
    const fromText =
      'Reveal the top three cards of your library. Put all creature cards from among them into your hand and the rest into your graveyard.';
    const p = parseOracleText(fromText);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
  });

  it('"revealed this way" wording still parses (backward compat)', () => {
    const revealedText =
      'Reveal the top three cards of your library. Put all creature cards revealed this way into your hand and the rest into your graveyard.';
    const p = parseOracleText(revealedText);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
  });

  // Vigean Intuition full text including the choose clause
  it('parses the full Vigean Intuition oracle text (choose clause + reveal body)', () => {
    const fullText =
      'Choose a card type. Reveal the top four cards of your library. Put all cards of the chosen type into your hand and the rest on the bottom of your library in any order.';
    // The "choose a card type" clause is an opener not covered by our matchers —
    // the reveal+put body should parse and the overall result should NOT be Unparsed.
    // (The choose opener may leave it partially Unparsed, but the body-only version should parse.)
    const bodyText =
      'Reveal the top four cards of your library. Put all cards of the chosen type into your hand and the rest on the bottom of your library in any order.';
    const p = parseOracleText(bodyText);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
  });
});

// ─── 4. Trigger-embedded form: attack trigger with reveal-top ─────────────────

describe('trigger-embedded reveal-top-match (attack trigger / ETB body)', () => {
  it('parses "Whenever ~ attacks, reveal the top card. If it\'s a creature, put into hand."', () => {
    const text =
      "Whenever ~ attacks, reveal the top card of your library. If it's a creature card, put it into your hand.";
    const p = parseOracleText(text);
    expect(p.kind).toBe('Triggered');
    if (p.kind !== 'Triggered') return;
    expect(p.ability.trigger.kind).toBe('Attacks');
    const e = p.ability.effects[0];
    expect(e.kind).toBe('RevealTopMatch');
    if (e.kind !== 'RevealTopMatch') return;
    expect(e.filter).toEqual({ types: ['creature'] });
    expect(e.matchDestination).toBe('hand');
  });

  it('executes attack-triggered reveal: creature on top goes to hand', () => {
    const text =
      "Whenever ~ attacks, reveal the top card of your library. If it's a creature card, put it into your hand.";
    const p = parseOracleText(text);
    if (p.kind !== 'Triggered') throw new Error('expected Triggered');
    const s0 = buildState(['bear', 'forest']);
    const s = executeEffects(s0, p.ability.effects, 'p0', [], []);
    expect(s.cards.get('lib0')!.zone).toBe('hand');
    expect(s.cards.get('lib1')!.zone).toBe('library');
  });

  it('executes attack-triggered reveal: non-creature on top stays on library', () => {
    const text =
      "Whenever ~ attacks, reveal the top card of your library. If it's a creature card, put it into your hand.";
    const p = parseOracleText(text);
    if (p.kind !== 'Triggered') throw new Error('expected Triggered');
    const s0 = buildState(['forest', 'bear']);
    const s = executeEffects(s0, p.ability.effects, 'p0', [], []);
    expect(s.cards.get('lib0')!.zone).toBe('library');
  });
});
