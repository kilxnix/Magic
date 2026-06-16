/**
 * Parser/executor coverage — slice 9/12 (oracle-parser round 9):
 * Look-at-top-X reorder family (Soothsaying / Information Dealer /
 * Descendant of Soramaro): bare-X form with no "where X is" qualifier,
 * activated-ability body parsing, and ForEach-count variants confirmed.
 */
import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { parseActivatedAbilities } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ─────────────────────── card definitions ───────────────────────
const bear: CardDefinition = {
  id: 'bear', name: 'Bear', type_line: 'Creature — Bear', oracle_text: '',
  mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'], keywords: [],
  card_types: ['creature'], power: 2, toughness: 2,
};
const bolt: CardDefinition = {
  id: 'bolt', name: 'Bolt', type_line: 'Instant', oracle_text: '',
  mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'], keywords: [],
  card_types: ['instant'],
};
const forest: CardDefinition = {
  id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '',
  mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [],
  card_types: ['land'],
};
const artifact: CardDefinition = {
  id: 'artifact', name: 'Artifact', type_line: 'Artifact', oracle_text: '',
  mana_cost: '{2}', cmc: 2, colors: [], color_identity: [], keywords: [],
  card_types: ['artifact'],
};

const DEFS = new Map<string, CardDefinition>([
  ['bear', bear], ['bolt', bolt], ['forest', forest], ['artifact', artifact],
]);

