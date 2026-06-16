import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import { initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import type { CardDefinition, GameState } from '../types';

/**
 * Slice 4 — Per-line union dispatch.
 *
 * A multi-line permanent face that failed as a whole because no single
 * whole-face matcher handles the concatenated text, but EVERY individual
 * line is independently parseable as ETB / Dies / Triggered / Activated /
 * StaticAbility, or is an absorbable engine-keyword / self-cost-reduction line.
 *
 * HONESTY: execution is already per-line in the engine:
 *   - registerContinuousAbilitiesForPermanent (stack.ts) iterates each line for StaticAbility.
 *   - registerBattlefieldAbilities (executor.ts) iterates each line for ETB/Dies/Triggered.
 *   - parseActivatedAbilities (actions.ts) iterates each line for Activated.
 * So crediting the WHOLE face as "parsed" is honest: each line's ability already runs.
 */

// ── helpers ────────────────────────────────────────────────────────────────

function creature(
  id: string,
  opts: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Creature — Test',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{1}',
    cmc: opts.cmc ?? 1,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

/**
 * Set up a game with the given creature definitions; move every card to the
 * battlefield, register continuous abilities, then return state + id-resolver.
 */
function setup(
  p1Defs: CardDefinition[],
  p2Defs: CardDefinition[] = [creature('dummy_p2')],
  zones: Record<string, 'graveyard' | 'library'> = {},
) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'none1' },
    { playerId: 'p2', name: 'Bob', cards: p2Defs, commanderId: 'none2' },
  ];
  let state = initGameState(decks);
  for (const [id, card] of state.cards) {
    const zone = zones[card.definitionId] ?? 'battlefield';
    state.cards.set(id, { ...card, zone, summoningSick: false });
  }
  for (const card of state.cards.values()) {
    if (card.zone === 'battlefield') {
      state = registerContinuousAbilitiesForPermanent(state, card.instanceId);
    }
  }
  const idFor = (defId: string) =>
    [...state.cards.values()].find(c => c.definitionId === defId)!.instanceId;
  return { state, idFor };
}

function setBasicLand(
  state: GameState,
  subtype: 'mountain' | 'plains' | 'forest' | 'island' | 'swamp',
  ownerId: string,
): GameState {
  // Add a basic land of the given type to the battlefield for the given player.
  const defId = `land_${subtype}_${Date.now()}_${Math.random()}`;
  const instanceId = `inst_${defId}`;
  const def: CardDefinition = {
    id: defId,
    name: subtype.charAt(0).toUpperCase() + subtype.slice(1),
    type_line: `Basic Land — ${subtype.charAt(0).toUpperCase() + subtype.slice(1)}`,
    oracle_text: '',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['land'],
    subtypes: [subtype],
  };
  const newState = {
    ...state,
    cards: new Map(state.cards),
    cardDefinitions: new Map(state.cardDefinitions),
  };
  newState.cardDefinitions.set(defId, def);
  newState.cards.set(instanceId, {
    instanceId, definitionId: defId, ownerId, zone: 'battlefield',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  });
  return newState;
}

// ── Recognition tests ───────────────────────────────────────────────────────

describe('Slice 4 — per-line union dispatch: recognition', () => {
  // ── Wild Nacatl family: two conditional statics on separate lines ──────────
  it('Wild Nacatl: two conditional +1/+1 statics on separate lines parse as StaticAbility', () => {
    const r = parseOracleText(
      'This creature gets +1/+1 as long as you control a Mountain.\nThis creature gets +1/+1 as long as you control a Plains.',
    );
    expect(r.kind).toBe('StaticAbility');
  });

  // ── Master of Etherium: CDA line + buff-to-others line ────────────────────
  it('Master of Etherium: CDA line + "Other artifact creatures get +1/+1" parse as StaticAbility', () => {
    const r = parseOracleText(
      "~'s power and toughness are each equal to the number of artifacts you control.\nOther artifact creatures you control get +1/+1.",
    );
    expect(r.kind).toBe('StaticAbility');
  });

  // ── Minotaur Tactician: keyword line + two conditional statics ────────────
  it('Minotaur Tactician: Haste keyword + two conditional self-buff lines parse as StaticAbility', () => {
    const r = parseOracleText(
      'Haste\nThis creature gets +1/+1 as long as you control a white creature.\nThis creature gets +1/+1 as long as you control a blue creature.',
    );
    expect(r.kind).toBe('StaticAbility');
    // The absorbed keyword line is recorded.
    expect(r.absorbedKeywords).toContain('haste');
  });

  // ── Sentence-level handling: repeated conditional statics on ONE oracle LINE ─
  // A multi-line oracle text where one of the lines contains multiple period-
  // separated conditional statics (sentence-level dispatch within per-line).
  it('sentence-level: a keyword line + one line with two period-separated conditional statics', () => {
    // Haste is absorbed. The second line has two period-separated conditional statics.
    const r = parseOracleText(
      'Haste\nThis creature gets +1/+1 as long as you control a Mountain. This creature gets +1/+1 as long as you control a Plains.',
    );
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toContain('haste');
  });

  // ── Honesty gate: a face with an unsupported line keeps the face Unparsed ─
  it('HONESTY: a face with a fully unsupported line stays Unparsed', () => {
    // NOTE: "Morph {2}{G}" was originally used here but is now absorbed by the
    // slice-10 morph absorption pass, so it no longer represents an "unsupported"
    // line. Using a line that the engine genuinely cannot parse instead.
    // "Provoke" is an unimplemented keyword that doesn't parse independently.
    const r = parseOracleText(
      'This creature gets +1/+1 as long as you control a Mountain.\nProvoke',
    );
    expect(r.kind).toBe('Unparsed');
  });

  // ── Honesty gate: keyword-only multi-line face stays Unparsed ─────────────
  it('HONESTY: a multi-line face where ALL lines are engine keywords stays Unparsed (KeywordOnly)', () => {
    const r = parseOracleText('Flying\nTrample\nHaste');
    expect(r.kind).toBe('Unparsed');
  });

  // ── Multi-line face with ETB + keyword line parses as ETB (richest) ────────
  it('ETB + keyword line: richest kind (ETB) is returned as composite kind', () => {
    const r = parseOracleText(
      'Flying\nWhen ~ enters, draw a card.',
    );
    // Existing preamble trimmer already covers this; verify the per-line path
    // does not break it and the result is still ETB.
    expect(r.kind).toBe('ETB');
  });
});

