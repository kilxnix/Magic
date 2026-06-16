/**
 * Parser/executor coverage — slice 4/12 (oracle-parser round 8):
 * Target-player/opponent library digs and peeks.
 *
 * Covers three families:
 *   1. Pure look (LookAtTopOfLibrary) — Orcish Spy / Merfolk Observer /
 *      Dewdrop Spy / Saheeli's Silverwing
 *   2. Look-then-may-mill — Draugr Thought-Thief / Eye Spy / Wu Spy /
 *      Lurking Informant
 *   3. Exile-one-rest-back — Sealed Fate / Cruel Fate / Ransack
 */
import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect } from '../effects/ast';
import type { TargetSpec } from '../effects/targets';

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
  id: 'artifact', name: 'Mox Ruby', type_line: 'Artifact', oracle_text: '',
  mana_cost: '{0}', cmc: 0, colors: [], color_identity: [], keywords: [], card_types: ['artifact'],
};

const DEFS = new Map<string, CardDefinition>([
  ['bear', bear], ['bolt', bolt], ['forest', forest], ['artifact', artifact],
]);

function makeInstance(id: string, defId: string, zone: CardInstance['zone'], ownerId = 'p0'): CardInstance {
  return { instanceId: id, definitionId: defId, ownerId, zone, tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false };
}

/**
 * Build a two-player state where p1 has `p1LibDefs` cards in their library
 * (the target player's library). p0 is the caster.
 */
