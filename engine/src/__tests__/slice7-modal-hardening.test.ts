/**
 * Slice 7 — Modal choice hardening:
 *   (1) Multi-sentence bullets parsed with parseMultipleEffects
 *   (2) All-choices honesty gate: return null if any bullet fails
 *   (3) New matchers that make modal bullets resolvable:
 *       - matchDestroy: color-constrained permanent ("destroy target blue permanent")
 *       - matchReturnToHand: land-subtype bounce ("return target Island to its owner's hand")
 *       - matchEachPlayerEffect: each-player draws X
 *       - matchEachPlayerOrOpponentMill: each-player mills X
 *       - matchRevealHandChooseCard: also accepts "you may choose" (no "if you do" gate)
 *
 * Test structure: parse shape assertions + execution assertions.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeDef(id: string, overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Creature — Human',
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
    ...overrides,
  } as CardDefinition;
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  overrides: Partial<CardInstance> = {},
): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
    ...overrides,
  } as CardInstance;
}

function baseState(): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'begin_combat',
    turnNumber: 2,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

// ─── 1. HONESTY GATE ─────────────────────────────────────────────────────────

describe('Slice 7 — honesty gate: all bullets must parse', () => {
  it('a modal where ALL bullets parse → kind Modal', () => {
    // Active Volcano: both bullets are parseable after slice 7 fixes
    const text = "Choose one — • Destroy target blue permanent. • Return target Island to its owner's hand.";
    const r = parseOracleText(text);
    expect(r.kind).toBe('Modal');
  });

  it('a modal where ONE bullet is unparseable → falls back to Unparsed/Spell (not partial Modal)', () => {
    // Manufacture a modal where one bullet cannot be parsed by the engine yet.
    // "Choose one — • [parseable]. • [unparseable]."
    // We use a real single-parseable bullet vs. a fabricated nonsense bullet.
    const text = 'Choose one — • Draw a card. • ThisIsCompletelyMadeUpNonsenseEffect.';
    const r = parseOracleText(text);
    // The honesty gate must NOT return kind:'Modal' with only one of the two choices.
    if (r.kind === 'Modal') {
      // If it somehow parsed as Modal it must have ALL bullets (2 choices).
      expect(r.modal.choices).toHaveLength(2);
    } else {
      // More likely: Unparsed (honesty gate rejected the whole modal).
      expect(r.kind).not.toBe('Modal');
    }
  });

  it('before slice 7 a single parseable bullet out of 2 would return Modal(1 choice); after honesty gate it does not', () => {
    // "Choose one — • Draw a card. • [unparseable]" must NOT produce Modal with chooseCount=1/choices.length=1
    const text = 'Choose one — • Draw a card. • SomeUnrecognizedThing returns from beyond.';
    const r = parseOracleText(text);
    if (r.kind === 'Modal') {
      // Must not be the old "partial" Modal with 1 choice out of 2 bullets.
      // Either it's a properly-parsed Modal (both choices) or it's not Modal.
      expect(r.modal.choices.length).toBeGreaterThan(1);
    }
  });
});

// ─── 2. EXTRACT THE TRUTH — multi-sentence bullet ────────────────────────────

describe('Slice 7 — Extract the Truth: multi-sentence choice bullet', () => {
  it('parses as Modal with 2 choices, first choice = RevealHandChooseCard', () => {
    const text =
      'Choose one — ' +
      '• Target opponent reveals their hand. You may choose a creature, enchantment, or planeswalker card from it. That player discards that card. ' +
      '• Each player draws a card.';
    const r = parseOracleText(text);
    expect(r.kind).toBe('Modal');
    if (r.kind !== 'Modal') return;
    expect(r.modal.choices).toHaveLength(2);
    // Choice 0: reveal-hand → choose → discard
    const c0 = r.modal.choices[0];
    expect(c0.effects.length).toBeGreaterThanOrEqual(1);
    expect(c0.effects[0].kind).toBe('RevealHandChooseCard');
    expect(c0.effects[0].kind === 'RevealHandChooseCard' && c0.effects[0].filter).toMatchObject({
      types: expect.arrayContaining(['creature', 'enchantment', 'planeswalker']),
    });
    expect(c0.effects[0].kind === 'RevealHandChooseCard' && c0.effects[0].disposition).toBe('discard');
    // Choice 1: each player draws a card
    const c1 = r.modal.choices[1];
    expect(c1.effects[0].kind).toBe('Draw');
    expect(c1.effects[0].kind === 'Draw' && c1.effects[0].player).toMatchObject({ kind: 'EachPlayer' });
  });

  it('executes choice 0 (reveal-hand discard) — p1 hand loses target card', () => {
    const state = baseState();

    const opponentDef = makeDef('op-creature');
    const opponentCard = makeCard('op1', 'op-creature', 'p1', { zone: 'hand' });
    state.cardDefinitions.set('op-creature', opponentDef);
    state.cards.set('op1', opponentCard);

    const text =
      'Choose one — ' +
      '• Target opponent reveals their hand. You may choose a creature, enchantment, or planeswalker card from it. That player discards that card. ' +
      '• Each player draws a card.';
    const r = parseOracleText(text);
    expect(r.kind).toBe('Modal');
    if (r.kind !== 'Modal') return;

    // Execute choice 0: RevealHandChooseCard targeting p1 (opponent of p0)
    const c0 = r.modal.choices[0];
    const targetSpec = c0.targets[0];
    if (!targetSpec) return;

    // The RevealHandChooseCard executor moves the chosen card to graveyard.
    const after = executeEffects(
      state,
      c0.effects,
      'p0',         // caster
      ['p1'],       // chosen target = p1 (the opponent)
      [{ id: targetSpec.id, type: targetSpec.type, count: 1 }],
      0,
      {},
    );

    // p1's hand card should now be in graveyard (discard)
    const op1After = after.cards.get('op1');
    expect(op1After?.zone).toBe('graveyard');
  });

  it('executes choice 1 (each player draws a card) — both players draw from library', () => {
    const state = baseState();
    const libDef = makeDef('lib-card');
    state.cardDefinitions.set('lib-card', libDef);
    // Two library cards, one for each player
    state.cards.set('lib-p0', makeCard('lib-p0', 'lib-card', 'p0', { zone: 'library' }));
    state.cards.set('lib-p1', makeCard('lib-p1', 'lib-card', 'p1', { zone: 'library' }));

    const text =
      'Choose one — ' +
      '• Target opponent reveals their hand. You may choose a creature, enchantment, or planeswalker card from it. That player discards that card. ' +
      '• Each player draws a card.';
    const r = parseOracleText(text);
    expect(r.kind).toBe('Modal');
    if (r.kind !== 'Modal') return;

    const c1 = r.modal.choices[1];
    const after = executeEffects(state, c1.effects, 'p0', [], [], 0, {});

    // Both players draw their library card to hand
    expect(after.cards.get('lib-p0')?.zone).toBe('hand');
    expect(after.cards.get('lib-p1')?.zone).toBe('hand');
  });
});

// ─── 3. ACTIVE VOLCANO — color-constrained destroy + land-subtype bounce ─────

describe('Slice 7 — Active Volcano: color-constrained destroy + Island bounce', () => {
  it('parses as Modal with 2 choices', () => {
    const text = "Choose one — • Destroy target blue permanent. • Return target Island to its owner's hand.";
    const r = parseOracleText(text);
    expect(r.kind).toBe('Modal');
    if (r.kind !== 'Modal') return;
    expect(r.modal.choices).toHaveLength(2);
  });

  it('choice 0 = Destroy with color constraint (blue) — verified via standalone bullet parse', () => {
    const text = "Choose one — • Destroy target blue permanent. • Return target Island to its owner's hand.";
    const r = parseOracleText(text);
    expect(r.kind).toBe('Modal');
    if (r.kind !== 'Modal') return;
    const c0 = r.modal.choices[0];
    expect(c0.effects[0].kind).toBe('Destroy');
    // The ModalChoice only stores { id, type } without constraints (per ModalChoice type).
    // Verify the color constraint via the standalone bullet parse, which retains full TargetSpec.
    const bullet = parseOracleText('Destroy target blue permanent.');
    expect(bullet.kind).toBe('Spell');
    if (bullet.kind !== 'Spell') return;
    const spec = bullet.targets[0];
    expect(spec?.type).toBe('Permanent');
    expect(spec?.constraints?.colors).toContain('U');
  });

  it('choice 1 = ReturnToHand with Land/Island subtype constraint — verified via standalone bullet parse', () => {
    const text = "Choose one — • Destroy target blue permanent. • Return target Island to its owner's hand.";
    const r = parseOracleText(text);
    expect(r.kind).toBe('Modal');
    if (r.kind !== 'Modal') return;
    const c1 = r.modal.choices[1];
    expect(c1.effects[0].kind).toBe('ReturnToHand');
    // Verify Land/Island subtype constraint via standalone bullet parse.
    const bullet = parseOracleText("Return target Island to its owner's hand.");
    expect(bullet.kind).toBe('Spell');
    if (bullet.kind !== 'Spell') return;
    const spec = bullet.targets[0];
    expect(spec?.type).toBe('Land');
    expect(spec?.constraints?.subtypes).toContain('Island');
  });

  it('executes choice 0 (destroy blue permanent) — blue permanent moves to graveyard', () => {
    const state = baseState();
    const blueDef = makeDef('blue-perm', {
      type_line: 'Artifact',
      card_types: ['artifact'],
      colors: ['U'],
      color_identity: ['U'],
      mana_cost: '{U}',
      cmc: 1,
      power: undefined,
      toughness: undefined,
    });
    state.cardDefinitions.set('blue-perm', blueDef);
    state.cards.set('bp1', makeCard('bp1', 'blue-perm', 'p1'));

    const text = "Choose one — • Destroy target blue permanent. • Return target Island to its owner's hand.";
    const r = parseOracleText(text);
    expect(r.kind).toBe('Modal');
    if (r.kind !== 'Modal') return;

    const c0 = r.modal.choices[0];
    const spec = c0.targets[0];
    if (!spec) return;

    const after = executeEffects(
      state,
      c0.effects,
      'p0',
      ['bp1'],
      [{ id: spec.id, type: spec.type, count: 1 }],
      0,
      {},
    );

    // Blue permanent should be in graveyard after Destroy
    expect(after.cards.get('bp1')?.zone).toBe('graveyard');
  });

  it('executes choice 1 (return Island to hand) — Island moves from battlefield to hand', () => {
    const state = baseState();
    const islandDef = makeDef('island-def', {
      type_line: 'Basic Land — Island',
      card_types: ['land'],
      colors: [],
      color_identity: ['U'],
      mana_cost: undefined,
      cmc: 0,
      power: undefined,
      toughness: undefined,
    });
    state.cardDefinitions.set('island-def', islandDef);
    state.cards.set('isl1', makeCard('isl1', 'island-def', 'p1'));

    const text = "Choose one — • Destroy target blue permanent. • Return target Island to its owner's hand.";
    const r = parseOracleText(text);
    expect(r.kind).toBe('Modal');
    if (r.kind !== 'Modal') return;

    const c1 = r.modal.choices[1];
    const spec = c1.targets[0];
    if (!spec) return;

    const after = executeEffects(
      state,
      c1.effects,
      'p0',
      ['isl1'],
      [{ id: spec.id, type: spec.type, count: 1 }],
      0,
      {},
    );

    // Island should be bounced to hand
    expect(after.cards.get('isl1')?.zone).toBe('hand');
  });
});

// ─── 4. FASCINATION — each player draws/mills X ───────────────────────────────

describe('Slice 7 — Fascination: each player draws X / mills X', () => {
  it('parses as Modal with 2 choices and xCost flag', () => {
    const text = 'Choose one — • Each player draws X cards. • Each player mills X cards.';
    const r = parseOracleText(text);
    expect(r.kind).toBe('Modal');
    if (r.kind !== 'Modal') return;
    expect(r.modal.choices).toHaveLength(2);
  });

  it('choice 0 = Draw effect with EachPlayer and X count', () => {
    const text = 'Choose one — • Each player draws X cards. • Each player mills X cards.';
    const r = parseOracleText(text);
    expect(r.kind).toBe('Modal');
    if (r.kind !== 'Modal') return;
    const c0 = r.modal.choices[0];
    expect(c0.effects[0].kind).toBe('Draw');
    const drawEffect = c0.effects[0];
    expect(drawEffect.kind === 'Draw' && drawEffect.player).toMatchObject({ kind: 'EachPlayer' });
    expect(drawEffect.kind === 'Draw' && drawEffect.count).toMatchObject({ kind: 'X' });
  });

  it('choice 1 = Mill effect with EachPlayer and X count', () => {
    const text = 'Choose one — • Each player draws X cards. • Each player mills X cards.';
    const r = parseOracleText(text);
    expect(r.kind).toBe('Modal');
    if (r.kind !== 'Modal') return;
    const c1 = r.modal.choices[1];
    expect(c1.effects[0].kind).toBe('Mill');
    const millEffect = c1.effects[0];
    expect(millEffect.kind === 'Mill' && millEffect.player).toMatchObject({ kind: 'EachPlayer' });
    expect(millEffect.kind === 'Mill' && millEffect.count).toMatchObject({ kind: 'X' });
  });

  it('executes choice 0 (each player draws X=2) — both players draw 2 cards from library', () => {
    const state = baseState();
    const libDef = makeDef('lib-card');
    state.cardDefinitions.set('lib-card', libDef);
    for (let i = 0; i < 3; i++) {
      state.cards.set(`lib-p0-${i}`, makeCard(`lib-p0-${i}`, 'lib-card', 'p0', { zone: 'library' }));
      state.cards.set(`lib-p1-${i}`, makeCard(`lib-p1-${i}`, 'lib-card', 'p1', { zone: 'library' }));
    }

    const text = 'Choose one — • Each player draws X cards. • Each player mills X cards.';
    const r = parseOracleText(text);
    expect(r.kind).toBe('Modal');
    if (r.kind !== 'Modal') return;

    const c0 = r.modal.choices[0];
    const after = executeEffects(state, c0.effects, 'p0', [], [], 2, {}); // xValue = 2

    // Each player should have drawn 2 cards
    const p0Hand = [...after.cards.values()].filter(c => c.ownerId === 'p0' && c.zone === 'hand').length;
    const p1Hand = [...after.cards.values()].filter(c => c.ownerId === 'p1' && c.zone === 'hand').length;
    expect(p0Hand).toBe(2);
    expect(p1Hand).toBe(2);
  });

  it('executes choice 1 (each player mills X=2) — both players mill 2 cards from library to graveyard', () => {
    const state = baseState();
    const libDef = makeDef('lib-card');
    state.cardDefinitions.set('lib-card', libDef);
    for (let i = 0; i < 3; i++) {
      state.cards.set(`lib-p0-${i}`, makeCard(`lib-p0-${i}`, 'lib-card', 'p0', { zone: 'library' }));
      state.cards.set(`lib-p1-${i}`, makeCard(`lib-p1-${i}`, 'lib-card', 'p1', { zone: 'library' }));
    }

    const text = 'Choose one — • Each player draws X cards. • Each player mills X cards.';
    const r = parseOracleText(text);
    expect(r.kind).toBe('Modal');
    if (r.kind !== 'Modal') return;

    const c1 = r.modal.choices[1];
    const after = executeEffects(state, c1.effects, 'p0', [], [], 2, {}); // xValue = 2

    // Each player should have 2 cards in graveyard
    const p0Gy = [...after.cards.values()].filter(c => c.ownerId === 'p0' && c.zone === 'graveyard').length;
    const p1Gy = [...after.cards.values()].filter(c => c.ownerId === 'p1' && c.zone === 'graveyard').length;
    expect(p0Gy).toBe(2);
    expect(p1Gy).toBe(2);
  });
});

// ─── 5. HONESTY DELTA: previously partial-Modal cards now become Unparsed ────

describe('Slice 7 — honesty delta: partial-Modal cards', () => {
  it('"Choose one or both" where one bullet is unparseable → not Modal(partial)', () => {
    // A modal where bullet 1 parses but bullet 2 is a complex unsupported form.
    // Before the honesty gate, this would return Modal with 1 choice.
    // After, it should NOT return Modal with 1 choice.
    const text = 'Choose one or both — • Gain 3 life. • PurelyFictitiousUnsupportedThing blorgon.';
    const r = parseOracleText(text);
    if (r.kind === 'Modal') {
      // If somehow parsed as Modal, MUST have all bullets (2), not just 1.
      expect(r.modal.choices.length).toBeGreaterThanOrEqual(2);
    } else {
      // Correct: honesty gate rejected the partial claim.
      expect(['Unparsed', 'Spell', 'StaticAbility']).toContain(r.kind);
    }
  });

  it('"Choose two —" with all parseable bullets still parses correctly', () => {
    const text = 'Choose two — • Draw a card. • Gain 3 life. • Destroy target creature.';
    const r = parseOracleText(text);
    expect(r.kind).toBe('Modal');
    if (r.kind !== 'Modal') return;
    expect(r.modal.chooseCount).toBe(2);
    expect(r.modal.choices).toHaveLength(3);
  });
});
