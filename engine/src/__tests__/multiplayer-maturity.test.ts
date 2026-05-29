import { describe, expect, it } from 'vitest';
import { declareAttackers, declareBlockers, resolveCombatDamage } from '../combat';
import { getCardsInZone, initGameState } from '../game-state';
import { addMana } from '../mana';
import { allPlayersPassed, passPriority } from '../priority';
import { checkStateBasedActions } from '../state-based';
import { castSpell, checkTriggersForEvent, putTriggersOnStack, registerBattlefieldAbilities, resolveTopOfStack } from '../stack';
import { getLegalActions } from '../ai/legal-actions';
import { evaluateActions } from '../ai/evaluate';
import { getPlayerView } from '../room-game';
import { executeEffects } from '../effects/executor';
import { getOverride } from '../effects/overrides';
import type { CardDefinition, CardInstance, GameState } from '../types';

function creature(
  id: string,
  name: string,
  power: number,
  toughness: number,
  keywords: string[] = [],
): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature - Test',
    oracle_text: '',
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords,
    card_types: ['creature'],
    power,
    toughness,
  };
}

function land(id: string, name = 'Wastes'): CardDefinition {
  return {
    id,
    name,
    type_line: 'Basic Land',
    oracle_text: '{T}: Add {C}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['C'],
    keywords: [],
    card_types: ['land'],
  };
}

function instant(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Instant',
    oracle_text: 'Draw a card.',
    mana_cost: '{U}',
    cmc: 1,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    card_types: ['instant'],
  };
}

function artifact(id: string, name: string, typeLine = 'Artifact'): CardDefinition {
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: '',
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['artifact'],
  };
}

function enchantment(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Enchantment',
    oracle_text: '',
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['enchantment'],
  };
}

function rhystic(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Enchantment',
    oracle_text: 'Whenever an opponent casts a spell, draw a card unless that player pays {1}.',
    mana_cost: '{2}{U}',
    cmc: 3,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    card_types: ['enchantment'],
    unlessTax: { triggerKind: 'OpponentCastSpell', taxAmount: 1, effect: 'draw', effectCount: 1 },
  };
}

function endStepCard(id: string, name: string, opponents = false): CardDefinition {
  return {
    id,
    name,
    type_line: 'Enchantment',
    oracle_text: opponents
      ? "At the beginning of each opponent's end step, draw a card."
      : 'At the beginning of your end step, draw a card.',
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['enchantment'],
  };
}

function shield(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Artifact - Equipment',
    oracle_text: 'Equipped creature gets +0/+4.\nEquip {2}',
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['artifact'],
    isEquipment: true,
    equipCost: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 2 },
    equipmentBonus: { power: 0, toughness: 4, keywords: [] },
  };
}

function vivi(): CardDefinition {
  return {
    ...creature('vivi', 'Vivi Ornitier', 0, 3),
    oracle_text: 'Whenever you cast a noncreature spell, put a +1/+1 counter on Vivi Ornitier and it deals 1 damage to each opponent.',
    mana_cost: '{1}{U}{R}',
    colors: ['U', 'R'],
    color_identity: ['U', 'R'],
  };
}

function moveToBattlefield(state: GameState, playerId: string, definitionId: string, isToken = false): string {
  const card = Array.from(state.cards.values()).find(item =>
    item.ownerId === playerId && item.definitionId === definitionId && item.zone !== 'battlefield'
  );
  if (!card) throw new Error(`Missing card ${definitionId} for ${playerId}`);
  state.cards.set(card.instanceId, { ...card, zone: 'battlefield', summoningSick: false, isToken });
  return card.instanceId;
}

function moveToHand(state: GameState, playerId: string, definitionId: string): string {
  const card = Array.from(state.cards.values()).find(item => item.ownerId === playerId && item.definitionId === definitionId);
  if (!card) throw new Error(`Missing card ${definitionId} for ${playerId}`);
  state.cards.set(card.instanceId, { ...card, zone: 'hand', summoningSick: false });
  return card.instanceId;
}

function registerPermanent(state: GameState, instanceId: string): GameState {
  return registerBattlefieldAbilities(state, instanceId);
}

function giveMana(state: GameState, playerId: string, amount: number): GameState {
  const index = state.players.findIndex(player => player.id === playerId);
  return {
    ...state,
    players: state.players.map((player, playerIndex) => playerIndex === index
      ? { ...player, manaPool: addMana(player.manaPool, 'U', amount) }
      : player),
  };
}

