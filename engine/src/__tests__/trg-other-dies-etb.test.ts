import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { checkStateBasedActions } from '../state-based';
import { initGameState, getCardsInZone } from '../game-state';
import type { CardDefinition, TriggeredAbilityRef } from '../types';
import type { Effect } from '../effects/ast';

/**
 * Family: trg-other-dies-etb
 *
 * Trigger CONDITIONS widened:
 *   - "Whenever another creature you control dies"  -> OtherCreatureDies { who: 'youControl', other: true }
 *   - "Whenever another creature dies"              -> OtherCreatureDies { who: 'youControl', other: true }
 *   - "Whenever a creature an opponent controls dies" -> OtherCreatureDies { who: 'opponentControl' }
 *   - "Whenever another creature you control enters" -> AnotherCreatureETB (already supported; verified end-to-end)
 *
 * The dies events run through checkStateBasedActions (state-based.ts), which is
 * where the new OtherCreatureDies firing branch lives. The ETB event runs through
 * checkTriggersForEvent on CreatureETB.
 */

function vanilla(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature — Bear',
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

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe('trg-other-dies-etb parsing', () => {
  it('parses "Whenever another creature you control dies, you gain 1 life."', () => {
    const result = parseOracleText('Whenever another creature you control dies, you gain 1 life.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'OtherCreatureDies', who: 'youControl', other: true });
    expect(result.ability.effects).toHaveLength(1);
    expect(result.ability.effects[0].kind).toBe('GainLife');
  });

  it('parses "Whenever another creature dies, you gain 1 life." (no controller clause -> youControl)', () => {
    const result = parseOracleText('Whenever another creature dies, you gain 1 life.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'OtherCreatureDies', who: 'youControl', other: true });
  });

  it('parses "Whenever a creature an opponent controls dies, you draw a card."', () => {
    const result = parseOracleText('Whenever a creature an opponent controls dies, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'OtherCreatureDies', who: 'opponentControl' });
    expect(result.ability.effects[0].kind).toBe('Draw');
  });

  it('does NOT hijack the plain "a creature you control dies" trigger', () => {
    const result = parseOracleText('Whenever a creature you control dies, you gain 1 life.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('CreatureYouControlDies');
  });

  it('parses "Whenever another creature you control enters, you gain 1 life." (ETB)', () => {
    const result = parseOracleText('Whenever another creature you control enters, you gain 1 life.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).toBe('AnotherCreatureETB');
  });
});

// ---------------------------------------------------------------------------
// Execution: OtherCreatureDies (youControl + other) actually fires
// ---------------------------------------------------------------------------

describe('trg-other-dies-etb execution', () => {
  it('"another creature you control dies" fires for a DIFFERENT controlled creature, not the source itself', () => {
    const watcher = vanilla('watcher', 'Watcher');
    const victim = vanilla('victim', 'Victim');
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [watcher, victim], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const lib = getCardsInZone(state, 'p1', 'library');
    const watcherCard = lib.find(c => c.definitionId === 'watcher')!;
    const victimCard = lib.find(c => c.definitionId === 'victim')!;

    // Both onto p1's battlefield.
    state.cards.set(watcherCard.instanceId, { ...watcherCard, zone: 'battlefield', summoningSick: false });
    state.cards.set(victimCard.instanceId, { ...victimCard, zone: 'battlefield', summoningSick: false, damage: 2 });

    // Register the OtherCreatureDies trigger on the watcher.
    const ability: TriggeredAbilityRef = {
      kind: 'TriggeredAbility',
      trigger: { kind: 'OtherCreatureDies', who: 'youControl', other: true },
      effects: [{ kind: 'GainLife', player: { kind: 'Controller' }, amount: 1 }],
    };
    const abilities = new Map(state.battlefieldAbilities);
    abilities.set(watcherCard.instanceId, [ability]);
    state = { ...state, battlefieldAbilities: abilities };

    const next = checkStateBasedActions(state);

    // Victim died.
    expect(next.cards.get(victimCard.instanceId)!.zone).toBe('graveyard');
    // Watcher's trigger is pending (fired once, for the victim, not for itself).
    const fired = next.pendingTriggers.filter(
      t => t.sourceInstanceId === watcherCard.instanceId,
    );
    expect(fired).toHaveLength(1);
    expect(fired[0].ability.trigger.kind).toBe('OtherCreatureDies');

    // Execute the effect: controller (p1) gains 1 life.
    const before = next.players.find(p => p.id === 'p1')!.life;
    const after = executeEffects(next, fired[0].ability.effects as Effect[], 'p1', [], []);
    expect(after.players.find(p => p.id === 'p1')!.life).toBe(before + 1);
  });

  it('"another creature you control dies" does NOT fire when the SOURCE itself dies (other: true)', () => {
    const watcher = vanilla('watcher2', 'Self Watcher');
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [watcher], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const watcherCard = getCardsInZone(state, 'p1', 'library')[0];

    // Watcher itself takes lethal damage.
    state.cards.set(watcherCard.instanceId, {
      ...watcherCard,
      zone: 'battlefield',
      summoningSick: false,
      damage: 2,
    });

    const ability: TriggeredAbilityRef = {
      kind: 'TriggeredAbility',
      trigger: { kind: 'OtherCreatureDies', who: 'youControl', other: true },
      effects: [{ kind: 'GainLife', player: { kind: 'Controller' }, amount: 1 }],
    };
    const abilities = new Map(state.battlefieldAbilities);
    abilities.set(watcherCard.instanceId, [ability]);
    state = { ...state, battlefieldAbilities: abilities };

    const next = checkStateBasedActions(state);

    expect(next.cards.get(watcherCard.instanceId)!.zone).toBe('graveyard');
    // "another" excludes the source dying itself: no pending trigger.
    expect(
      next.pendingTriggers.filter(t => t.sourceInstanceId === watcherCard.instanceId),
    ).toHaveLength(0);
  });

  it('"a creature an opponent controls dies" fires for opponent creatures only', () => {
    const watcher = vanilla('watcher3', 'Opp Watcher');
    const oppVictim = vanilla('opp-victim', 'Opp Victim');
    const ownVictim = vanilla('own-victim', 'Own Victim');
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [watcher, ownVictim], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [oppVictim], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const watcherCard = getCardsInZone(state, 'p1', 'library').find(c => c.definitionId === 'watcher3')!;
    const ownVictimCard = getCardsInZone(state, 'p1', 'library').find(c => c.definitionId === 'own-victim')!;
    const oppVictimCard = getCardsInZone(state, 'p2', 'library').find(c => c.definitionId === 'opp-victim')!;

    state.cards.set(watcherCard.instanceId, { ...watcherCard, zone: 'battlefield', summoningSick: false });
    // Both victims die simultaneously.
    state.cards.set(ownVictimCard.instanceId, { ...ownVictimCard, zone: 'battlefield', damage: 2 });
    state.cards.set(oppVictimCard.instanceId, { ...oppVictimCard, zone: 'battlefield', damage: 2 });

    const ability: TriggeredAbilityRef = {
      kind: 'TriggeredAbility',
      trigger: { kind: 'OtherCreatureDies', who: 'opponentControl' },
      effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: 1 }],
    };
    const abilities = new Map(state.battlefieldAbilities);
    abilities.set(watcherCard.instanceId, [ability]);
    state = { ...state, battlefieldAbilities: abilities };

    const next = checkStateBasedActions(state);

    expect(next.cards.get(ownVictimCard.instanceId)!.zone).toBe('graveyard');
    expect(next.cards.get(oppVictimCard.instanceId)!.zone).toBe('graveyard');

    // Only the OPPONENT creature dying fires the trigger -> exactly 1 pending.
    const fired = next.pendingTriggers.filter(t => t.sourceInstanceId === watcherCard.instanceId);
    expect(fired).toHaveLength(1);
    expect(fired[0].eventContext?.cardInstanceId).toBe(oppVictimCard.instanceId);
  });
});