function makeInstance(id: string, defId: string, zone: CardInstance['zone'], ownerId = 'p0'): CardInstance {
  return {
    instanceId: id, definitionId: defId, ownerId, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function buildState(libDefs: string[], battlefieldDefs: string[] = [], handDefs: string[] = []): GameState {
  const cards = new Map<string, CardInstance>();
  battlefieldDefs.forEach((d, i) => cards.set(`bf${i}`, makeInstance(`bf${i}`, d, 'battlefield')));
  libDefs.forEach((d, i) => cards.set(`lib${i}`, makeInstance(`lib${i}`, d, 'library')));
  handDefs.forEach((d, i) => cards.set(`hand${i}`, makeInstance(`hand${i}`, d, 'hand')));
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

// ═══════════════════════════════════════════════════════════════
// 1. Soothsaying: bare-X activated-ability body
// ═══════════════════════════════════════════════════════════════

describe('Slice 9: Soothsaying bare-X reorder (matchLookAtTopXReorderBack)', () => {
  // Soothsaying oracle text (the {X}: line)
  const soothsayingOracle =
    '{X}: Look at the top X cards of your library, then put them back in any order.';

  it('parses as Activated ability with ChooseFromTopOfLibrary effect', () => {
    const abilities = parseActivatedAbilities(soothsayingOracle);
    expect(abilities).toHaveLength(1);
    const ability = abilities[0];
    expect(ability.kind).toBe('ActivatedAbility');
    expect(ability.effects).toHaveLength(1);
    const e = ability.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') {
      throw new Error(`Expected ChooseFromTopOfLibrary, got ${e.kind}`);
    }
    expect(e.count).toEqual({ kind: 'X' });
    expect(e.maxSelections).toBe(0);
    expect(e.restDestination).toBe('top');
    expect(e.player).toEqual({ kind: 'Controller' });
  });

  it('bare X body also parses as Spell (effect clause route)', () => {
    // The body text alone (no cost prefix) should parse to a Spell via parseOracleText
    const bodyText = 'Look at the top X cards of your library, then put them back in any order.';
    const p = parseOracleText(bodyText);
    if (p.kind !== 'Spell') {
      throw new Error(`Expected Spell, got ${p.kind}`);
    }
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') {
      throw new Error(`Expected ChooseFromTopOfLibrary, got ${e.kind}`);
    }
    expect(e.count).toEqual({ kind: 'X' });
    expect(e.maxSelections).toBe(0);
    expect(e.restDestination).toBe('top');
  });

  it('executor: X=0 returns state unchanged (no zone change)', () => {
    const bodyText = 'Look at the top X cards of your library, then put them back in any order.';
    const p = parseOracleText(bodyText);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s0 = buildState(['bear', 'bolt', 'forest', 'artifact']);
    // xValue=0 → count=0 → no cards revealed
    const s = executeEffects(s0, p.effects, 'p0', [], [], 0);
    expect(zoneIds(s, 'library')).toHaveLength(4);
    expect(zoneIds(s, 'hand')).toHaveLength(0);
    expect(zoneIds(s, 'graveyard')).toHaveLength(0);
  });

  it('executor: X=3 keeps all library cards in library (no zone change)', () => {
    const bodyText = 'Look at the top X cards of your library, then put them back in any order.';
    const p = parseOracleText(bodyText);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s0 = buildState(['bear', 'bolt', 'forest', 'artifact']);
    // xValue=3 → count=3 → looks at top 3 cards, puts them all back on top
    const s = executeEffects(s0, p.effects, 'p0', [], [], 3);
    expect(zoneIds(s, 'library')).toHaveLength(4);
    expect(zoneIds(s, 'hand')).toHaveLength(0);
    expect(zoneIds(s, 'graveyard')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Information Dealer: "where X is the number of Wizards..."
//    (already handled by matchLookAtTopDynamicCountReorderBack,
//     confirmed to still parse correctly)
// ═══════════════════════════════════════════════════════════════

describe('Slice 9: Information Dealer where-X reorder (matchLookAtTopDynamicCountReorderBack)', () => {
  // Information Dealer activated ability body
  const infoOracleBody =
    'Look at the top X cards of your library, where X is the number of Wizards on the battlefield, then put them back in any order.';

  it('body parses as Spell with ForEach count (not bare-X form)', () => {
    const p = parseOracleText(infoOracleBody);
    if (p.kind !== 'Spell') {
      throw new Error(`Expected Spell, got ${p.kind}`);
    }
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') {
      throw new Error(`Expected ChooseFromTopOfLibrary, got ${e.kind}`);
    }
    // count should be a ForEach amount (not {kind:'X'}) because of "where X is"
    expect(typeof e.count).not.toBe('number');
    expect(e.count).not.toEqual({ kind: 'X' });
    expect(e.maxSelections).toBe(0);
    expect(e.restDestination).toBe('top');
  });

  it('executor: keeps all library cards in library when no Wizards on battlefield', () => {
    const p = parseOracleText(infoOracleBody);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s0 = buildState(['bear', 'bolt', 'forest']);
    // No Wizards → count=0 → nothing happens
    const s = executeEffects(s0, p.effects, 'p0', [], [], 0);
    expect(zoneIds(s, 'library')).toHaveLength(3);
    expect(zoneIds(s, 'hand')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Descendant of Soramaro: "where X is the number of cards in your hand"
//    (also handled by matchLookAtTopDynamicCountReorderBack)
// ═══════════════════════════════════════════════════════════════

describe('Slice 9: Descendant of Soramaro where-X reorder (matchLookAtTopDynamicCountReorderBack)', () => {
  // Descendant of Soramaro activated ability body
  const descendantBody =
    'Look at the top X cards of your library, where X is the number of cards in your hand. Put them back in any order.';

  it('body parses as Spell with ForEach count', () => {
    const p = parseOracleText(descendantBody);
    if (p.kind !== 'Spell') {
      throw new Error(`Expected Spell, got ${p.kind}`);
    }
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') {
      throw new Error(`Expected ChooseFromTopOfLibrary, got ${e.kind}`);
    }
    // count should be a ForEach amount reflecting hand size
    expect(typeof e.count).not.toBe('number');
    expect(e.count).not.toEqual({ kind: 'X' });
    expect(e.maxSelections).toBe(0);
    expect(e.restDestination).toBe('top');
  });

  it('executor: with 2 cards in hand, looks at top 2 and returns them (no zone change)', () => {
    const p = parseOracleText(descendantBody);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // 2 cards in hand → ForEach resolves to 2
    const s0 = buildState(['bear', 'bolt', 'forest', 'artifact'], [], ['bear', 'bolt']);
    const s = executeEffects(s0, p.effects, 'p0', [], [], 0);
    expect(zoneIds(s, 'library')).toHaveLength(4);
    expect(zoneIds(s, 'hand')).toHaveLength(2);
    expect(zoneIds(s, 'graveyard')).toHaveLength(0);
  });

  it('no collision: bare-X form does NOT match text with "where X is" qualifier', () => {
    // The guard in matchLookAtTopXReorderBack explicitly rejects ", where" prefix.
    // Verify the "where" form still goes to the dynamic-count matcher, not the bare-X one.
    const p = parseOracleText(descendantBody);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('wrong kind');
    // count must NOT be {kind:'X'} (that would mean the bare-X matcher fired erroneously)
    expect(e.count).not.toEqual({ kind: 'X' });
  });
});
