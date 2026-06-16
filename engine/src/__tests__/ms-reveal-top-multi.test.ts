import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ---------------------------------------------------------------------------
// Family: reveal-top-multi (Collected Company)
//   "Look at the top N cards of your library. Put up to M creature cards with
//    mana value K or less from among them onto the battlefield and the rest on
//    the bottom of your library in a random order."
//
// The matcher emits a ChooseFromTopOfLibrary with destination 'battlefield', a
// type+CMC filter, maxSelections M, restDestination 'bottom'. The executor must
// HONESTLY: reveal exactly N, put up to M revealed cards matching the filter
// onto the battlefield (real zone change + summoning sickness), and bottom every
// other revealed card — leaving the untouched (un-revealed) library intact.
// ---------------------------------------------------------------------------

const bear: CardDefinition = { id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'], power: 2, toughness: 2 };
const elf: CardDefinition = { id: 'elf', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', oracle_text: '', mana_cost: '{G}', cmc: 1, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'], power: 1, toughness: 1 };
const titan: CardDefinition = { id: 'titan', name: 'Primeval Titan', type_line: 'Creature — Giant', oracle_text: '', mana_cost: '{4}{G}{G}', cmc: 6, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'], power: 6, toughness: 6 };
const bolt: CardDefinition = { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'], keywords: [], card_types: ['instant'] };
const forest: CardDefinition = { id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [], card_types: ['land'] };

function mk(id: string, defId: string, owner: string): CardInstance {
  return { instanceId: id, definitionId: defId, ownerId: owner, zone: 'library', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false };
}

// Library order (Map insertion = top-first): the first 6 entries are the "top six".
function ccState(): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map<string, CardInstance>([
      // top six (revealed)
      ['bear1', mk('bear1', 'bear', 'p0')],   // creature cmc 2  -> eligible
      ['titan', mk('titan', 'titan', 'p0')],  // creature cmc 6  -> NOT eligible (mv>3)
      ['elf1', mk('elf1', 'elf', 'p0')],      // creature cmc 1  -> eligible
      ['bolt', mk('bolt', 'bolt', 'p0')],     // instant         -> not a creature
      ['bear2', mk('bear2', 'bear', 'p0')],   // creature cmc 2  -> eligible (but cap is 2)
      ['forest', mk('forest', 'forest', 'p0')], // land          -> not a creature
      // below the top six (must remain untouched on top after the rest are bottomed)
      ['deep1', mk('deep1', 'elf', 'p0')],
      ['deep2', mk('deep2', 'bear', 'p0')],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      ['bear', bear], ['elf', elf], ['titan', titan], ['bolt', bolt], ['forest', forest],
    ]),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 3,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function zone(s: GameState, id: string): string { return s.cards.get(id)!.zone; }
function onBf(s: GameState): string[] {
  return [...s.cards.values()].filter(c => c.zone === 'battlefield').map(c => c.instanceId).sort();
}

const CC_TEXT = 'Look at the top six cards of your library. Put up to two creature cards with mana value 3 or less from among them onto the battlefield and the rest on the bottom of your library in a random order.';

describe('reveal-top-multi: parser', () => {
  it('parses Collected Company into ChooseFromTopOfLibrary → battlefield', () => {
    const p = parseOracleText(CC_TEXT);
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const e = p.effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary') as any;
    expect(e).toBeDefined();
    expect(e.count).toBe(6);
    expect(e.maxSelections).toBe(2);
    expect(e.destination).toBe('battlefield');
    expect(e.restDestination).toBe('bottom');
    expect(e.filter.types).toContain('creature');
    expect(e.filter.cmc).toEqual({ op: 'lte', value: 3 });
  });

  it('parses "permanent cards with mana value K or less" into a permanent filter', () => {
    const p = parseOracleText('Look at the top six cards of your library. Put up to two permanent cards with mana value 5 or less from among them onto the battlefield, and the rest on the bottom of your library in a random order.');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const e = p.effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary') as any;
    expect(e).toBeDefined();
    expect(e.destination).toBe('battlefield');
    expect(e.maxSelections).toBe(2);
    expect(e.filter.permanent).toBe(true);
    expect(e.filter.cmc).toEqual({ op: 'lte', value: 5 });
  });

  it('parses the canonical comma-after-battlefield phrasing', () => {
    const p = parseOracleText('Look at the top six cards of your library. Put up to two creature cards with mana value 3 or less from among them onto the battlefield, and the rest on the bottom of your library in a random order.');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary') as any;
    expect(e?.destination).toBe('battlefield');
  });

  it('honesty guard: instants/sorceries are not permanents → stays Unparsed (cannot enter the battlefield)', () => {
    const p = parseOracleText('Look at the top six cards of your library. Put up to two instant cards from among them onto the battlefield and the rest on the bottom of your library in a random order.');
    const e = p.kind === 'Spell' ? p.effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary') : undefined;
    expect(e).toBeUndefined();
  });

  it('honesty guard: no card-type restriction → stays Unparsed (no trivial battlefield dump)', () => {
    const p = parseOracleText('Look at the top six cards of your library. Put up to two qwerty cards from among them onto the battlefield and the rest on the bottom of your library in a random order.');
    const e = p.kind === 'Spell' ? p.effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary') : undefined;
    expect(e).toBeUndefined();
  });
});

describe('reveal-top-multi: executes honestly', () => {
  it('Collected Company: two eligible creatures hit the battlefield, others bottomed', () => {
    const p = parseOracleText(CC_TEXT);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s = executeEffects(ccState(), p.effects, 'p0', [], []);

    const bf = onBf(s);
    // Genuinely TWO creatures on the battlefield (cap = 2), each cmc <= 3.
    expect(bf.length).toBe(2);
    for (const id of bf) {
      const card = s.cards.get(id)!;
      expect(card.zone).toBe('battlefield');
      expect(card.summoningSick).toBe(true);
      const def = s.cardDefinitions.get(card.definitionId)!;
      expect(def.card_types).toContain('creature');
      expect(def.cmc).toBeLessThanOrEqual(3);
    }
    // The cap means only 2 of the 3 eligible creatures (bear1/elf1/bear2) come down.
    expect(bf.every(id => ['bear1', 'elf1', 'bear2'].includes(id))).toBe(true);

    // The ineligible REVEALED cards (titan mv6, bolt instant, forest land) and the
    // third eligible creature not taken all leave the revealed window: they are
    // bottomed, i.e. still in the library, NOT on the battlefield/hand/graveyard.
    expect(zone(s, 'titan')).toBe('library');
    expect(zone(s, 'bolt')).toBe('library');
    expect(zone(s, 'forest')).toBe('library');

    // No revealed card was lost to hand/graveyard/exile.
    const hand = [...s.cards.values()].filter(c => c.zone === 'hand');
    const yard = [...s.cards.values()].filter(c => c.zone === 'graveyard');
    expect(hand.length).toBe(0);
    expect(yard.length).toBe(0);

    // Cards below the revealed window were never touched.
    expect(zone(s, 'deep1')).toBe('library');
    expect(zone(s, 'deep2')).toBe('library');

    // Conservation: every original card still exists somewhere.
    expect(s.cards.size).toBe(8);
  });

  it('takes only as many as are eligible when fewer than M match', () => {
    const s0 = ccState();
    // Leave a single eligible creature (bear1) in the revealed top-six window: turn
    // the other eligible creatures into non-creatures so only one can be taken.
    s0.cards.get('elf1')!.definitionId = 'forest';   // now a land
    s0.cards.get('bear2')!.definitionId = 'bolt';    // now an instant
    s0.cards.get('deep1')!.definitionId = 'forest';  // deep1 is in the top six → make it a land
    const p = parseOracleText(CC_TEXT);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s = executeEffects(s0, p.effects, 'p0', [], []);
    expect(onBf(s)).toEqual(['bear1']); // exactly one creature could be put down
  });

  it('deterministic: repeated runs produce identical battlefield selections', () => {
    const p = parseOracleText(CC_TEXT);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const a = onBf(executeEffects(ccState(), p.effects, 'p0', [], []));
    const b = onBf(executeEffects(ccState(), p.effects, 'p0', [], []));
    expect(a).toEqual(b);
  });
});
