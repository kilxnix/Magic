import { describe, expect, it } from 'vitest';
import { buildDecisionReview, isLikelyInfiniteComboAction } from './turnReview';
import { createPlayer, type AIAction, type CardDefinition, type CardInstance, type GameState } from 'commander-engine';

function def(id: string, name: string, oracleText: string, cmc: number): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature - Test',
    oracle_text: oracleText,
    mana_cost: `{${cmc}}`,
    cmc,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['creature'],
    power: cmc,
    toughness: cmc,
  };
}

function landDef(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Basic Land - Forest',
    oracle_text: '({T}: Add {G}.)',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
    keywords: [],
    card_types: ['land'],
  };
}

function card(instanceId: string, definitionId: string): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId: 'p1',
    zone: 'hand',
    tapped: false,
    summoningSick: true,
    counters: {},
    damage: 0,
    isCommander: false,
  };
}

function stateWithComboAndNormalSpell(): GameState {
  const normal = def('normal', 'Normal Creature', '', 2);
  const combo = def('combo', 'Loop Engine', 'Repeat this process any number of times.', 10);
  return {
    players: [createPlayer('p1', 'You'), createPlayer('p2', 'Opponent')],
    cards: new Map([
      ['normal-1', card('normal-1', normal.id)],
      ['combo-1', card('combo-1', combo.id)],
    ]),
    cardDefinitions: new Map([
      [normal.id, normal],
      [combo.id, combo],
    ]),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'end',
    turnNumber: 1,
    spellsCastThisTurn: 0,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    delayedTriggers: [],
  };
}

describe('turn review coaching filters', () => {
  it('does not recommend likely infinite-combo lines as the best coaching alternative', () => {
    const state = stateWithComboAndNormalSpell();
    const normalAction: AIAction = { kind: 'CastSpell', cardInstanceId: 'normal-1', targets: [] };
    const comboAction: AIAction = { kind: 'CastSpell', cardInstanceId: 'combo-1', targets: [] };

    expect(isLikelyInfiniteComboAction(state, comboAction)).toBe(true);

    const review = buildDecisionReview(
      state,
      'p1',
      { kind: 'CastSpell', label: 'Cast Normal Creature', _engineAction: normalAction },
      [
        { kind: 'CastSpell', label: 'Cast Normal Creature', _engineAction: normalAction },
        { kind: 'CastSpell', label: 'Cast Loop Engine', _engineAction: comboAction },
      ],
    );

    expect(review?.best?.label).toBe('Cast Normal Creature');
    expect(review?.alternatives.some(alternative => alternative.label === 'Cast Loop Engine')).toBe(false);
    expect(review?.confidenceReasons).toContain('Likely infinite-combo lines are excluded from general coaching suggestions.');
  });

  it('records a rules audit failure when a stale review action is no longer legal', () => {
    const state = stateWithComboAndNormalSpell();
    const forest = landDef('forest', 'Forest');
    state.cardDefinitions.set(forest.id, forest);
    state.cards.set('forest-1', card('forest-1', forest.id));
    state.stack.push({
      kind: 'Spell',
      id: 'stack-normal',
      cardInstanceId: 'normal-1',
      casterId: 'p1',
      targets: [],
    });

    const staleLandAction: AIAction = { kind: 'PlayLand', cardInstanceId: 'forest-1' };
    const review = buildDecisionReview(
      state,
      'p1',
      { kind: 'PlayLand', label: 'Play Forest', _engineAction: staleLandAction },
      [{ kind: 'PlayLand', label: 'Play Forest', _engineAction: staleLandAction }],
    );

    expect(review?.rulesAudit.ok).toBe(false);
    expect(review?.rulesAudit.message).toContain('The stack must be empty');
    expect(review?.confidence).toBe('low');
    expect(review?.confidenceReasons.some(reason => reason.includes('Rules audit rejected selected action'))).toBe(true);
  });
});