function makeFourPlayerCombatState(): {
  state: GameState;
  ids: Record<string, string>;
} {
  const tramplingCommander: CardDefinition = {
    ...creature('cmd-trample', 'Trampling Commander', 7, 7, ['Trample']),
    type_line: 'Legendary Creature - Giant',
  };
  const doubleLifelink = creature('double-life', 'Twin Healer', 2, 2, ['Double Strike', 'Lifelink']);
  const venomTrampler = creature('venom-trample', 'Venom Charger', 3, 3, ['Deathtouch', 'Trample']);
  const bear = creature('bear', 'Bear Blocker', 2, 2);
  const colossus = creature('colossus', 'Large Blocker', 6, 6);

  let state = initGameState([
    { playerId: 'p1', name: 'Attacker', cards: [tramplingCommander, doubleLifelink, venomTrampler], commanderId: 'cmd-trample' },
    { playerId: 'p2', name: 'Left Defender', cards: [bear], commanderId: 'no-commander-2' },
    { playerId: 'p3', name: 'Middle Defender', cards: [land('p3-land')], commanderId: 'no-commander-3' },
    { playerId: 'p4', name: 'Right Defender', cards: [colossus], commanderId: 'no-commander-4' },
  ]);

  const ids = {
    commander: moveToBattlefield(state, 'p1', 'cmd-trample'),
    doubleLifelink: moveToBattlefield(state, 'p1', 'double-life'),
    venomTrampler: moveToBattlefield(state, 'p1', 'venom-trample'),
    bear: moveToBattlefield(state, 'p2', 'bear'),
    colossus: moveToBattlefield(state, 'p4', 'colossus'),
  };

  state = {
    ...state,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'combat',
    step: 'declare_attackers',
    hasPriorityPassed: [false, false, false, false],
  };

  return { state, ids };
}

