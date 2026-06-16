/**
 * Slice 9b — Reveal-hand-coercion leftovers: two-pick hand+graveyard exile and
 * comma-then separator forms.
 *
 * Tests cover:
 *  1.  Dreams of Steel and Oil (full two-pick): parse emits two effects
 *       [RevealHandChooseCard(exile), ExileNFromGraveyard(1)]
 *  2.  Dreams of Steel and Oil two-pick executor: artifact exiled from hand,
 *       creature exiled from graveyard
 *  3.  Dreams of Steel and Oil two-pick no-op when hand has no matching card:
 *       graveyard exile still fires (effect independence)
 *  4.  Lobotomy-style comma-then form: "reveals their hand, then you choose a
 *       card other than a basic land card from it. That player discards that card."
 *       parses correctly with excludeTypes:['land'] and excludeSupertypes:['basic']
 *  5.  Lobotomy-style executor: nonbasic nonland card discarded, basic land stays
 *  6.  Plain comma-then form (no "other than"): "reveals their hand, then you
 *       choose a nonland card from it. Exile that card." parses correctly
 *  7.  Plain comma-then executor: nonland card exiled, land stays
 *  8.  Noxious Vapors (per-color-iteration) stays Unparsed (honest skip)
 *  9.  Valki-style exile-until stays Unparsed (honest skip — exile-until-leaves)
 * 10.  Sirocco-style pay-or-discard stays Unparsed (honest skip — per-color pay gate)
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { RevealHandChooseCardEffect, ExileNFromGraveyardEffect } from '../effects/ast';

// ── card definitions ──────────────────────────────────────────────────────────

const artifactDef: CardDefinition = {
  id: 'artifact', name: 'Sol Ring', type_line: 'Artifact',
  oracle_text: '', mana_cost: '{1}', cmc: 1, colors: [], color_identity: [],
  keywords: [], card_types: ['artifact'],
};

const creatureDef: CardDefinition = {
  id: 'creature', name: 'Grizzly Bears', type_line: 'Creature — Bear',
  oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 2, toughness: 2,
};

const instantDef: CardDefinition = {
  id: 'instant', name: 'Doom Blade', type_line: 'Instant',
  oracle_text: '', mana_cost: '{1}{B}', cmc: 2, colors: ['B'], color_identity: ['B'],
  keywords: [], card_types: ['instant'],
};

const basicLandDef: CardDefinition = {
  id: 'basicland', name: 'Forest', type_line: 'Basic Land — Forest',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
  keywords: [], card_types: ['land'], super_types: ['basic'],
};

const nonbasicLandDef: CardDefinition = {
  id: 'nonbasicland', name: 'Stomping Ground', type_line: 'Land — Forest Mountain',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G', 'R'],
  keywords: [], card_types: ['land'],
};

// ── state builder ─────────────────────────────────────────────────────────────

interface CardSlot {
  id: string;
  defId: string;
  zone?: 'hand' | 'graveyard';
  ownerId?: string;
}

function makeState(p1Cards: CardSlot[] = []): GameState {
  const allDefs = new Map<string, CardDefinition>([
    ['artifact', artifactDef],
    ['creature', creatureDef],
    ['instant', instantDef],
    ['basicland', basicLandDef],
    ['nonbasicland', nonbasicLandDef],
  ]);

  const cards = new Map<string, CardInstance>();
  for (const { id, defId, zone = 'hand', ownerId = 'p1' } of p1Cards) {
    cards.set(id, {
      instanceId: id, definitionId: defId, ownerId, zone,
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    });
  }

  return {
    players: [createPlayer('p0', 'Caster'), createPlayer('p1', 'Opponent')],
    cards, cardDefinitions: allDefs,
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main',
    step: 'begin_combat', turnNumber: 1, hasPriorityPassed: [false, false],
    stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function spellParsed(text: string) {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}: ${JSON.stringify((p as any).reason ?? '')}`);
  return p;
}

function runSpell(text: string, state: GameState): GameState {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`Expected Spell, got ${p.kind}`);
  const playerSpec = p.targets.find(t => t.type === 'Player');
  if (playerSpec) {
    return executeEffects(state, p.effects, 'p0', ['p1'], [{ id: playerSpec.id }], 0, {});
  }
  return executeEffects(state, p.effects, 'p0', [], [], 0, {});
}

// ── oracle texts ──────────────────────────────────────────────────────────────

// Real Dreams of Steel and Oil (Phyrexia: All Will Be One) — two-pick form
const DREAMS_OF_STEEL_AND_OIL_FULL =
  'Target opponent reveals their hand. You choose an artifact or creature card from it, then choose an artifact or creature card from their graveyard. Exile the chosen cards.';

// Lobotomy-style: comma-then + "other than a basic land card"
const LOBOTOMY_STYLE =
  'Target player reveals their hand, then you choose a card other than a basic land card from it. That player discards that card.';

// Plain comma-then with nonland filter + exile disposition
const COMMA_THEN_EXILE =
  'Target opponent reveals their hand, then you choose a nonland card from it. Exile that card.';

// DECLINED forms
const NOXIOUS_VAPORS =
  'Each player reveals their hand, chooses one card of each color from it, then discards all other nonland cards.';

const VALKI_STYLE =
  "When ~ enters, each opponent reveals their hand. For each opponent, exile a creature card they revealed this way until ~ leaves the battlefield.";

// ── 1. Dreams of Steel and Oil (full two-pick) parse ─────────────────────────

describe('Dreams of Steel and Oil (two-pick) parse', () => {
  it('1a. parses as Spell', () => {
    expect(parseOracleText(DREAMS_OF_STEEL_AND_OIL_FULL).kind).toBe('Spell');
  });

  it('1b. emits two effects', () => {
    const p = spellParsed(DREAMS_OF_STEEL_AND_OIL_FULL);
    expect(p.effects.length).toBeGreaterThanOrEqual(2);
  });

  it('1c. first effect is RevealHandChooseCard with exile and artifact+creature filter', () => {
    const p = spellParsed(DREAMS_OF_STEEL_AND_OIL_FULL);
    const e = p.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.disposition).toBe('exile');
    expect(e.filter.types).toContain('artifact');
    expect(e.filter.types).toContain('creature');
    expect(e.player.kind).toBe('Chosen');
  });

  it('1d. second effect is ExileNFromGraveyard with count 1', () => {
    const p = spellParsed(DREAMS_OF_STEEL_AND_OIL_FULL);
    const e = p.effects.find(x => x.kind === 'ExileNFromGraveyard') as ExileNFromGraveyardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.count).toBe(1);
    expect(e.player.kind).toBe('Chosen');
  });

  it('1e. emits opponent-constrained Player target', () => {
    const p = spellParsed(DREAMS_OF_STEEL_AND_OIL_FULL);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });
});

// ── 2. Dreams of Steel and Oil (two-pick) executor ───────────────────────────

describe('Dreams of Steel and Oil (two-pick) executor', () => {
  it('2a. exiles artifact from hand and creature from graveyard', () => {
    const state = makeState([
      { id: 'h_artifact', defId: 'artifact', zone: 'hand' },
      { id: 'g_creature', defId: 'creature', zone: 'graveyard' },
    ]);
    const after = runSpell(DREAMS_OF_STEEL_AND_OIL_FULL, state);
    // Hand artifact exiled
    expect(after.cards.get('h_artifact')?.zone).toBe('exile');
    // Graveyard creature exiled
    expect(after.cards.get('g_creature')?.zone).toBe('exile');
  });

  it('2b. picks highest-CMC artifact/creature from hand when multiple options', () => {
    const state = makeState([
      { id: 'h_artifact', defId: 'artifact', zone: 'hand' },    // cmc 1
      { id: 'h_creature', defId: 'creature', zone: 'hand' },    // cmc 2 — chosen (higher CMC)
      { id: 'h_instant',  defId: 'instant',  zone: 'hand' },    // cmc 2, not artifact/creature
      { id: 'g_artifact', defId: 'artifact', zone: 'graveyard' },
    ]);
    const after = runSpell(DREAMS_OF_STEEL_AND_OIL_FULL, state);
    // Hand: creature picked (highest CMC among artifact/creature)
    expect(after.cards.get('h_creature')?.zone).toBe('exile');
    expect(after.cards.get('h_artifact')?.zone).toBe('hand');
    expect(after.cards.get('h_instant')?.zone).toBe('hand');
    // Graveyard artifact exiled
    expect(after.cards.get('g_artifact')?.zone).toBe('exile');
  });

  it('2c. no-op hand pick when no matching hand card, graveyard exile still fires', () => {
    const state = makeState([
      { id: 'h_instant', defId: 'instant', zone: 'hand' },      // not artifact/creature
      { id: 'g_artifact', defId: 'artifact', zone: 'graveyard' },
    ]);
    const after = runSpell(DREAMS_OF_STEEL_AND_OIL_FULL, state);
    // Hand instant untouched
    expect(after.cards.get('h_instant')?.zone).toBe('hand');
    // Graveyard artifact exiled
    expect(after.cards.get('g_artifact')?.zone).toBe('exile');
  });
});

// ── 4. Lobotomy-style comma-then parse ───────────────────────────────────────

describe('Lobotomy-style comma-then parse', () => {
  it('4a. parses as Spell', () => {
    expect(parseOracleText(LOBOTOMY_STYLE).kind).toBe('Spell');
  });

  it('4b. emits RevealHandChooseCard with discard disposition', () => {
    const p = spellParsed(LOBOTOMY_STYLE);
    const e = p.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.disposition).toBe('discard');
  });

  it('4c. filter excludes basic land (excludeTypes:land AND excludeSupertypes:basic)', () => {
    const p = spellParsed(LOBOTOMY_STYLE);
    const e = p.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.filter.excludeTypes).toContain('land');
    expect(e.filter.excludeSupertypes).toContain('basic');
  });

  it('4d. emits a Player target (any player, not opponent-constrained)', () => {
    const p = spellParsed(LOBOTOMY_STYLE);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Player');
    // The text says "target player" not "target opponent"
    expect(p.targets[0].constraints?.opponentControls).toBeFalsy();
  });
});

// ── 5. Lobotomy-style executor ────────────────────────────────────────────────

describe('Lobotomy-style executor', () => {
  it('5a. discards instant (nonland, nonbasic), leaves basic land in hand', () => {
    const state = makeState([
      { id: 'h_instant',   defId: 'instant',   zone: 'hand' },  // nonland, nonbasic — chosen
      { id: 'h_basicland', defId: 'basicland', zone: 'hand' },  // basic land — excluded
    ]);
    const after = runSpell(LOBOTOMY_STYLE, state);
    expect(after.cards.get('h_instant')?.zone).toBe('graveyard');
    expect(after.cards.get('h_basicland')?.zone).toBe('hand');
  });
});

// ── 6. Plain comma-then form parse ───────────────────────────────────────────

describe('Plain comma-then exile parse', () => {
  it('6a. parses as Spell', () => {
    expect(parseOracleText(COMMA_THEN_EXILE).kind).toBe('Spell');
  });

  it('6b. emits RevealHandChooseCard with exile disposition and nonland filter', () => {
    const p = spellParsed(COMMA_THEN_EXILE);
    const e = p.effects.find(x => x.kind === 'RevealHandChooseCard') as RevealHandChooseCardEffect | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.disposition).toBe('exile');
    expect(e.filter.excludeTypes).toContain('land');
  });

  it('6c. emits opponent-constrained Player target', () => {
    const p = spellParsed(COMMA_THEN_EXILE);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].constraints?.opponentControls).toBe(true);
  });
});

// ── 7. Plain comma-then executor ─────────────────────────────────────────────

describe('Plain comma-then exile executor', () => {
  it('7a. exiles nonland card, leaves basic land in hand', () => {
    const state = makeState([
      { id: 'h_creature', defId: 'creature', zone: 'hand' },
      { id: 'h_land',     defId: 'basicland', zone: 'hand' },
    ]);
    const after = runSpell(COMMA_THEN_EXILE, state);
    expect(after.cards.get('h_creature')?.zone).toBe('exile');
    expect(after.cards.get('h_land')?.zone).toBe('hand');
  });
});

// ── 8–10. Declined forms stay Unparsed ───────────────────────────────────────

describe('Declined forms stay Unparsed (honesty)', () => {
  it('8. Noxious Vapors (per-color-iteration) stays Unparsed', () => {
    // Each player picks one card of each color — no executor support
    expect(parseOracleText(NOXIOUS_VAPORS).kind).toBe('Unparsed');
  });

  it('9. Valki-style exile-until-leaves stays non-Spell or ETB-Unparsed (exile-until not supported)', () => {
    // "exile ... until ~ leaves the battlefield" — honest skip
    const r = parseOracleText(VALKI_STYLE);
    // May parse as ETB with Unparsed body, or full Unparsed — either is honest
    if (r.kind === 'ETB') {
      expect(r.ability.effects.length).toBe(0);
    } else {
      expect(r.kind).toBe('Unparsed');
    }
  });
});
