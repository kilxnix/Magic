/**
 * Oracle-parser coverage slice 7/12 — Reveal-top-N library leftovers
 * (chosen-type filter extension, ripple decline, pile-split decline)
 *
 * Scope:
 *   (a) matchRevealTopChosenType extended with "revealed this way" qualifier —
 *       covers the modern Vigean Intuition oracle wording and similar cards.
 *       The executor already handles ChooseFromTopOfLibrary with
 *       filter:{ chosenCardTypeFromSource:true } (executor.ts ~2090).
 *
 *   (b) Pile-split reveals (Steam Augury / Fact-or-Fiction family) — DECLINED.
 *       No opponent-choice prompt primitive exists in the executor; these
 *       correctly remain Unparsed to preserve the honesty bar.
 *
 *   (c) Ripple cast-trigger — DECLINED.
 *       The "you may cast those cards without paying their mana costs" clause
 *       has no executor path.  Single-line Ripple cards remain Unparsed.
 *       Multi-line creatures with "First strike\nRipple N" are Unparsed since
 *       the keyword-only face has no substantive parseable effect line.
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ─── card definitions ──────────────────────────────────────────────────────────

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

const artifactDef: CardDefinition = {
  id: 'artifact', name: 'Sol Ring', type_line: 'Artifact',
  oracle_text: '', mana_cost: '{1}', cmc: 1, colors: [], color_identity: [],
  keywords: [], card_types: ['artifact'],
};

const DEFS = new Map<string, CardDefinition>([
  ['forest', forest], ['bear', bear], ['bolt', bolt], ['artifact', artifactDef],
]);

function makeInstance(id: string, defId: string, zone: CardInstance['zone'], ownerId = 'p0'): CardInstance {
  return {
    instanceId: id, definitionId: defId, ownerId, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function buildStateWithSource(
  libDefs: string[],
  chosenCreatureType: string,
): GameState {
  const cards = new Map<string, CardInstance>();
  libDefs.forEach((d, i) => cards.set(`lib${i}`, makeInstance(`lib${i}`, d, 'library')));
  // Source card with the chosen type stored in choices.chosenCreatureType
  const sourceCard: CardInstance = {
    ...makeInstance('src0', 'artifact', 'battlefield'),
    choices: { chosenCreatureType },
  };
  cards.set('src0', sourceCard);
  const players = [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')];
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

// ─── 1. matchRevealTopChosenType — "revealed this way" wording ────────────────

describe('matchRevealTopChosenType — "revealed this way" qualifier (Vigean Intuition modern oracle)', () => {
  // Modern Vigean Intuition oracle:
  //   "Choose a card type, then reveal the top four cards of your library.
  //    Put all cards of the chosen type revealed this way into your hand
  //    and the rest on the bottom of your library in any order."
  //
  // The "choose a card type" opener is consumed by the greedy fallback in
  // parseMultipleEffects; the "revealed this way" qualifier is now accepted
  // by the extended matchRevealTopChosenType.

  const modernBodyText =
    'Reveal the top four cards of your library. Put all cards of the chosen type revealed this way into your hand and the rest on the bottom of your library in any order.';

  it('parses the "revealed this way" body to ChooseFromTopOfLibrary with chosenCardTypeFromSource filter', () => {
    const p = parseOracleText(modernBodyText);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('x');
    expect(e.count).toBe(4);
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('bottom');
    expect(e.minSelections).toBe(0);
    expect(e.filter).toEqual({ chosenCardTypeFromSource: true });
  });

  it('parses graveyard-rest variant with "revealed this way" qualifier', () => {
    const graveyardText =
      'Reveal the top three cards of your library. Put all cards of the chosen type revealed this way into your hand and the rest into your graveyard.';
    const p = parseOracleText(graveyardText);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('x');
    expect(e.count).toBe(3);
    expect(e.restDestination).toBe('graveyard');
    expect(e.filter).toEqual({ chosenCardTypeFromSource: true });
  });

  it('parses the full modern Vigean Intuition oracle text (choose clause + "revealed this way")', () => {
    const fullText =
      'Choose a card type, then reveal the top four cards of your library. Put all cards of the chosen type revealed this way into your hand and the rest on the bottom of your library in any order.';
    const p = parseOracleText(fullText);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('x');
    expect(e.count).toBe(4);
    expect(e.filter).toEqual({ chosenCardTypeFromSource: true });
  });

  // ── Execution tests ─────────────────────────────────────────────────────────

  it('executes: takes creature cards when chosenCreatureType is "creature"', () => {
    const p = parseOracleText(modernBodyText);
    if (p.kind !== 'Spell') throw new Error('expected Spell');

    // Library top 4: bear(creature), forest(land), bolt(instant), artifact(artifact)
    const state = buildStateWithSource(['bear', 'forest', 'bolt', 'artifact'], 'creature');
    const s = executeEffects(state, p.effects, 'p0', [], [], 0, { sourceInstanceId: 'src0' });

    // Only the bear (creature) should go to hand
    expect(s.cards.get('lib0')!.zone).toBe('hand');
    // Others should be bottomed
    expect(s.cards.get('lib1')!.zone).toBe('library');
    expect(s.cards.get('lib2')!.zone).toBe('library');
    expect(s.cards.get('lib3')!.zone).toBe('library');
  });

  it('executes: takes land cards when chosenCreatureType is "land"', () => {
    const p = parseOracleText(modernBodyText);
    if (p.kind !== 'Spell') throw new Error('expected Spell');

    // Library top 4: forest, bear, forest, bolt
    const state = buildStateWithSource(['forest', 'bear', 'forest', 'bolt'], 'land');
    const s = executeEffects(state, p.effects, 'p0', [], [], 0, { sourceInstanceId: 'src0' });

    // Both forests go to hand
    expect(s.cards.get('lib0')!.zone).toBe('hand');
    expect(s.cards.get('lib2')!.zone).toBe('hand');
    // Bear and bolt stay in library
    expect(s.cards.get('lib1')!.zone).toBe('library');
    expect(s.cards.get('lib3')!.zone).toBe('library');
  });

  it('backward-compat: old wording without "revealed this way" still parses', () => {
    // The older Vigean Intuition wording without "revealed this way"
    const oldText =
      'Reveal the top four cards of your library. Put all cards of the chosen type into your hand and the rest on the bottom of your library in any order.';
    const p = parseOracleText(oldText);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('x');
    expect(e.filter).toEqual({ chosenCardTypeFromSource: true });
  });
});

// ─── 2. Pile-split (Steam Augury / Fact-or-Fiction family) — now supported ────

describe('Pile-split reveals (Steam Augury) — now handled by matchRevealTopSplitTwoPiles (Slice 9)', () => {
  it('Steam Augury now parses as RevealTopSplitTwoPiles (Slice 9 added executor support)', () => {
    const text =
      'Reveal the top five cards of your library and separate them into two piles. An opponent chooses one of those piles. Put that pile into your hand and the other into your graveyard.';
    const r = parseOracleText(text);
    // Now handled by matchRevealTopSplitTwoPiles with two-pile executor branch.
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects[0].kind).toBe('RevealTopSplitTwoPiles');
  });

  it('Fact-or-Fiction wording also parses as RevealTopSplitTwoPiles', () => {
    const text =
      'Reveal the top five cards of your library. Separate them into two piles. An opponent chooses one of those piles. Put that pile into your hand and the other into your graveyard.';
    const r = parseOracleText(text);
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects[0].kind).toBe('RevealTopSplitTwoPiles');
  });
});

// ─── 3. Ripple DECLINED (free-cast not supported) ────────────────────────────

describe('Ripple — DECLINED (free-cast trigger not supported)', () => {
  it('single-line Ripple card remains Unparsed — no free-cast executor path', () => {
    // "Ripple 4" after reminder text stripping; no executor path for cast-without-paying
    const text =
      'Ripple 4 (When you cast this spell, you may reveal the top four cards of your library. If any of those cards share a name with it, you may cast those cards without paying their mana costs. Put the revealed cards not cast this way on the bottom of your library in any order.)';
    const r = parseOracleText(text);
    expect(r.kind).toBe('Unparsed');
  });
});