function buildState(p1LibDefs: string[] = []): GameState {
  const cards = new Map<string, CardInstance>();
  p1LibDefs.forEach((d, i) =>
    cards.set(`p1lib${i}`, makeInstance(`p1lib${i}`, d, 'library', 'p1')));
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

function zoneIds(s: GameState, zone: CardInstance['zone'], ownerId?: string): string[] {
  return [...s.cards.values()]
    .filter(c => c.zone === zone && (ownerId === undefined || c.ownerId === ownerId))
    .map(c => c.instanceId);
}

/** Run effects with p1 as the chosen target player. */
function runWithTargetP1(
  effects: Effect[],
  targetSpecs: TargetSpec[],
  state: GameState,
  xValue = 0,
  namedChoices?: Record<string, string>,
): GameState {
  const playerSpec = targetSpecs.find(t => t.type === 'Player');
  const ids = playerSpec ? ['p1'] : [];
  const specs = playerSpec ? [{ id: playerSpec.id }] : [];
  return executeEffects(state, effects, 'p0', ids, specs, xValue, namedChoices ? { namedCardChoices: namedChoices } : {});
}

// ═══════════════════════════════════════════════════════════════
// 1. Pure look family (LookAtTopOfLibrary)
// ═══════════════════════════════════════════════════════════════

describe('pure look family — LookAtTopOfLibrary (Orcish Spy / Merfolk Observer)', () => {
  it('Orcish Spy activated ability: parses to LookAtTopOfLibrary with target player', () => {
    // Orcish Spy: {T}: Look at the top three cards of target player's library.
    const text = "{T}: Look at the top three cards of target player's library.";
    const p = parseOracleText(text);
    // Activated abilities parse as kind='Activated'
    if (p.kind !== 'Activated') throw new Error(`expected Activated, got ${p.kind}`);
    const ability = p.abilities[0];
    const e = ability.effects[0];
    if (e.kind !== 'LookAtTopOfLibrary') throw new Error(`expected LookAtTopOfLibrary, got ${e.kind}`);
    expect(e.count).toBe(3);
    expect(e.player.kind).toBe('Chosen');
    expect(ability.targets).toHaveLength(1);
    expect(ability.targets[0].type).toBe('Player');
    // Not restricted to opponents only
    expect(ability.targets[0].constraints?.opponentControls).toBeFalsy();
  });

  it('Merfolk Observer ETB: parses to LookAtTopOfLibrary with target opponent, count=1', () => {
    // Merfolk Observer: When ~ ETB, look at the top card of target opponent's library.
    const text = "When Merfolk Observer enters the battlefield, look at the top card of target opponent's library.";
    const p = parseOracleText(text);
    if (p.kind !== 'ETB') throw new Error(`expected ETB, got ${p.kind}`);
    const e = p.ability.effects[0];
    if (e.kind !== 'LookAtTopOfLibrary') throw new Error(`expected LookAtTopOfLibrary, got ${e.kind}`);
    expect(e.count).toBe(1);
    expect(e.player.kind).toBe('Chosen');
    // ETB targets are in p.targets (top-level on the parse result)
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });

  it("Saheeli's Silverwing ETB (3 cards): parses to LookAtTopOfLibrary count=3", () => {
    const text = "When Saheeli's Silverwing enters the battlefield, look at the top three cards of target opponent's library.";
    const p = parseOracleText(text);
    if (p.kind !== 'ETB') throw new Error(`expected ETB, got ${p.kind}`);
    const e = p.ability.effects[0];
    if (e.kind !== 'LookAtTopOfLibrary') throw new Error(`expected LookAtTopOfLibrary, got ${e.kind}`);
    expect(e.count).toBe(3);
    expect(e.player.kind).toBe('Chosen');
  });

  it('LookAtTopOfLibrary executes as no-op: target library unchanged', () => {
    const text = "{T}: Look at the top three cards of target player's library.";
    const p = parseOracleText(text);
    if (p.kind !== 'Activated') throw new Error('x');
    const ability = p.abilities[0];
    const s0 = buildState(['bear', 'bolt', 'forest']);
    const s = runWithTargetP1(ability.effects, ability.targets, s0);
    // All three cards should still be in p1's library
    expect(zoneIds(s, 'library', 'p1')).toHaveLength(3);
    expect(zoneIds(s, 'graveyard', 'p1')).toHaveLength(0);
    expect(zoneIds(s, 'hand', 'p1')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Look-then-may-mill family
// ═══════════════════════════════════════════════════════════════

describe('look-then-may-mill family (Draugr Thought-Thief / Eye Spy / Lurking Informant)', () => {
  it('Draugr Thought-Thief ETB: parses to LookAtTopOfLibrary + ChooseFromTopOfLibrary', () => {
    // Draugr Thought-Thief: When ~ ETB, look at the top card of target opponent's library.
    //   You may put that card into their graveyard.
    const text = "When Draugr Thought-Thief enters the battlefield, look at the top card of target opponent's library. You may put that card into their graveyard.";
    const p = parseOracleText(text);
    if (p.kind !== 'ETB') throw new Error(`expected ETB, got ${p.kind}`);
    expect(p.ability.effects).toHaveLength(2);

    const look = p.ability.effects[0];
    if (look.kind !== 'LookAtTopOfLibrary') throw new Error(`expected LookAtTopOfLibrary, got ${look.kind}`);
    expect(look.count).toBe(1);
    expect(look.player.kind).toBe('Chosen');

    const choose = p.ability.effects[1];
    if (choose.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${choose.kind}`);
    expect(choose.count).toBe(1);
    expect(choose.destination).toBe('graveyard');
    expect(choose.restDestination).toBe('top');
    expect(choose.minSelections).toBe(0);
    expect(choose.maxSelections).toBe(1);
    // Both effects share the same player target
    expect(choose.player.kind).toBe('Chosen');
    // ETB targets accessible at top level
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('Eye Spy (2 cards): parses to LookAtTopOfLibrary count=2 + may-mill', () => {
    // Eye Spy: Look at the top two cards of target opponent's library.
    //   You may put one of them into their graveyard.
    const text = "Look at the top two cards of target opponent's library. You may put one of them into their graveyard.";
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
    expect(p.effects).toHaveLength(2);

    const look = p.effects[0];
    if (look.kind !== 'LookAtTopOfLibrary') throw new Error(`expected LookAtTopOfLibrary, got ${look.kind}`);
    expect(look.count).toBe(2);

    const choose = p.effects[1];
    if (choose.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${choose.kind}`);
    expect(choose.count).toBe(2);
    expect(choose.destination).toBe('graveyard');
    expect(choose.minSelections).toBe(0);
    expect(choose.maxSelections).toBe(1);
  });

  it('Lurking Informant activated ability: target player variant (not opponent-only)', () => {
    // Lurking Informant: {1},{T}: Look at the top card of target player's library.
    //   You may put that card into that player's graveyard.
    const text = "{1},{T}: Look at the top card of target player's library. You may put that card into that player's graveyard.";
    const p = parseOracleText(text);
    if (p.kind !== 'Activated') throw new Error(`expected Activated, got ${p.kind}`);
    const ability = p.abilities[0];
    const look = ability.effects[0];
    if (look.kind !== 'LookAtTopOfLibrary') throw new Error(`expected LookAtTopOfLibrary, got ${look.kind}`);
    const choose = ability.effects[1];
    if (choose.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${choose.kind}`);
    expect(choose.destination).toBe('graveyard');
    expect(choose.restDestination).toBe('top');
    // Player spec should NOT be opponent-only
    expect(ability.targets[0].constraints?.opponentControls).toBeFalsy();
  });

  it('may-mill executes: no selection = 0 cards milled (fallback=0)', () => {
    const text = "Look at the top card of target opponent's library. You may put that card into their graveyard.";
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('x');
    const s0 = buildState(['bear', 'bolt']);
    const s = runWithTargetP1(p.effects, p.targets, s0);
    expect(zoneIds(s, 'library', 'p1')).toHaveLength(2);
    expect(zoneIds(s, 'graveyard', 'p1')).toHaveLength(0);
  });

  it('may-mill executes: mills exactly 1 card when selection provided', () => {
    const text = "Look at the top card of target opponent's library. You may put that card into their graveyard.";
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('x');
    const s0 = buildState(['bear', 'bolt']);
    const topCardId = 'p1lib0';
    const s = runWithTargetP1(p.effects, p.targets, s0, 0, { lookTopTargetMayMillIds: topCardId });
    expect(zoneIds(s, 'graveyard', 'p1')).toContain(topCardId);
    expect(zoneIds(s, 'library', 'p1')).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Exile-one-rest-back family (Sealed Fate / Cruel Fate / Ransack)
// ═══════════════════════════════════════════════════════════════

describe('exile-one-rest-back family (Sealed Fate / Cruel Fate / Ransack)', () => {
  it('Sealed Fate (X exile variant): parses to ChooseFromTopOfLibrary destination=exile', () => {
    // Sealed Fate: Look at the top X cards of target opponent's library.
    //   Exile one of those cards face down and put the rest back on top of that library in any order.
    const text = "Look at the top X cards of target opponent's library. Exile one of those cards face down and put the rest back on top of that library in any order.";
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.count).toEqual({ kind: 'X' });
    expect(e.destination).toBe('exile');
    expect(e.restDestination).toBe('top');
    expect(e.minSelections).toBe(1);
    expect(e.maxSelections).toBe(1);
    expect(e.player.kind).toBe('Chosen');
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('Cruel Fate (5-card graveyard variant): parses to ChooseFromTopOfLibrary destination=graveyard', () => {
    // Cruel Fate: Look at the top five cards of target opponent's library.
    //   Put one of those cards into their graveyard and the rest on top of that library in any order.
    const text = "Look at the top five cards of target opponent's library. Put one of those cards into their graveyard and the rest on top of that library in any order.";
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.count).toBe(5);
    expect(e.destination).toBe('graveyard');
    expect(e.restDestination).toBe('top');
    expect(e.minSelections).toBe(1);
    expect(e.maxSelections).toBe(1);
  });

  it('Ransack (4-card graveyard variant): parses correctly with "back" keyword', () => {
    // Ransack: Look at the top four cards of target opponent's library. Put one of those cards into
    //   their graveyard and the rest back on top of that library in any order.
    const text = "Look at the top four cards of target opponent's library. Put one of those cards into their graveyard and the rest back on top of that library in any order.";
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
    expect(e.count).toBe(4);
    expect(e.destination).toBe('graveyard');
    expect(e.restDestination).toBe('top');
    expect(e.fallbackSelectionCount).toBe(1);
  });

  it('Cruel Fate executes: first card of target library goes to graveyard, rest stay on top', () => {
    const text = "Look at the top five cards of target opponent's library. Put one of those cards into their graveyard and the rest on top of that library in any order.";
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('x');
    const s0 = buildState(['bear', 'bolt', 'forest', 'artifact', 'bear']);
    // No explicit selection: fallback takes the first revealed card
    const s = runWithTargetP1(p.effects, p.targets, s0);
    // One card moved to graveyard; remaining 4 stay in library
    expect(zoneIds(s, 'graveyard', 'p1')).toHaveLength(1);
    expect(zoneIds(s, 'library', 'p1')).toHaveLength(4);
  });

  it('Sealed Fate executes: first revealed card goes to exile, rest stay in library', () => {
    const text = "Look at the top X cards of target opponent's library. Exile one of those cards face down and put the rest back on top of that library in any order.";
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('x');
    const s0 = buildState(['bear', 'bolt', 'forest']);
    // X=3: reveal top 3, exile 1, put 2 back
    const s = runWithTargetP1(p.effects, p.targets, s0, 3);
    expect(zoneIds(s, 'exile', 'p1')).toHaveLength(1);
    expect(zoneIds(s, 'library', 'p1')).toHaveLength(2);
    expect(zoneIds(s, 'graveyard', 'p1')).toHaveLength(0);
  });
});
