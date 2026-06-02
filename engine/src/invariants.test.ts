import { describe, expect, it } from 'vitest';
import { initGameState } from './game-state';
import { validateStateInvariants } from './invariants';
import type { CardDefinition } from './types';

function commander(): CardDefinition {
  return {
    id: 'cmd',
    name: 'Test Commander',
    type_line: 'Legendary Creature - Human',
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
  };
}

describe('validateStateInvariants', () => {
  it('accepts a normal initialized game state', () => {
    const cmd = commander();
    const state = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [cmd], commanderId: cmd.id },
      { playerId: 'p2', name: 'Bob', cards: [cmd], commanderId: cmd.id },
    ]);

    expect(validateStateInvariants(state)).toEqual({ ok: true, violations: [] });
  });

  it('rejects stack objects that reference missing cards', () => {
    const cmd = commander();
    const state = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [cmd], commanderId: cmd.id },
      { playerId: 'p2', name: 'Bob', cards: [cmd], commanderId: cmd.id },
    ]);
    state.stack = [{
      kind: 'Spell',
      id: 'ghost-spell',
      cardInstanceId: 'missing-card',
      casterId: 'p1',
      targets: [],
    }];

    const report = validateStateInvariants(state);
    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual(expect.objectContaining({
      code: 'missing_stack_spell_card',
    }));
  });

  it('rejects cards stranded in the stack zone without a stack object', () => {
    const cmd = commander();
    const state = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [cmd], commanderId: cmd.id },
      { playerId: 'p2', name: 'Bob', cards: [cmd], commanderId: cmd.id },
    ]);
    const stranded = [...state.cards.values()].find(card => card.ownerId === 'p1');
    expect(stranded).toBeDefined();
    state.cards.set(stranded!.instanceId, { ...stranded!, zone: 'stack' });

    const report = validateStateInvariants(state);
    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual(expect.objectContaining({
      code: 'stack_zone_without_stack_object',
    }));
  });

  it('rejects tokens that still exist outside the battlefield', () => {
    const cmd = commander();
    const state = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [cmd], commanderId: cmd.id },
      { playerId: 'p2', name: 'Bob', cards: [cmd], commanderId: cmd.id },
    ]);
    state.cards.set('dead-token', {
      instanceId: 'dead-token',
      definitionId: cmd.id,
      ownerId: 'p1',
      zone: 'graveyard',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
      isToken: true,
    });

    const report = validateStateInvariants(state);
    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual(expect.objectContaining({
      code: 'token_outside_battlefield',
    }));
  });

  it('rejects attachments pointing at missing or non-battlefield objects', () => {
    const cmd = commander();
    const state = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [cmd], commanderId: cmd.id },
      { playerId: 'p2', name: 'Bob', cards: [cmd], commanderId: cmd.id },
    ]);
    const attached = [...state.cards.values()].find(card => card.ownerId === 'p1');
    expect(attached).toBeDefined();
    state.cards.set(attached!.instanceId, { ...attached!, zone: 'graveyard', attachedTo: 'missing-target' });

    const report = validateStateInvariants(state);
    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual(expect.objectContaining({
      code: 'missing_attachment_target',
    }));
  });

  it('rejects duplicate spell stack objects for the same card', () => {
    const cmd = commander();
    const state = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [cmd], commanderId: cmd.id },
      { playerId: 'p2', name: 'Bob', cards: [cmd], commanderId: cmd.id },
    ]);
    const spell = [...state.cards.values()].find(card => card.ownerId === 'p1');
    expect(spell).toBeDefined();
    state.cards.set(spell!.instanceId, { ...spell!, zone: 'stack' });
    state.stack = [
      { kind: 'Spell', id: 'stack-a', cardInstanceId: spell!.instanceId, casterId: 'p1', targets: [] },
      { kind: 'Spell', id: 'stack-b', cardInstanceId: spell!.instanceId, casterId: 'p1', targets: [] },
    ];

    const report = validateStateInvariants(state);
    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual(expect.objectContaining({
      code: 'duplicate_spell_stack_card',
    }));
  });

  it('allows spell-copy stack objects to reference the copied card', () => {
    const cmd = commander();
    const state = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [cmd], commanderId: cmd.id },
      { playerId: 'p2', name: 'Bob', cards: [cmd], commanderId: cmd.id },
    ]);
    const spell = [...state.cards.values()].find(card => card.ownerId === 'p1');
    expect(spell).toBeDefined();
    state.cards.set(spell!.instanceId, { ...spell!, zone: 'stack' });
    state.stack = [
      { kind: 'Spell', id: 'stack-a', cardInstanceId: spell!.instanceId, casterId: 'p1', targets: [] },
      { kind: 'Spell', id: 'stack-copy-a', cardInstanceId: spell!.instanceId, casterId: 'p1', targets: [], isCopy: true, copyOfCardInstanceId: spell!.instanceId },
      { kind: 'Spell', id: 'stack-copy-b', cardInstanceId: spell!.instanceId, casterId: 'p1', targets: [], isCopy: true, copyOfCardInstanceId: spell!.instanceId },
    ];

    expect(validateStateInvariants(state)).toEqual({ ok: true, violations: [] });
  });

  it('rejects non-finite player/card numeric state', () => {
    const cmd = commander();
    const state = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [cmd], commanderId: cmd.id },
      { playerId: 'p2', name: 'Bob', cards: [cmd], commanderId: cmd.id },
    ]);
    state.players[0].manaPool.G = Number.NaN;
    const creature = [...state.cards.values()].find(card => card.ownerId === 'p1')!;
    state.cards.set(creature.instanceId, {
      ...creature,
      counters: { '+1/+1': Number.POSITIVE_INFINITY },
    });

    const report = validateStateInvariants(state);
    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual(expect.objectContaining({
      code: 'invalid_mana_pool',
    }));
    expect(report.violations).toContainEqual(expect.objectContaining({
      code: 'invalid_card_counter',
    }));
  });

  it('allows negative internal temporary power/toughness modifiers', () => {
    const cmd = commander();
    const state = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [cmd], commanderId: cmd.id },
      { playerId: 'p2', name: 'Bob', cards: [cmd], commanderId: cmd.id },
    ]);
    const creature = [...state.cards.values()].find(card => card.ownerId === 'p1')!;
    state.cards.set(creature.instanceId, {
      ...creature,
      zone: 'battlefield',
      counters: { _powerMod: -2, _toughnessMod: -2 },
    });

    expect(validateStateInvariants(state)).toEqual({ ok: true, violations: [] });
  });

  it('rejects stale pending trigger and battlefield ability references', () => {
    const cmd = commander();
    const state = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [cmd], commanderId: cmd.id },
      { playerId: 'p2', name: 'Bob', cards: [cmd], commanderId: cmd.id },
    ]);
    state.pendingTriggers = [{
      id: 'trigger-missing',
      sourceInstanceId: 'missing-source',
      controllerId: 'p1',
      ability: {
        kind: 'TriggeredAbility',
        trigger: { kind: 'ETB', who: 'self' },
        effects: [],
      },
      requiredTargets: [],
    }];
    state.battlefieldAbilities.set('missing-ability-source', []);

    const report = validateStateInvariants(state);
    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual(expect.objectContaining({
      code: 'missing_pending_trigger_source',
    }));
    expect(report.violations).toContainEqual(expect.objectContaining({
      code: 'missing_battlefield_ability_source',
    }));
  });

  it('rejects malformed combat references', () => {
    const cmd = commander();
    const state = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [cmd], commanderId: cmd.id },
      { playerId: 'p2', name: 'Bob', cards: [cmd], commanderId: cmd.id },
    ]);
    state.combat = {
      attackers: [{ cardInstanceId: 'missing-attacker', defendingPlayerId: 'p2' }],
      blockers: [{ cardInstanceId: 'missing-blocker', blockingAttackerId: 'other-attacker' }],
      damageAssignment: new Map([['other-attacker', 1]]),
    };

    const report = validateStateInvariants(state);
    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual(expect.objectContaining({
      code: 'missing_combat_attacker',
    }));
    expect(report.violations).toContainEqual(expect.objectContaining({
      code: 'blocker_missing_attacker',
    }));
    expect(report.violations).toContainEqual(expect.objectContaining({
      code: 'damage_assignment_missing_attacker',
    }));
  });
});
