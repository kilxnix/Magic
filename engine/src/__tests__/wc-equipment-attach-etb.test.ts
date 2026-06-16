/**
 * Whole-card coverage: Equipment ETB self-attach.
 *
 * Family key: equipment-attach-etb
 *
 * "When this Equipment enters, attach it to target creature you control."
 * (Maul of the Skyclaves, Mithril Coat.) An ETB trigger that attaches the
 * Equipment to a chosen creature you control WITHOUT paying the equip cost.
 * Once attached, the continuous equipmentBonus cache applies the buff.
 *
 * These tests execute the behavior end to end: the Equipment enters, its ETB
 * trigger is registered and resolved with a target, the Equipment's attachedTo
 * is set, and the equipped creature's effective power/toughness reflect the
 * cached equipmentBonus.
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState } from '../game-state';
import {
  resolveTopOfStack,
  putTriggersOnStack,
  registerBattlefieldAbilities,
  createETBTriggers,
} from '../stack';
import { getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import { instanceHasKeyword } from '../keywords';
import type { CardDefinition, GameState, CardInstance } from '../types';

function makeEquipmentWithAttachETB(): CardDefinition {
  return {
    id: 'maul-of-the-skyclaves',
    name: 'Maul of the Skyclaves',
    type_line: 'Artifact — Equipment',
    oracle_text:
      'When Maul of the Skyclaves enters the battlefield, attach it to target creature you control.\n' +
      'Equipped creature gets +2/+2 and has flying and first strike.\n' +
      'Equip {3}',
    mana_cost: '{2}{W}',
    cmc: 3,
    colors: ['W'],
    color_identity: ['W'],
    keywords: [],
    card_types: ['artifact'],
    // Cached parse data normally computed at deck load — supplied directly so the
    // continuous equipmentBonus path can apply the buff once attachedTo is set.
    isEquipment: true,
    equipCost: { generic: 3, W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    equipmentBonus: { power: 2, toughness: 2, keywords: ['Flying', 'FirstStrike'] },
  };
}

function makeVanillaCreature(): CardDefinition {
  return {
    id: 'grizzly-bears',
    name: 'Grizzly Bears',
    type_line: 'Creature — Bear',
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power: 2,
    toughness: 2,
    card_types: ['creature'],
  };
}

function makeLand(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Basic Land — Forest',
    oracle_text: '{T}: Add {G}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
    keywords: [],
    card_types: ['land'],
  };
}

function createTestGame(p1: CardDefinition[], p2: CardDefinition[]): GameState {
  return initGameState([
    { playerId: 'p1', name: 'Player 1', cards: p1, commanderId: 'nonexistent-cmd-1' },
    { playerId: 'p2', name: 'Player 2', cards: p2, commanderId: 'nonexistent-cmd-2' },
  ]);
}

function moveToZone(state: GameState, instanceId: string, zone: 'battlefield'): GameState {
  const card = state.cards.get(instanceId);
  if (!card) throw new Error(`Card not found: ${instanceId}`);
  const newCards = new Map(state.cards);
  newCards.set(instanceId, { ...card, zone, summoningSick: false });
  return { ...state, cards: newCards };
}

function findCard(state: GameState, defId: string): CardInstance | undefined {
  for (const card of state.cards.values()) {
    if (card.definitionId === defId) return card;
  }
  return undefined;
}

describe('Equipment ETB self-attach (equipment-attach-etb)', () => {
  it('parses "attach it to target creature you control" as an ETB Attach effect', () => {
    const result = parseOracleText(
      'When ~ enters the battlefield, attach it to target creature you control.',
    );
    expect(result.kind).toBe('ETB');
    if (result.kind !== 'ETB') return;
    expect(result.ability.trigger.kind).toBe('ETB');
    expect(result.ability.effects).toHaveLength(1);
    const effect = result.ability.effects[0];
    expect(effect.kind).toBe('Attach');
    if (effect.kind !== 'Attach') return;
    expect(effect.source).toBe('Source');
    // A single Creature target spec, restricted to creatures you control.
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].type).toBe('Creature');
    expect(result.targets[0].constraints?.controllerControls).toBe(true);
  });

  it('also parses the "attach it to target legendary creature you control" variant', () => {
    const result = parseOracleText(
      'When ~ enters, attach it to target legendary creature you control.',
    );
    expect(result.kind).toBe('ETB');
    if (result.kind !== 'ETB') return;
    expect(result.ability.effects[0].kind).toBe('Attach');
  });

  it('attaches the Equipment to the chosen creature and applies the equipmentBonus buff', () => {
    const equipment = makeEquipmentWithAttachETB();
    const bear = makeVanillaCreature();

    let state = createTestGame(
      [equipment, bear, makeLand('forest', 'Forest')],
      [makeLand('island', 'Island')],
    );

    const equipInst = findCard(state, 'maul-of-the-skyclaves')!;
    const bearInst = findCard(state, 'grizzly-bears')!;
    state = moveToZone(state, bearInst.instanceId, 'battlefield');
    state = moveToZone(state, equipInst.instanceId, 'battlefield');

    // Baseline: the bear is a vanilla 2/2 with no granted keywords.
    expect(getEffectivePower(state, bearInst.instanceId)).toBe(2);
    expect(getEffectiveToughness(state, bearInst.instanceId)).toBe(2);
    expect(instanceHasKeyword(state, bearInst.instanceId, 'Flying')).toBe(false);

    // Register and fire the ETB trigger.
    state = registerBattlefieldAbilities(state, equipInst.instanceId);
    state = createETBTriggers(state, equipInst.instanceId);

    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0].requiredTargets).toMatchObject([
      { type: 'Creature', constraints: { controllerControls: true } },
    ]);

    const triggerId = state.pendingTriggers[0].id;
    state = putTriggersOnStack(state, { [triggerId]: [bearInst.instanceId] });
    state = resolveTopOfStack(state);

    // The Equipment is now attached to the bear...
    const attachedEquip = state.cards.get(equipInst.instanceId)!;
    expect(attachedEquip.attachedTo).toBe(bearInst.instanceId);

    // ...and the cached equipmentBonus is applied continuously.
    expect(getEffectivePower(state, bearInst.instanceId)).toBe(4); // 2 + 2
    expect(getEffectiveToughness(state, bearInst.instanceId)).toBe(4); // 2 + 2
    expect(instanceHasKeyword(state, bearInst.instanceId, 'Flying')).toBe(true);
    expect(instanceHasKeyword(state, bearInst.instanceId, 'FirstStrike')).toBe(true);
  });

  it('leaves subtype-restricted attach text Unparsed (honest: TargetSpec cannot enforce a subtype)', () => {
    // Shining Armor: "attach it to target Knight or Vehicle you control" — the
    // subtype restriction is not expressible as a target constraint, so we do
    // not emit an over-broad Attach effect for it.
    const result = parseOracleText(
      'When ~ enters the battlefield, attach it to target Knight or Vehicle you control.',
    );
    if (result.kind === 'ETB') {
      expect(result.ability.effects.some(e => e.kind === 'Attach')).toBe(false);
    }
  });
});