// ── Execution tests ─────────────────────────────────────────────────────────

describe('Slice 4 — per-line union dispatch: execution', () => {
  // ── Wild Nacatl: each conditional static EXECUTES per-line via
  //    registerContinuousAbilitiesForPermanent ────────────────────────────────
  it('Wild Nacatl: +1/+1 for Mountain, +1/+1 for Plains — each conditional is genuinely applied', () => {
    const nacatl = creature('nacatl', {
      name: 'Wild Nacatl',
      oracle_text:
        'This creature gets +1/+1 as long as you control a Mountain.\nThis creature gets +1/+1 as long as you control a Plains.',
      colors: ['G'],
      power: 1,
      toughness: 1,
    });

    const { state: base, idFor } = setup([nacatl]);
    const id = idFor('nacatl');

    // No mountains or plains: base 1/1.
    expect(getEffectivePower(base, id)).toBe(1);
    expect(getEffectiveToughness(base, id)).toBe(1);

    // Add a Mountain: +1/+1 → 2/2.
    const withMountain = setBasicLand(base, 'mountain', 'p1');
    expect(getEffectivePower(withMountain, id)).toBe(2);
    expect(getEffectiveToughness(withMountain, id)).toBe(2);

    // Add a Plains too: both statics fire → 3/3.
    const withBoth = setBasicLand(withMountain, 'plains', 'p1');
    expect(getEffectivePower(withBoth, id)).toBe(3);
    expect(getEffectiveToughness(withBoth, id)).toBe(3);
  });

  // ── Master of Etherium: CDA + buff-to-others both register per-line ────────
  it('Master of Etherium: CDA sets self P/T; "Other artifact creatures get +1/+1" buffs non-self', () => {
    const master = creature('master', {
      name: 'Master of Etherium',
      oracle_text:
        "~'s power and toughness are each equal to the number of artifacts you control.\nOther artifact creatures you control get +1/+1.",
      type_line: 'Artifact Creature — Vedalken Wizard',
      card_types: ['artifact', 'creature'] as CardDefinition['card_types'],
      colors: ['U'],
      power: 0,
      toughness: 0,
    });

    // One other artifact creature on the battlefield alongside Master.
    const moxJet = creature('mox', {
      name: 'Mox Jet',
      type_line: 'Artifact Creature — Construct',
      card_types: ['artifact', 'creature'] as CardDefinition['card_types'],
      oracle_text: '',
      power: 1,
      toughness: 1,
    });

    const { state, idFor } = setup([master, moxJet]);
    const masterId = idFor('master');
    const moxId = idFor('mox');

    // Master controls 2 artifacts (master + mox), so CDA sets base P/T = 2.
    // "Other artifact creatures get +1/+1" does NOT apply to Master itself.
    expect(getEffectivePower(state, masterId)).toBe(2);
    expect(getEffectiveToughness(state, masterId)).toBe(2);

    // The Mox Jet gets +1/+1 from the "Other artifact creatures" static: 2/2.
    expect(getEffectivePower(state, moxId)).toBe(2);
    expect(getEffectiveToughness(state, moxId)).toBe(2);
  });

  // ── Minotaur Tactician: keyword line absorbed; two conditional statics fire ─
  it('Minotaur Tactician: Haste absorbed; conditional +1/+1 lines execute for white/blue creature', () => {
    const tactician = creature('tactician', {
      name: 'Minotaur Tactician',
      oracle_text:
        'Haste\nThis creature gets +1/+1 as long as you control a white creature.\nThis creature gets +1/+1 as long as you control a blue creature.',
      keywords: ['Haste'],
      colors: ['R'],
      power: 2,
      toughness: 2,
    });

    // A white creature for the "white" condition.
    const whiteCreature = creature('white_creature', {
      name: 'White Creature',
      colors: ['W'],
      card_types: ['creature'],
    });

    // A blue creature for the "blue" condition.
    const blueCreature = creature('blue_creature', {
      name: 'Blue Creature',
      colors: ['U'],
      card_types: ['creature'],
    });

    // No other creatures: base 2/2.
    const { state: base, idFor } = setup([tactician]);
    const id = idFor('tactician');
    expect(getEffectivePower(base, id)).toBe(2);
    expect(getEffectiveToughness(base, id)).toBe(2);

    // Add white creature: +1/+1 → 3/3.
    const withWhite = setup([tactician, whiteCreature]);
    const idW = withWhite.idFor('tactician');
    expect(getEffectivePower(withWhite.state, idW)).toBe(3);
    expect(getEffectiveToughness(withWhite.state, idW)).toBe(3);

    // Add blue creature too: both statics fire → 4/4.
    const withBoth = setup([tactician, whiteCreature, blueCreature]);
    const idB = withBoth.idFor('tactician');
    expect(getEffectivePower(withBoth.state, idB)).toBe(4);
    expect(getEffectiveToughness(withBoth.state, idB)).toBe(4);
  });
});
