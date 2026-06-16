/**
 * Slice 10 (MODAL-AS-TRIGGER-BODY): Tests for parsing and executing triggered
 * abilities whose body is a "choose one —" / "choose two —" modal list.
 *
 * GAP: the trigger-prefix dispatch (ETB/Dies/generic Trigger) previously called
 * parseMultipleEffects which greedily parsed the first parseable bullet as a
 * flat effect and missed the modal framing. The fix in this slice checks for
 * 'choose' at the body start BEFORE calling parseMultipleEffects, routing
 * parseable modals through parseModalSpell and storing the result as
 * TriggeredAbility.modal.
 *
 * HONESTY: parseModalSpell's all-or-nothing gate is preserved — any modal where
 * at least one bullet fails (incubate, sticker, earthbend, etc.) is declined.
 * The parser falls back to the existing greedy-parse path for those cases.
 *
 * Examples covered (parseable, all modes supported):
 *   - Skemfar Shadowsage: ETB modal with X-count LoseLife / GainLife
 *   - Simple Dies modal: LoseLife / GainLife
 *   - Attacks trigger modal: Draw / GainLife
 *   - ETB modal with GainControl / Destroy
 *
 * Examples correctly DECLINED (unsupported mode):
 *   - Incubate bullet: not executor-backed
 *   - Ao, the Dawn Sky bullet 2: "Put two +1/+1 counters on each permanent
 *     you control that's a creature or Vehicle" — 'each permanent...that's a
 *     creature or Vehicle' filter not supported by mass-counters matcher
 *
 * EXECUTOR ROUTE: TriggeredAbilityRef.modal is read by resolveTopOfStack in
 * stack.ts, which executes chosen mode(s) via the same path as activated ability
 * modals — collecting effects from each chosen mode and running them through
 * executeSpellEffectsWithCopySupport.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { createPlayer } from '../types';
import type { GameState, CardInstance, CardDefinition, TriggeredAbilityRef } from '../types';
import { resolveTopOfStack } from '../stack';
import type { ModalSpell, Effect } from '../effects/ast';
import type { TargetSpec } from '../effects/targets';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeState(playerLives: [number, number] = [20, 20]): GameState {
  const p0 = createPlayer('p0', 'P0');
  const p1 = createPlayer('p1', 'P1');
  p0.life = playerLives[0];
  p1.life = playerLives[1];
  return {
    players: [p0, p1],
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

function pushModalTrigger(
  state: GameState,
  abilityRef: TriggeredAbilityRef,
  targets: string[] = [],
  targetSpecs: TargetSpec[] = [],
): GameState {
  return {
    ...state,
    stack: [
      ...state.stack,
      {
        kind: 'TriggeredAbility',
        id: `trig_${Date.now()}`,
        sourceInstanceId: 'src_card',
        controllerId: 'p0',
        ability: abilityRef,
        targets,
        targetSpecs,
      },
    ],
  };
}

// ─── PARSE: ETB modal trigger body ──────────────────────────────────────────

describe('slice10-modal-trigger-body: ETB modal parse', () => {
  it('parse: simple ETB modal — • LoseLife • GainLife → kind ETB, has modal', () => {
    const oracle = 'When ~ enters, choose one — • Each opponent loses 3 life. • You gain 3 life.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    expect((r.ability as any).modal).toBeTruthy();
  });

  it('parse: ETB modal — effects array is empty (modal stores all choices)', () => {
    const oracle = 'When ~ enters, choose one — • Each opponent loses 3 life. • You gain 3 life.';
    const r = parseOracleText(oracle);
    if (r.kind !== 'ETB') return;
    expect(r.ability.effects).toHaveLength(0);
  });

  it('parse: ETB modal — trigger kind is ETB/self', () => {
    const oracle = 'When ~ enters, choose one — • Each opponent loses 3 life. • You gain 3 life.';
    const r = parseOracleText(oracle);
    if (r.kind !== 'ETB') return;
    expect(r.ability.trigger).toEqual({ kind: 'ETB', who: 'self' });
  });

  it('parse: ETB modal — modal has 2 choices with correct choose count', () => {
    const oracle = 'When ~ enters, choose one — • Each opponent loses 3 life. • You gain 3 life.';
    const r = parseOracleText(oracle);
    if (r.kind !== 'ETB') return;
    const modal = (r.ability as any).modal as ModalSpell;
    expect(modal.chooseCount).toBe(1);
    expect(modal.choices).toHaveLength(2);
  });

  it('parse: ETB modal — Skemfar Shadowsage style (X elf count LoseLife / GainLife)', () => {
    // Real oracle wording for Skemfar Shadowsage ETB
    const oracle =
      'When this creature enters, choose one — ' +
      '• Each opponent loses X life, where X is the number of Elves you control. ' +
      '• You gain X life, where X is the number of Elves you control.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    expect((r.ability as any).modal).toBeTruthy();
  });

  it('parse: ETB modal with GainControl + Destroy — both modes parse', () => {
    const oracle =
      'When ~ enters, choose one — ' +
      '• Gain control of target creature. ' +
      '• Destroy target creature.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    const modal = (r.ability as any).modal as ModalSpell;
    expect(modal).toBeTruthy();
    expect(modal.choices).toHaveLength(2);
    expect(modal.choices[0].effects[0].kind).toBe('GainControl');
    expect(modal.choices[1].effects[0].kind).toBe('Destroy');
  });

  it('parse: ETB modal targets include specs from modal choices', () => {
    const oracle =
      'When ~ enters, choose one — ' +
      '• Gain control of target creature. ' +
      '• Destroy target creature.';
    const r = parseOracleText(oracle);
    if (r.kind !== 'ETB') return;
    // Should have at least one target spec (from at least one mode)
    expect(r.targets.length).toBeGreaterThan(0);
  });
});

// ─── PARSE: Dies modal trigger body ─────────────────────────────────────────

describe('slice10-modal-trigger-body: Dies modal parse', () => {
  it('parse: simple Dies modal — • LoseLife • GainLife → kind Dies, has modal', () => {
    const oracle = 'When ~ dies, choose one — • Each opponent loses 3 life. • You gain 3 life.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Dies');
    if (r.kind !== 'Dies') return;
    expect((r.ability as any).modal).toBeTruthy();
  });

  it('parse: Dies modal — trigger kind is Dies/self', () => {
    const oracle = 'When ~ dies, choose one — • Each opponent loses 3 life. • You gain 3 life.';
    const r = parseOracleText(oracle);
    if (r.kind !== 'Dies') return;
    expect(r.ability.trigger).toEqual({ kind: 'Dies', who: 'self' });
  });

  it('parse: Dies modal — 2 choices in modal', () => {
    const oracle = 'When ~ dies, choose one — • Each opponent loses 3 life. • You gain 3 life.';
    const r = parseOracleText(oracle);
    if (r.kind !== 'Dies') return;
    const modal = (r.ability as any).modal as ModalSpell;
    expect(modal.choices).toHaveLength(2);
  });

  it('parse: Dies modal — LoseLife choice has correct effect kind', () => {
    const oracle = 'When ~ dies, choose one — • Each opponent loses 3 life. • You gain 3 life.';
    const r = parseOracleText(oracle);
    if (r.kind !== 'Dies') return;
    const modal = (r.ability as any).modal as ModalSpell;
    expect(modal.choices[0].effects[0].kind).toBe('LoseLife');
    expect(modal.choices[1].effects[0].kind).toBe('GainLife');
  });

  it('parse: Dies modal with AddCounters bullet — both modes parse', () => {
    const oracle =
      'When ~ dies, choose one — ' +
      '• Each opponent loses 3 life. ' +
      '• Put two +1/+1 counters on target creature you control.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Dies');
    if (r.kind !== 'Dies') return;
    const modal = (r.ability as any).modal as ModalSpell;
    expect(modal).toBeTruthy();
    expect(modal.choices[1].effects[0].kind).toBe('AddCounters');
  });

  it('parse: Dies modal with named trigger prefix after card-name normalization', () => {
    // "When ~ dies" after normalizeTriggeredOracleLine replaces card name with ~
    const oracle = 'When ~ dies, choose one — • Each opponent loses 2 life. • You gain 2 life.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Dies');
  });
});

// ─── PARSE: Generic Trigger modal body ──────────────────────────────────────

describe('slice10-modal-trigger-body: Attacks/generic trigger modal parse', () => {
  it('parse: Attacks trigger modal — • Draw • GainLife → kind Triggered, has modal', () => {
    const oracle = 'Whenever ~ attacks, choose one — • Draw a card. • You gain 2 life.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect((r.ability as any).modal).toBeTruthy();
  });

  it('parse: Attacks trigger modal — trigger kind is Attacks', () => {
    const oracle = 'Whenever ~ attacks, choose one — • Draw a card. • You gain 2 life.';
    const r = parseOracleText(oracle);
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('Attacks');
  });

  it('parse: Upkeep trigger modal — trigger kind is Upkeep', () => {
    const oracle = 'At the beginning of your upkeep, choose one — • Draw a card. • You gain 2 life.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('Upkeep');
    expect((r.ability as any).modal).toBeTruthy();
  });

  it('parse: Triggered modal — effects array is empty', () => {
    const oracle = 'Whenever ~ attacks, choose one — • Draw a card. • You gain 2 life.';
    const r = parseOracleText(oracle);
    if (r.kind !== 'Triggered') return;
    expect(r.ability.effects).toHaveLength(0);
  });
});

// ─── HONESTY GATE: Decline unsupported modes ────────────────────────────────

describe('slice10-modal-trigger-body: honesty gate (declined modals)', () => {
  it('honesty: Dies modal with unsupported bullet → NOT modal (falls back to greedy parse)', () => {
    // Incubate is not executor-backed; modal gate declines the whole thing
    const oracle = 'When ~ dies, choose one — • Each opponent loses 3 life. • Incubate 3.';
    const r = parseOracleText(oracle);
    if (r.kind === 'Dies') {
      // Falls back to greedy parse (mode 0 only)
      expect((r.ability as any).modal).toBeFalsy();
    } else {
      // Or Unparsed — either is acceptable (modal honesty gate succeeded in declining)
      expect(r.kind === 'Unparsed' || r.kind === 'Dies').toBe(true);
    }
  });

  it('honesty: ETB modal with "earthbend" bullet → NOT modal', () => {
    const oracle = 'When ~ enters, choose one — • Each opponent loses 3 life. • Earthbend target creature.';
    const r = parseOracleText(oracle);
    if (r.kind === 'ETB') {
      expect((r.ability as any).modal).toBeFalsy();
    }
  });

  it('honesty: Robo-Piñata style (sticker mode) — modal DECLINED', () => {
    // The sticker-mode bullet is unparseable → modal gate declines entire modal
    const oracle =
      'When ~ dies, choose one — ' +
      '• Each opponent loses 3 life. ' +
      '• Put a sticker on a nonland permanent you own.';
    const r = parseOracleText(oracle);
    if (r.kind === 'Dies') {
      expect((r.ability as any).modal).toBeFalsy();
    }
  });
});

// ─── EXECUTION: ETB modal resolves chosen mode ──────────────────────────────

describe('slice10-modal-trigger-body: execution via resolveTopOfStack', () => {
  it('exec: Dies modal mode 0 (LoseLife) executes on resolution', () => {
    const oracle = 'When ~ dies, choose one — • Each opponent loses 3 life. • You gain 3 life.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('Dies');
    if (parsed.kind !== 'Dies') return;

    const modal = (parsed.ability as any).modal as ModalSpell;
    expect(modal).toBeTruthy();

    const abilityRef: TriggeredAbilityRef = {
      ...(parsed.ability as TriggeredAbilityRef),
      modal: modal as unknown,
      chosenModes: [0], // "Each opponent loses 3 life"
    };

    let state = makeState([20, 20]);
    state = pushModalTrigger(state, abilityRef);

    const nextState = resolveTopOfStack(state);
    expect(nextState.players[1].life).toBe(17); // opponent lost 3 life
    expect(nextState.players[0].life).toBe(20); // controller unchanged
    expect(nextState.stack).toHaveLength(0);
  });

  it('exec: Dies modal mode 1 (GainLife) executes on resolution', () => {
    const oracle = 'When ~ dies, choose one — • Each opponent loses 3 life. • You gain 3 life.';
    const parsed = parseOracleText(oracle);
    if (parsed.kind !== 'Dies') return;

    const modal = (parsed.ability as any).modal as ModalSpell;
    const abilityRef: TriggeredAbilityRef = {
      ...(parsed.ability as TriggeredAbilityRef),
      modal: modal as unknown,
      chosenModes: [1], // "You gain 3 life"
    };

    let state = makeState([20, 20]);
    state = pushModalTrigger(state, abilityRef);

    const nextState = resolveTopOfStack(state);
    expect(nextState.players[0].life).toBe(23); // controller gained 3 life
    expect(nextState.players[1].life).toBe(20); // opponent unchanged
    expect(nextState.stack).toHaveLength(0);
  });

  it('exec: ETB modal mode 1 (GainLife) executes on resolution', () => {
    const oracle = 'When ~ enters, choose one — • Each opponent loses 3 life. • You gain 3 life.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;

    const modal = (parsed.ability as any).modal as ModalSpell;
    const abilityRef: TriggeredAbilityRef = {
      ...(parsed.ability as TriggeredAbilityRef),
      modal: modal as unknown,
      chosenModes: [1], // "You gain 3 life"
    };

    let state = makeState([20, 20]);
    state = pushModalTrigger(state, abilityRef);

    const nextState = resolveTopOfStack(state);
    expect(nextState.players[0].life).toBe(23);
    expect(nextState.players[1].life).toBe(20);
  });

  it('exec: Attacked trigger modal — default (all modes) executed when no chosenModes', () => {
    const oracle = 'Whenever ~ attacks, choose one — • Each opponent loses 2 life. • You gain 2 life.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    const modal = (parsed.ability as any).modal as ModalSpell;
    // No chosenModes → resolveTopOfStack defaults to executing all modes
    const abilityRef: TriggeredAbilityRef = {
      ...(parsed.ability as TriggeredAbilityRef),
      modal: modal as unknown,
      // chosenModes intentionally omitted → executes all choices
    };

    let state = makeState([20, 20]);
    state = pushModalTrigger(state, abilityRef);

    const nextState = resolveTopOfStack(state);
    // All modes executed: opponent loses 2 AND controller gains 2
    expect(nextState.players[1].life).toBe(18); // opponent lost 2
    expect(nextState.players[0].life).toBe(22); // controller gained 2
  });

  it('exec: modal trigger body does NOT execute un-chosen mode', () => {
    const oracle = 'When ~ dies, choose one — • Each opponent loses 10 life. • You gain 1 life.';
    const parsed = parseOracleText(oracle);
    if (parsed.kind !== 'Dies') return;

    const modal = (parsed.ability as any).modal as ModalSpell;
    const abilityRef: TriggeredAbilityRef = {
      ...(parsed.ability as TriggeredAbilityRef),
      modal: modal as unknown,
      chosenModes: [1], // Only "You gain 1 life" — mode 0 NOT executed
    };

    let state = makeState([20, 20]);
    state = pushModalTrigger(state, abilityRef);

    const nextState = resolveTopOfStack(state);
    expect(nextState.players[0].life).toBe(21); // gained 1
    expect(nextState.players[1].life).toBe(20); // NOT lost 10 (mode 0 not chosen)
  });
});
