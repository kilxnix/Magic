/**
 * Parser/executor coverage — Slice 3/12 oracle parser:
 * "Look at top N; you may exile a [filter] card from among them; put the rest into your hand."
 *
 * Verified gap: matchLookAtTopExileOneFromAmong covers rest→bottom and rest→graveyard,
 * but NOT rest→hand. The new matchLookAtTopExileFilterRestToHand fills this gap.
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
const bolt: CardDefinition = {
  id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: '',
  mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'], keywords: [], card_types: ['instant'],
};
const forest: CardDefinition = {
  id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '',
  mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [], card_types: ['land'],
};
const artifact: CardDefinition = {
  id: 'artifact', name: 'Clue Token', type_line: 'Artifact', oracle_text: '',
  mana_cost: '{2}', cmc: 2, colors: [], color_identity: [], keywords: [], card_types: ['artifact'],
};

const DEFS = new Map<string, CardDefinition>([
  ['bear', bear], ['bolt', bolt], ['forest', forest], ['artifact', artifact],
]);

function makeInstance(id: string, defId: string, zone: CardInstance['zone'], ownerId = 'p0'): CardInstance {
  return { instanceId: id, definitionId: defId, ownerId, zone, tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false };
}

function buildState(libDefs: string[], handDefs: string[] = []): GameState {
  const cards = new Map<string, CardInstance>();
  handDefs.forEach((d, i) => cards.set(`hand${i}`, makeInstance(`hand${i}`, d, 'hand')));
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
  return [...s.cards.values()].filter(c => c.ownerId === 'p0' && c.zone === zone).map(c => c.instanceId);
}

// ═══════════════════════════════════════════════════════════════
// 1. Parse tests — verify the wording produces ChooseFromTopOfLibrary with
//    destination='exile' and restDestination='hand'
// ═══════════════════════════════════════════════════════════════

describe('matchLookAtTopExileFilterRestToHand — parse', () => {
  it('parses "exile a nonland card … put the rest into your hand" (Make Your Own Luck form)', () => {
    const text =
      'Look at the top three cards of your library. You may exile a nonland card from among them. Put the rest into your hand.';
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.count).toBe(3);
    expect(e.destination).toBe('exile');
    expect(e.restDestination).toBe('hand');
    expect(e.minSelections).toBe(0);
    expect(e.maxSelections).toBe(1);
    expect(e.filter).toEqual({ excludeTypes: ['land'] });
    expect(e.player).toEqual({ kind: 'Controller' });
  });

  it('parses "exile a creature card … put the rest into your hand" (creature filter)', () => {
    const text =
      'Look at the top four cards of your library. You may exile a creature card from among them. Put the rest into your hand.';
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.count).toBe(4);
    expect(e.destination).toBe('exile');
    expect(e.restDestination).toBe('hand');
    expect(e.filter).toEqual({ types: ['creature'] });
  });

  it('parses with no filter — "exile a card from among them. Put the rest into your hand."', () => {
    const text =
      'Look at the top two cards of your library. You may exile a card from among them. Put the rest into your hand.';
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.count).toBe(2);
    expect(e.destination).toBe('exile');
    expect(e.restDestination).toBe('hand');
    // No filter specified
    expect(e.filter).toBeUndefined();
  });

  it('does NOT claim the "rest on the bottom" variant (handled by matchLookAtTopExileOneFromAmong)', () => {
    const text =
      'Look at the top three cards of your library. You may exile a nonland card from among them. Put the rest on the bottom of your library in any order.';
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    // The bottom-rest variant should be covered by the other matcher
    expect(e.destination).toBe('exile');
    expect(e.restDestination).toBe('bottom');
  });

  it('declines "if you do, it becomes plotted" rider (out of scope)', () => {
    const text =
      'Look at the top three cards of your library. You may exile a nonland card from among them. If you do, it becomes plotted. Put the rest into your hand.';
    const p = parseOracleText(text);
    // Should either parse as something else or be Unparsed — but not claim it dishonestly
    // (the "if you do" rider is out of scope)
    if (p.kind === 'Spell') {
      const e = p.effects[0];
      if (e.kind === 'ChooseFromTopOfLibrary') {
        // If it still parses as ChooseFromTopOfLibrary, the rider was declined (not the effect)
        // This is acceptable only if the effect itself is correct (rest=hand)
        // But we expect Unparsed due to the If-you-do clause
        expect(e.restDestination).not.toBe('hand');
      }
    }
    // Simply verify it didn't dishonestly parse the "becomes plotted" rider
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Execute tests — verify the executor moves cards correctly
// ═══════════════════════════════════════════════════════════════

describe('matchLookAtTopExileFilterRestToHand — execute', () => {
  const text =
    'Look at the top three cards of your library. You may exile a nonland card from among them. Put the rest into your hand.';

  it('with no selection: auto-exiles first matching (nonland) card, rest go to hand', () => {
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // Library: bear (creature, nonland), forest (land), bolt (instant, nonland)
    const s0 = buildState(['bear', 'forest', 'bolt']);
    // No explicit selection — auto-selects first nonland card (bear)
    const s = executeEffects(s0, p.effects, 'p0', [], []);
    expect(zoneIds(s, 'exile')).toHaveLength(1);  // bear exiled
    expect(zoneIds(s, 'hand')).toHaveLength(2);   // forest + bolt in hand
    expect(zoneIds(s, 'library')).toHaveLength(0);
    // Verify bear is in exile
    const exiled = [...s.cards.values()].find(c => c.zone === 'exile' && c.ownerId === 'p0');
    expect(exiled?.definitionId).toBe('bear');
  });

  it('with no nonland cards in top N: nothing exiled, all go to hand', () => {
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // Library: all lands (nothing to exile)
    const s0 = buildState(['forest', 'forest', 'forest']);
    const s = executeEffects(s0, p.effects, 'p0', [], []);
    expect(zoneIds(s, 'exile')).toHaveLength(0);  // nothing to exile (no nonland cards)
    expect(zoneIds(s, 'hand')).toHaveLength(3);   // all 3 lands go to hand
    expect(zoneIds(s, 'library')).toHaveLength(0);
  });

  it('with explicit selection: honors player choice of which card to exile', () => {
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // Library: bear, forest, bolt — player explicitly chooses bolt to exile
    const s0 = buildState(['bear', 'forest', 'bolt']);
    // Submit bolt (lib2) as the exile choice
    const s = executeEffects(s0, p.effects, 'p0', [], [], 0, {
      namedCardChoices: { lookTopExileFilterRestToHandIds: 'lib2' },
    });
    const exiled = [...s.cards.values()].filter(c => c.zone === 'exile' && c.ownerId === 'p0');
    expect(exiled).toHaveLength(1);
    expect(exiled[0].definitionId).toBe('bolt'); // bolt exiled by explicit choice
    expect(zoneIds(s, 'hand')).toHaveLength(2);   // bear + forest in hand
    expect(zoneIds(s, 'library')).toHaveLength(0);
  });

  it('creature filter: auto-exiles creature card, rest (non-creature) go to hand', () => {
    const creatureText =
      'Look at the top three cards of your library. You may exile a creature card from among them. Put the rest into your hand.';
    const p = parseOracleText(creatureText);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // Library: bolt (instant), bear (creature), forest (land)
    const s0 = buildState(['bolt', 'bear', 'forest']);
    // No explicit selection — auto-selects bear (first creature)
    const s = executeEffects(s0, p.effects, 'p0', [], []);
    expect(zoneIds(s, 'exile')).toHaveLength(1);
    const exiled = [...s.cards.values()].find(c => c.zone === 'exile' && c.ownerId === 'p0');
    expect(exiled?.definitionId).toBe('bear');
    expect(zoneIds(s, 'hand')).toHaveLength(2);   // bolt + forest in hand
  });

  it('library cards beyond top N remain in library', () => {
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // Library: 5 cards but only top 3 are looked at
    const s0 = buildState(['bear', 'forest', 'bolt', 'artifact', 'forest']);
    const s = executeEffects(s0, p.effects, 'p0', [], []);
    // 2 cards remain in library (the 4th and 5th cards not revealed)
    expect(zoneIds(s, 'library')).toHaveLength(2);
    expect(zoneIds(s, 'exile')).toHaveLength(1);  // bear exiled
    expect(zoneIds(s, 'hand')).toHaveLength(2);   // forest + bolt
  });
});