describe('multiplayer engine maturity regressions', () => {
  it('rotates priority through four players and skips eliminated seats', () => {
    let state = initGameState([
      { playerId: 'p1', name: 'One', cards: [land('l1')], commanderId: 'missing-1' },
      { playerId: 'p2', name: 'Two', cards: [land('l2')], commanderId: 'missing-2' },
      { playerId: 'p3', name: 'Three', cards: [land('l3')], commanderId: 'missing-3' },
      { playerId: 'p4', name: 'Four', cards: [land('l4')], commanderId: 'missing-4' },
    ]);

    state = passPriority(state);
    expect(state.priorityPlayerIndex).toBe(1);
    state = passPriority(state);
    expect(state.priorityPlayerIndex).toBe(2);
    state = passPriority(state);
    expect(state.priorityPlayerIndex).toBe(3);
    state = passPriority(state);
    expect(allPlayersPassed(state)).toBe(true);

    state = {
      ...state,
      priorityPlayerIndex: 1,
      hasPriorityPassed: [false, false, false, false],
      players: state.players.map(player => player.id === 'p3' ? { ...player, hasLost: true } : player),
    };
    state = passPriority(state);
    expect(state.priorityPlayerIndex).toBe(3);
  });

  it('handles one attacker swinging at three opponents with trample, deathtouch, double strike, lifelink, and commander damage', () => {
    let { state, ids } = makeFourPlayerCombatState();

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: ids.commander, defendingPlayerId: 'p2' },
      { cardInstanceId: ids.doubleLifelink, defendingPlayerId: 'p3' },
      { cardInstanceId: ids.venomTrampler, defendingPlayerId: 'p4' },
    ]);
    state = declareBlockers(state, 'p2', [
      { cardInstanceId: ids.bear, blockingAttackerId: ids.commander },
    ]);
    state = declareBlockers(state, 'p4', [
      { cardInstanceId: ids.colossus, blockingAttackerId: ids.venomTrampler },
    ]);

    state = checkStateBasedActions(resolveCombatDamage(state));

    expect(state.players.find(player => player.id === 'p1')?.life).toBe(44);
    expect(state.players.find(player => player.id === 'p2')?.life).toBe(35);
    expect(state.players.find(player => player.id === 'p2')?.commanderDamage[ids.commander]).toBe(5);
    expect(state.players.find(player => player.id === 'p3')?.life).toBe(36);
    expect(state.players.find(player => player.id === 'p4')?.life).toBe(38);
    expect(state.cards.get(ids.bear)?.zone).toBe('graveyard');
    expect(state.cards.get(ids.colossus)?.zone).toBe('graveyard');
  });

  it('assigns trample damage using effective blocker toughness across a four-player combat', () => {
    const tramplingCommander: CardDefinition = {
      ...creature('cmd-trample', 'Trampling Commander', 7, 7, ['Trample']),
      type_line: 'Legendary Creature - Giant',
    };
    const bear = creature('bear', 'Shielded Bear', 2, 2);
    const bigShield = shield('big-shield', 'Giant Shield');

    let state = initGameState([
      { playerId: 'p1', name: 'Attacker', cards: [tramplingCommander], commanderId: 'cmd-trample' },
      { playerId: 'p2', name: 'Shielded Defender', cards: [bear, bigShield], commanderId: 'missing-2' },
      { playerId: 'p3', name: 'Observer A', cards: [land('l3')], commanderId: 'missing-3' },
      { playerId: 'p4', name: 'Observer B', cards: [land('l4')], commanderId: 'missing-4' },
    ]);
    const commanderId = moveToBattlefield(state, 'p1', 'cmd-trample');
    const bearId = moveToBattlefield(state, 'p2', 'bear');
    const shieldId = moveToBattlefield(state, 'p2', 'big-shield');
    state.cards.set(shieldId, { ...state.cards.get(shieldId)!, attachedTo: bearId });
    state = { ...state, activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'combat', step: 'declare_attackers' };

    state = declareAttackers(state, 'p1', [{ cardInstanceId: commanderId, defendingPlayerId: 'p2' }]);
    state = declareBlockers(state, 'p2', [{ cardInstanceId: bearId, blockingAttackerId: commanderId }]);
    state = checkStateBasedActions(resolveCombatDamage(state));

    expect(state.players.find(player => player.id === 'p2')?.life).toBe(39);
    expect(state.players.find(player => player.id === 'p2')?.commanderDamage[commanderId]).toBe(1);
  });

  it('offers a split-attack legal action so one player can pressure multiple defenders', () => {
    let { state } = makeFourPlayerCombatState();

    const actions = getLegalActions(state, 'p1');
    const splitAttack = actions.find(action =>
      action.kind === 'DeclareAttackers'
      && action.attacks.length >= 3
      && new Set(action.attacks.map(attack => attack.defendingPlayerId)).size >= 2
    );

    expect(splitAttack).toBeTruthy();
  });

  it('scores attacks toward the multiplayer archenemy when life totals are close', () => {
    const attacker = creature('attacker', 'Political Bruiser', 4, 4);
    const dragon = creature('dragon', 'Archenemy Dragon', 6, 6, ['Flying']);
    let state = initGameState([
      { playerId: 'p1', name: 'Attacker', cards: [attacker], commanderId: 'missing-1' },
      { playerId: 'p2', name: 'Low Board', cards: [land('l2')], commanderId: 'missing-2' },
      { playerId: 'p3', name: 'Archenemy', cards: [dragon, dragon, dragon, dragon, dragon], commanderId: 'missing-3' },
      { playerId: 'p4', name: 'Neutral', cards: [land('l4')], commanderId: 'missing-4' },
    ]);
    moveToBattlefield(state, 'p1', 'attacker');
    for (const card of [...state.cards.values()].filter(instance => instance.ownerId === 'p3' && instance.definitionId === 'dragon')) {
      state.cards.set(card.instanceId, { ...card, zone: 'battlefield', summoningSick: false });
    }
    state.players = state.players.map(player =>
      player.id === 'p2' ? { ...player, life: 30 } : player
    );
    state = { ...state, activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'combat', step: 'declare_attackers' };

    const attackActions = getLegalActions(state, 'p1').filter(action =>
      action.kind === 'DeclareAttackers' && action.attacks.length === 1
    );
    const [best] = evaluateActions(state, 'p1', attackActions);

    expect(best.action.kind).toBe('DeclareAttackers');
    if (best.action.kind === 'DeclareAttackers') {
      expect(best.action.attacks[0].defendingPlayerId).toBe('p3');
    }
  });

  it('resolves a Vivi-style each-opponent trigger across a four-player pod without damaging its controller', () => {
    let state = initGameState([
      { playerId: 'p1', name: 'Vivi', cards: [vivi(), instant('opt', 'Opt'), land('island-1', 'Island')], commanderId: 'missing-1' },
      { playerId: 'p2', name: 'Opponent A', cards: [land('island-2', 'Island')], commanderId: 'missing-2' },
      { playerId: 'p3', name: 'Opponent B', cards: [land('island-3', 'Island')], commanderId: 'missing-3' },
      { playerId: 'p4', name: 'Opponent C', cards: [land('island-4', 'Island')], commanderId: 'missing-4' },
    ]);

    const viviId = moveToBattlefield(state, 'p1', 'vivi');
    state = registerBattlefieldAbilities(state, viviId);
    const optId = moveToHand(state, 'p1', 'opt');
    state = giveMana(state, 'p1', 1);
    state = { ...state, activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat' };

    state = castSpell(state, 'p1', optId);
    expect(state.pendingTriggers).toHaveLength(1);
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    expect((state.cards.get(viviId) as CardInstance).counters['+1/+1']).toBe(1);
    expect(state.players.find(player => player.id === 'p1')?.life).toBe(40);
    expect(state.players.find(player => player.id === 'p2')?.life).toBe(39);
    expect(state.players.find(player => player.id === 'p3')?.life).toBe(39);
    expect(state.players.find(player => player.id === 'p4')?.life).toBe(39);
  });

  it('orders mixed four-player end-step and delayed triggers in APNAP stack order', () => {
    let state = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [endStepCard('p1-opponent-end', 'Alice Opponent End', true)], commanderId: 'missing-1' },
      { playerId: 'p2', name: 'Bob', cards: [endStepCard('p2-opponent-end', 'Bob Opponent End', true)], commanderId: 'missing-2' },
      { playerId: 'p3', name: 'Carol', cards: [endStepCard('p3-self-end', 'Carol Self End')], commanderId: 'missing-3' },
      { playerId: 'p4', name: 'Dana', cards: [endStepCard('p4-opponent-end', 'Dana Opponent End', true)], commanderId: 'missing-4' },
    ]);
    const p1Permanent = moveToBattlefield(state, 'p1', 'p1-opponent-end');
    const p2Permanent = moveToBattlefield(state, 'p2', 'p2-opponent-end');
    const p3Permanent = moveToBattlefield(state, 'p3', 'p3-self-end');
    const p4Permanent = moveToBattlefield(state, 'p4', 'p4-opponent-end');
    state = registerPermanent(registerPermanent(registerPermanent(registerPermanent(state, p1Permanent), p2Permanent), p3Permanent), p4Permanent);
    state = {
      ...state,
      activePlayerIndex: 2,
      priorityPlayerIndex: 2,
      phase: 'ending',
      step: 'end',
      delayedTriggers: [{
        id: 'delayed-carol-end',
        sourceInstanceId: p3Permanent,
        controllerId: 'p3',
        trigger: { kind: 'EndStep', whose: 'yours' },
        effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: 1 }],
        oneShot: true,
      }],
    };

    state = checkTriggersForEvent(state, { kind: 'EndStepStart', activePlayerId: 'p3' });
    state = putTriggersOnStack(state);

    expect(state.stack.map(item => item.kind === 'TriggeredAbility' ? item.controllerId : 'spell')).toEqual([
      'p3',
      'p3',
      'p4',
      'p1',
      'p2',
    ]);
  });

  it('handles multiple Rhystic-style opponent-cast triggers across three opponents', () => {
    let state = initGameState([
      { playerId: 'p1', name: 'Tax A', cards: [rhystic('rhystic-a', 'Rhystic A'), instant('p1-draw', 'P1 Draw Fodder')], commanderId: 'missing-1' },
      { playerId: 'p2', name: 'Tax B', cards: [rhystic('rhystic-b', 'Rhystic B'), instant('p2-draw', 'P2 Draw Fodder')], commanderId: 'missing-2' },
      { playerId: 'p3', name: 'Caster', cards: [instant('opt', 'Opt')], commanderId: 'missing-3' },
      { playerId: 'p4', name: 'Tax C', cards: [rhystic('rhystic-c', 'Rhystic C'), instant('p4-draw', 'P4 Draw Fodder')], commanderId: 'missing-4' },
    ]);
    const r1 = moveToBattlefield(state, 'p1', 'rhystic-a');
    const r2 = moveToBattlefield(state, 'p2', 'rhystic-b');
    const r4 = moveToBattlefield(state, 'p4', 'rhystic-c');
    state = registerPermanent(registerPermanent(registerPermanent(state, r1), r2), r4);
    const optId = moveToHand(state, 'p3', 'opt');
    state = giveMana(state, 'p3', 1);
    state = { ...state, activePlayerIndex: 2, priorityPlayerIndex: 2, phase: 'precombat_main', step: 'upkeep' };

    const handBefore = Object.fromEntries(state.players.map(player => [player.id, getCardsInZone(state, player.id, 'hand').length]));
    state = castSpell(state, 'p3', optId);
    expect(state.pendingTriggers).toHaveLength(3);

    state = putTriggersOnStack(state);
    expect(state.stack.map(item => item.kind === 'TriggeredAbility' ? item.controllerId : 'spell')).toEqual([
      'spell',
      'p4',
      'p1',
      'p2',
    ]);

    state = resolveTopOfStack(resolveTopOfStack(resolveTopOfStack(state)));

    expect(getCardsInZone(state, 'p1', 'hand')).toHaveLength(handBefore.p1 + 1);
    expect(getCardsInZone(state, 'p2', 'hand')).toHaveLength(handBefore.p2 + 1);
    expect(getCardsInZone(state, 'p3', 'hand')).toHaveLength(handBefore.p3 - 1);
    expect(getCardsInZone(state, 'p4', 'hand')).toHaveLength(handBefore.p4 + 1);
  });

  it('counts artifact and enchantment permanents across all three opponents for Dockside-style treasure creation', () => {
    const dockside = getOverride('dockside-extortionist', 'Dockside Extortionist');
    expect(dockside?.kind).toBe('ETB');
    if (!dockside || dockside.kind !== 'ETB') return;

    let state = initGameState([
      { playerId: 'p1', name: 'Dockside Pilot', cards: [land('p1-land')], commanderId: 'missing-1' },
      {
        playerId: 'p2',
        name: 'Artifact Player',
        cards: [
          artifact('p2-rock-a', 'Mana Rock A'),
          artifact('p2-rock-b', 'Mana Rock B'),
          artifact('p2-clue', 'Clue', 'Token Artifact - Clue'),
          enchantment('p2-study', 'Rhystic Study'),
        ],
        commanderId: 'missing-2',
      },
      {
        playerId: 'p3',
        name: 'Token Player',
        cards: [
          artifact('p3-food-a', 'Food', 'Token Artifact - Food'),
          artifact('p3-food-b', 'Food', 'Token Artifact - Food'),
          artifact('p3-map', 'Map', 'Token Artifact - Map'),
        ],
        commanderId: 'missing-3',
      },
      {
        playerId: 'p4',
        name: 'Mixed Player',
        cards: [
          artifact('p4-blood', 'Blood', 'Token Artifact - Blood'),
          artifact('p4-rock', 'Mana Rock C'),
          enchantment('p4-remora', 'Mystic Remora'),
        ],
        commanderId: 'missing-4',
      },
    ]);

    for (const definitionId of ['p2-rock-a', 'p2-rock-b', 'p2-study']) {
      moveToBattlefield(state, 'p2', definitionId);
    }
    moveToBattlefield(state, 'p2', 'p2-clue', true);
    for (const definitionId of ['p3-food-a', 'p3-food-b', 'p3-map']) {
      moveToBattlefield(state, 'p3', definitionId, true);
    }
    moveToBattlefield(state, 'p4', 'p4-blood', true);
    moveToBattlefield(state, 'p4', 'p4-rock');
    moveToBattlefield(state, 'p4', 'p4-remora');

    const next = executeEffects(state, dockside.ability.effects, 'p1', [], []);
    const treasures = Array.from(next.cards.values()).filter(card => {
      const def = next.cardDefinitions.get(card.definitionId);
      return card.ownerId === 'p1' && card.zone === 'battlefield' && card.isToken && def?.name === 'Treasure';
    });

    expect(treasures).toHaveLength(10);
  });

  it('keeps four-player hidden hand and library details scoped to the viewer', () => {
    let state = initGameState([
      { playerId: 'p1', name: 'Viewer', cards: [instant('p1-secret', 'Viewer Tutor')], commanderId: 'missing-1' },
      { playerId: 'p2', name: 'Hidden A', cards: [instant('p2-secret', 'Hidden Consultation')], commanderId: 'missing-2' },
      { playerId: 'p3', name: 'Hidden B', cards: [instant('p3-secret', 'Hidden Scry Card')], commanderId: 'missing-3' },
      { playerId: 'p4', name: 'Hidden C', cards: [instant('p4-secret', 'Hidden Look Card')], commanderId: 'missing-4' },
    ]);
    moveToHand(state, 'p1', 'p1-secret');
    moveToHand(state, 'p2', 'p2-secret');
    moveToHand(state, 'p3', 'p3-secret');
    moveToHand(state, 'p4', 'p4-secret');

    const p1View = getPlayerView(state, 'p1');
    const p2View = getPlayerView(state, 'p2');
    const p2InP1View = p1View.players.find(player => player.id === 'p2')!;
    const p2Self = p2View.players.find(player => player.id === 'p2')!;

    expect(p1View.players.find(player => player.id === 'p1')?.zones.hand.cards?.map(card => card.name)).toContain('Viewer Tutor');
    expect(p2InP1View.zones.hand.count).toBe(1);
    expect(p2InP1View.zones.hand.cards).toBeUndefined();
    expect(p2InP1View.zones.library.cards).toBeUndefined();
    expect(p2Self.zones.hand.cards?.map(card => card.name)).toContain('Hidden Consultation');
  });
});
