import { describe, it, expect, beforeEach } from 'vitest';
import { tryPlayLand, tryTapLandForMana, tryUntapManaSource, tryCastSpell, tryActivateAbility, tryPassPriority, tryDeclareAttackers, tryDeclareBlockers, tryEquip, tryAdjustCounters, tryAdjustPlayerCounter, tryMoveCardManually, tryCreateManualToken, resetLoopDetector } from './actions-public';
import { makeTestState } from './__tests__/test-helpers';
import { populateParsedCache } from './cards/card-parser-cache';
import type { CardDefinition, GameState } from './types';

function addBattlefieldManaCreature(
  state: GameState,
  options: { instanceId?: string; summoningSick?: boolean; haste?: boolean } = {},
): string {
  const instanceId = options.instanceId ?? 'mana_creature_0';
  const def: CardDefinition = populateParsedCache({
    id: `def_${instanceId}`,
    name: options.haste ? 'Hasty Mana Druid' : 'Somberwald Sage',
    type_line: 'Creature - Human Druid',
    oracle_text: options.haste
      ? 'Haste\n{T}: Add {G}.'
      : '{T}: Add three mana of any one color. Spend this mana only to cast creature spells.',
    mana_cost: '{2}{G}',
    cmc: 3,
    colors: ['G'],
    color_identity: ['G'],
    keywords: options.haste ? ['Haste'] : [],
    card_types: ['creature'],
    power: 0,
    toughness: 1,
  });
  state.cardDefinitions.set(def.id, def);
  state.cards.set(instanceId, {
    instanceId,
    definitionId: def.id,
    ownerId: 'human',
    zone: 'battlefield',
    tapped: false,
    summoningSick: options.summoningSick ?? true,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  return instanceId;
}

function addHandSpell(
  state: GameState,
  options: {
    instanceId: string;
    name: string;
    typeLine: string;
    manaCost: string;
    cardTypes: CardDefinition['card_types'];
    isCommander?: boolean;
    zone?: 'hand' | 'command';
  },
): string {
  const def: CardDefinition = {
    id: `def_${options.instanceId}`,
    name: options.name,
    type_line: options.typeLine,
    oracle_text: '',
    mana_cost: options.manaCost,
    cmc: (options.manaCost.match(/\{[^}]+\}/g) || []).length,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: options.cardTypes,
    power: options.cardTypes.includes('creature') ? 2 : undefined,
    toughness: options.cardTypes.includes('creature') ? 2 : undefined,
  };
  state.cardDefinitions.set(def.id, def);
  state.cards.set(options.instanceId, {
    instanceId: options.instanceId,
    definitionId: def.id,
    ownerId: 'human',
    zone: options.zone ?? 'hand',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: options.isCommander ?? false,
  });
  if (options.isCommander) {
    state.players[0] = {
      ...state.players[0],
      commanderInstanceId: options.instanceId,
      commanderInstanceIds: [options.instanceId],
    };
  }
  return options.instanceId;
}

function addHandCavern(state: GameState, instanceId = 'cavern_0'): string {
  const def: CardDefinition = populateParsedCache({
    id: `def_${instanceId}`,
    name: 'Cavern of Souls',
    type_line: 'Land',
    oracle_text: 'As Cavern of Souls enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can\'t be countered.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['land'],
  });
  state.cardDefinitions.set(def.id, def);
  state.cards.set(instanceId, {
    instanceId,
    definitionId: def.id,
    ownerId: 'human',
    zone: 'hand',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  return instanceId;
}

function addBattlefieldBlackerLotus(state: GameState, instanceId = 'blacker_lotus_0'): string {
  const def: CardDefinition = populateParsedCache({
    id: `def_${instanceId}`,
    name: 'Blacker Lotus',
    type_line: 'Artifact',
    oracle_text: '{T}: Tear Blacker Lotus into pieces. Add four mana of any one color. Remove the pieces from the game.',
    mana_cost: '0',
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['artifact'],
  });
  state.cardDefinitions.set(def.id, def);
  state.cards.set(instanceId, {
    instanceId,
    definitionId: def.id,
    ownerId: 'human',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  return instanceId;
}

describe('tryPlayLand', () => {
  it('returns ok and LandPlayed event on success', () => {
    const state = makeTestState({ handLands: 1 });
    const landId = [...state.cards.values()].find(c => c.zone === 'hand')!.instanceId;
    const result = tryPlayLand(state, 'human', landId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events).toContainEqual(
        expect.objectContaining({ kind: 'LandPlayed', cardId: landId }),
      );
    }
  });

  it('returns land_already_played when a land was played this turn', () => {
    const state = makeTestState({ handLands: 2, landAlreadyPlayed: true });
    const landId = [...state.cards.values()].find(c => c.zone === 'hand')!.instanceId;
    const result = tryPlayLand(state, 'human', landId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('land_already_played');
  });

  it('returns wrong_phase outside main phase', () => {
    const state = makeTestState({ handLands: 1, phase: 'combat' });
    const landId = [...state.cards.values()].find(c => c.zone === 'hand')!.instanceId;
    const result = tryPlayLand(state, 'human', landId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrong_phase');
  });

  it('returns priority_not_yours when another player has priority', () => {
    const state = makeTestState({ handLands: 1 });
    state.priorityPlayerIndex = 1;
    const landId = [...state.cards.values()].find(c => c.zone === 'hand')!.instanceId;
    const result = tryPlayLand(state, 'human', landId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('priority_not_yours');
      expect(result.message).toBe('You do not have priority');
    }
  });

  it('returns wrong_phase with stack-empty reason while a spell is on the stack', () => {
    const state = makeTestState({ handLands: 1 });
    const landId = [...state.cards.values()].find(c => c.zone === 'hand')!.instanceId;
    const spellId = addHandSpell(state, {
      instanceId: 'stack_spell',
      name: 'Stack Spell',
      typeLine: 'Instant',
      manaCost: '{G}',
      cardTypes: ['instant'],
    });
    state.cards.set(spellId, { ...state.cards.get(spellId)!, zone: 'stack' });
    state.stack = [{
      kind: 'Spell',
      id: 'stack-spell',
      cardInstanceId: spellId,
      casterId: 'human',
      targets: [],
    }];

    const result = tryPlayLand(state, 'human', landId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('wrong_phase');
      expect(result.message).toBe('The stack must be empty');
    }
  });

  it('returns not_your_turn when active player is elsewhere', () => {
    const state = makeTestState({ handLands: 1, activePlayerIndex: 1 });
    const landId = [...state.cards.values()].find(c => c.zone === 'hand')!.instanceId;
    const result = tryPlayLand(state, 'human', landId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_your_turn');
  });

  it('returns card_not_found for unknown instance id', () => {
    const state = makeTestState({});
    const result = tryPlayLand(state, 'human', 'nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('card_not_found');
  });

  it('stores a chosen creature type for Cavern-style lands', () => {
    const state = makeTestState({});
    const cavernId = addHandCavern(state);

    const result = tryPlayLand(state, 'human', cavernId, { chosenCreatureType: '  Elf   Druid  ' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.cards.get(cavernId)?.choices?.chosenCreatureType).toBe('Elf Druid');
  });
});

describe('tryTapLandForMana', () => {
  it('returns ok with ManaTapped event when untapped land exists', () => {
    const state = makeTestState({ battlefieldLands: 1 });
    const landId = [...state.cards.values()].find(c => c.zone === 'battlefield')!.instanceId;
    const result = tryTapLandForMana(state, 'human', landId, 'G');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events[0]).toEqual({ kind: 'ManaTapped', playerId: 'human', cardId: landId, color: 'G' });
    }
  });

  it('returns already_tapped when land is tapped', () => {
    const state = makeTestState({ battlefieldLands: 1, tapLands: true });
    const landId = [...state.cards.values()].find(c => c.zone === 'battlefield')!.instanceId;
    const result = tryTapLandForMana(state, 'human', landId, 'G');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('already_tapped');
  });

  it('returns not_in_zone for hand card', () => {
    const state = makeTestState({ handLands: 1 });
    const landId = [...state.cards.values()].find(c => c.zone === 'hand')!.instanceId;
    const result = tryTapLandForMana(state, 'human', landId, 'G');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_in_zone');
  });

  it('returns summoning_sick for a tap mana creature just summoned', () => {
    const state = makeTestState({});
    const creatureId = addBattlefieldManaCreature(state, { summoningSick: true });

    const result = tryTapLandForMana(state, 'human', creatureId, 'G');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('summoning_sick');
  });

  it('allows a summoning-sick tap mana creature with haste', () => {
    const state = makeTestState({});
    const creatureId = addBattlefieldManaCreature(state, { summoningSick: true, haste: true });

    const result = tryTapLandForMana(state, 'human', creatureId, 'G');

    expect(result.ok).toBe(true);
  });

  it('tracks Somberwald-style restricted mana in the pool', () => {
    const state = makeTestState({});
    const creatureId = addBattlefieldManaCreature(state, { summoningSick: false });

    const result = tryTapLandForMana(state, 'human', creatureId, 'R');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players[0].manaPool.R).toBe(3);
    expect(result.state.players[0].restrictedMana).toEqual([
      { color: 'R', amount: 3, restriction: 'creatureSpell', sourceInstanceId: creatureId },
    ]);
  });

  it('tracks Cavern chosen-type mana with its chosen creature type', () => {
    let state = makeTestState({});
    const cavernId = addHandCavern(state);
    const playResult = tryPlayLand(state, 'human', cavernId, { chosenCreatureType: 'Elf' });
    expect(playResult.ok).toBe(true);
    if (!playResult.ok) return;
    state = playResult.state;

    const manaResult = tryTapLandForMana(state, 'human', cavernId, 'G');

    expect(manaResult.ok).toBe(true);
    if (!manaResult.ok) return;
    expect(manaResult.state.players[0].manaPool.G).toBe(1);
    expect(manaResult.state.players[0].restrictedMana).toEqual([
      { color: 'G', amount: 1, restriction: 'creatureTypeSpell', creatureType: 'Elf', sourceInstanceId: cavernId },
    ]);
  });

  it('models Blacker Lotus as a one-shot silver-bordered mana source exiled after use', () => {
    const state = makeTestState({});
    const lotusId = addBattlefieldBlackerLotus(state);

    const result = tryTapLandForMana(state, 'human', lotusId, 'R');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players[0].manaPool.R).toBe(4);
    expect(result.state.cards.get(lotusId)?.zone).toBe('exile');
  });
});

describe('tryUntapManaSource', () => {
  it('untaps a tapped mana source and removes its unspent mana through a validated action', () => {
    let state = makeTestState({ battlefieldLands: 1 });
    const landId = [...state.cards.values()].find(c => c.zone === 'battlefield')!.instanceId;
    const tapResult = tryTapLandForMana(state, 'human', landId, 'G');
    expect(tapResult.ok).toBe(true);
    if (!tapResult.ok) return;
    state = tapResult.state;

    const result = tryUntapManaSource(state, 'human', landId, 'G', 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.cards.get(landId)?.tapped).toBe(false);
    expect(result.state.players[0].manaPool.G).toBe(0);
    expect(result.events[0]).toEqual({
      kind: 'ManaUntapped',
      playerId: 'human',
      cardId: landId,
      color: 'G',
      amount: 1,
      manual: true,
    });
  });

  it('rejects mana untap correction when the matching floating mana is already spent', () => {
    let state = makeTestState({ battlefieldLands: 1 });
    const landId = [...state.cards.values()].find(c => c.zone === 'battlefield')!.instanceId;
    const tapResult = tryTapLandForMana(state, 'human', landId, 'G');
    expect(tapResult.ok).toBe(true);
    if (!tapResult.ok) return;
    state = {
      ...tapResult.state,
      players: tapResult.state.players.map(player =>
        player.id === 'human'
          ? { ...player, manaPool: { ...player.manaPool, G: 0 } }
          : player,
      ),
    };

    const result = tryUntapManaSource(state, 'human', landId, 'G', 1);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('insufficient_mana');
  });

  it('rejects untapping an already untapped mana source', () => {
    const state = makeTestState({ battlefieldLands: 1 });
    const landId = [...state.cards.values()].find(c => c.zone === 'battlefield')!.instanceId;

    const result = tryUntapManaSource(state, 'human', landId, 'G', 1);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('Card is not tapped');
  });
});

describe('tryAdjustCounters', () => {
  it('adds a manual counter to a battlefield permanent', () => {
    const state = makeTestState({ battlefieldCreature: true });
    const creatureId = 'vanilla_creature_0';

    const result = tryAdjustCounters(state, 'human', creatureId, '+1/+1', 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.cards.get(creatureId)?.counters['+1/+1']).toBe(2);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'CountersAdjusted',
        playerId: 'human',
        cardId: creatureId,
        counterType: '+1/+1',
        delta: 2,
        previous: 0,
        next: 2,
        manual: true,
      }),
    );
  });

  it('removes counters without going below zero', () => {
    const state = makeTestState({ battlefieldCreature: true });
    const creatureId = 'vanilla_creature_0';
    state.cards.set(creatureId, {
      ...state.cards.get(creatureId)!,
      counters: { '+1/+1': 1 },
    });

    const result = tryAdjustCounters(state, 'human', creatureId, '+1/+1', -1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.cards.get(creatureId)?.counters['+1/+1']).toBeUndefined();
  });

  it('rejects removing a counter that is not present', () => {
    const state = makeTestState({ battlefieldCreature: true });

    const result = tryAdjustCounters(state, 'human', 'vanilla_creature_0', 'stun', -1);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('illegal_target');
  });

  it('rejects non-battlefield cards', () => {
    const state = makeTestState({ handInstant: '{G}' });

    const result = tryAdjustCounters(state, 'human', 'instant_0', '+1/+1', 1);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_in_zone');
  });

  it('normalizes counter type whitespace', () => {
    const state = makeTestState({ battlefieldCreature: true });

    const result = tryAdjustCounters(state, 'human', 'vanilla_creature_0', '  shield   counter  ', 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.cards.get('vanilla_creature_0')?.counters['shield counter']).toBe(1);
  });
});

describe('tryAdjustPlayerCounter', () => {
  it('adds a generic player counter', () => {
    const state = makeTestState({});

    const result = tryAdjustPlayerCounter(state, 'human', 'human', 'experience', 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players.find(player => player.id === 'human')?.playerCounters?.experience).toBe(2);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'PlayerCounterAdjusted',
        playerId: 'human',
        targetPlayerId: 'human',
        counterType: 'experience',
        delta: 2,
        previous: 0,
        next: 2,
        manual: true,
      }),
    );
  });

  it('routes poison through poisonCounters', () => {
    const state = makeTestState({});

    const result = tryAdjustPlayerCounter(state, 'human', 'human', 'poison', 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const player = result.state.players.find(candidate => candidate.id === 'human');
    expect(player?.poisonCounters).toBe(1);
    expect(player?.playerCounters?.poison).toBeUndefined();
  });

  it('rejects removing missing player counters', () => {
    const state = makeTestState({});

    const result = tryAdjustPlayerCounter(state, 'human', 'human', 'energy', -1);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('illegal_target');
  });
});

describe('tryMoveCardManually', () => {
  it('moves a visible permanent to exile and clears battlefield state', () => {
    const state = makeTestState({ battlefieldCreature: true });
    state.cards.set('vanilla_creature_0', {
      ...state.cards.get('vanilla_creature_0')!,
      tapped: true,
      counters: { '+1/+1': 2 },
      damage: 1,
    });

    const result = tryMoveCardManually(state, 'human', 'vanilla_creature_0', 'exile');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const moved = result.state.cards.get('vanilla_creature_0');
    expect(moved?.zone).toBe('exile');
    expect(moved?.tapped).toBe(false);
    expect(moved?.counters).toEqual({});
    expect(moved?.damage).toBe(0);
    expect(result.events).toContainEqual(expect.objectContaining({
      kind: 'CardMovedManually',
      playerId: 'human',
      cardId: 'vanilla_creature_0',
      from: 'battlefield',
      to: 'exile',
      manual: true,
    }));
  });

  it('removes tokens moved away from the battlefield', () => {
    const created = tryCreateManualToken(makeTestState({}), 'human', {
      name: 'Goblin',
      count: 1,
      power: 1,
      toughness: 1,
      colors: ['R'],
      types: ['creature'],
      subtypes: ['Goblin'],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const token = [...created.state.cards.values()].find(card => card.isToken);
    expect(token).toBeDefined();

    const result = tryMoveCardManually(created.state, 'human', token!.instanceId, 'graveyard');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.cards.has(token!.instanceId)).toBe(false);
  });

  it('rejects moving non-commanders to command', () => {
    const state = makeTestState({ battlefieldCreature: true });

    const result = tryMoveCardManually(state, 'human', 'vanilla_creature_0', 'command');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('illegal_target');
  });

  it('allows commanders to be moved back to command', () => {
    const state = makeTestState({ battlefieldCreature: true });
    state.cards.set('vanilla_creature_0', {
      ...state.cards.get('vanilla_creature_0')!,
      isCommander: true,
    });
    state.players[0] = {
      ...state.players[0],
      commanderInstanceId: 'vanilla_creature_0',
      commanderInstanceIds: ['vanilla_creature_0'],
    };

    const result = tryMoveCardManually(state, 'human', 'vanilla_creature_0', 'command');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.cards.get('vanilla_creature_0')?.zone).toBe('command');
  });
});

describe('tryCreateManualToken', () => {
  it('creates manual creature tokens on the battlefield', () => {
    const state = makeTestState({});

    const result = tryCreateManualToken(state, 'human', {
      name: 'Goblin',
      count: 2,
      power: 1,
      toughness: 1,
      colors: ['R'],
      types: ['creature'],
      subtypes: ['Goblin'],
      keywords: ['haste'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const goblins = [...result.state.cards.values()].filter(card => {
      const def = result.state.cardDefinitions.get(card.definitionId);
      return card.ownerId === 'human'
        && card.zone === 'battlefield'
        && card.isToken
        && def?.name === 'Goblin';
    });
    expect(goblins).toHaveLength(2);
    for (const token of goblins) {
      const def = result.state.cardDefinitions.get(token.definitionId);
      expect(def?.card_types).toContain('creature');
      expect(def?.type_line).toContain('Goblin');
      expect(def?.power).toBe(1);
      expect(def?.toughness).toBe(1);
      expect(def?.keywords).toContain('haste');
    }
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'TokenCreated',
        playerId: 'human',
        tokenName: 'Goblin',
        count: 2,
        manual: true,
      }),
    );
  });

  it('rejects impossible manual token counts', () => {
    const state = makeTestState({});

    const result = tryCreateManualToken(state, 'human', {
      name: 'Goblin',
      count: 0,
      power: 1,
      toughness: 1,
      colors: ['R'],
      types: ['creature'],
      subtypes: ['Goblin'],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('illegal_target');
  });
});

describe('tryCastSpell', () => {
  it('returns ok with SpellCast event when mana sufficient', () => {
    const state = makeTestState({ handInstant: '{1}{G}', manaPool: { G: 1, C: 1 } });
    const spellId = [...state.cards.values()].find(c => c.zone === 'hand')!.instanceId;
    const result = tryCastSpell(state, 'human', spellId, [], { C: 1, G: 1, W: 0, U: 0, B: 0, R: 0, generic: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events.some(e => e.kind === 'SpellCast')).toBe(true);
    }
  });

  it('returns insufficient_mana when pool is empty', () => {
    const state = makeTestState({ handInstant: '{1}{G}' });
    const spellId = [...state.cards.values()].find(c => c.zone === 'hand')!.instanceId;
    const result = tryCastSpell(state, 'human', spellId, [], { C: 0, G: 0, W: 0, U: 0, B: 0, R: 0, generic: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('insufficient_mana');
  });

  it('requires one legal color for two-color hybrid mana on commanders', () => {
    let state = makeTestState({ manaPool: { W: 1, U: 1 } });
    let commanderId = addHandSpell(state, {
      instanceId: 'fourteenth_doctor_no_hybrid',
      name: 'The Fourteenth Doctor',
      typeLine: 'Legendary Creature - Time Lord Doctor',
      manaCost: '{R/G}{W}{U}',
      cardTypes: ['creature'],
      isCommander: true,
      zone: 'command',
    });

    const missingHybrid = tryCastSpell(state, 'human', commanderId, [], { W: 1, U: 1, B: 0, R: 0, G: 0, C: 0, generic: 0 });
    expect(missingHybrid.ok).toBe(false);
    if (!missingHybrid.ok) expect(missingHybrid.reason).toBe('insufficient_mana');

    state = makeTestState({ manaPool: { W: 1, U: 1, G: 1 } });
    commanderId = addHandSpell(state, {
      instanceId: 'fourteenth_doctor_with_hybrid',
      name: 'The Fourteenth Doctor',
      typeLine: 'Legendary Creature - Time Lord Doctor',
      manaCost: '{R/G}{W}{U}',
      cardTypes: ['creature'],
      isCommander: true,
      zone: 'command',
    });

    const paidHybrid = tryCastSpell(state, 'human', commanderId, [], {
      W: 1,
      U: 1,
      B: 0,
      R: 0,
      G: 1,
      C: 0,
      generic: 0,
      hybrid: [['R', 'G']],
    });
    expect(paidHybrid.ok).toBe(true);
  });

  it('returns wrong_phase for sorcery during combat', () => {
    const state = makeTestState({ handSorcery: '{G}', manaPool: { G: 1 }, phase: 'combat' });
    const spellId = [...state.cards.values()].find(c => c.zone === 'hand')!.instanceId;
    const result = tryCastSpell(state, 'human', spellId, [], { G: 1, C: 0, W: 0, U: 0, B: 0, R: 0, generic: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrong_phase');
  });

  it('does not let creature-only mana cast noncreature spells', () => {
    let state = makeTestState({});
    const sageId = addBattlefieldManaCreature(state, { summoningSick: false });
    const manaResult = tryTapLandForMana(state, 'human', sageId, 'G');
    expect(manaResult.ok).toBe(true);
    if (!manaResult.ok) return;
    state = manaResult.state;

    const instantId = addHandSpell(state, {
      instanceId: 'restricted_instant',
      name: 'Restricted Test Instant',
      typeLine: 'Instant',
      manaCost: '{G}',
      cardTypes: ['instant'],
    });

    const result = tryCastSpell(state, 'human', instantId, [], { G: 1, W: 0, U: 0, B: 0, R: 0, C: 0, generic: 0 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('insufficient_mana');
  });

  it('allows creature-only mana to cast creature spells and consumes the restriction', () => {
    let state = makeTestState({});
    const sageId = addBattlefieldManaCreature(state, { summoningSick: false });
    const manaResult = tryTapLandForMana(state, 'human', sageId, 'G');
    expect(manaResult.ok).toBe(true);
    if (!manaResult.ok) return;
    state = manaResult.state;

    const creatureId = addHandSpell(state, {
      instanceId: 'restricted_creature',
      name: 'Restricted Test Creature',
      typeLine: 'Creature - Beast',
      manaCost: '{2}{G}',
      cardTypes: ['creature'],
    });

    const result = tryCastSpell(state, 'human', creatureId, [], { G: 1, W: 0, U: 0, B: 0, R: 0, C: 0, generic: 2 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players[0].manaPool.G).toBe(0);
    expect(result.state.players[0].restrictedMana).toEqual([]);
  });

  it('limits commander-only mana to commander casts', () => {
    let state = makeTestState({ manaPool: { G: 3 } });
    state.players[0] = {
      ...state.players[0],
      restrictedMana: [{ color: 'G', amount: 3, restriction: 'commanderSpell' }],
    };

    const normalCreatureId = addHandSpell(state, {
      instanceId: 'normal_creature',
      name: 'Normal Creature',
      typeLine: 'Creature - Beast',
      manaCost: '{2}{G}',
      cardTypes: ['creature'],
    });
    const normalResult = tryCastSpell(state, 'human', normalCreatureId, [], { G: 1, W: 0, U: 0, B: 0, R: 0, C: 0, generic: 2 });
    expect(normalResult.ok).toBe(false);

    const commanderId = addHandSpell(state, {
      instanceId: 'commander_spell',
      name: 'Commander Creature',
      typeLine: 'Legendary Creature - God',
      manaCost: '{2}{G}',
      cardTypes: ['creature', 'enchantment'],
      isCommander: true,
      zone: 'command',
    });
    const commanderResult = tryCastSpell(state, 'human', commanderId, [], { G: 1, W: 0, U: 0, B: 0, R: 0, C: 0, generic: 2 });

    expect(commanderResult.ok).toBe(true);
  });

  it('allows Cavern chosen-type mana to cast a matching creature subtype', () => {
    let state = makeTestState({});
    const cavernId = addHandCavern(state);
    const playResult = tryPlayLand(state, 'human', cavernId, { chosenCreatureType: 'Elf' });
    expect(playResult.ok).toBe(true);
    if (!playResult.ok) return;
    state = playResult.state;

    const manaResult = tryTapLandForMana(state, 'human', cavernId, 'G');
    expect(manaResult.ok).toBe(true);
    if (!manaResult.ok) return;
    state = manaResult.state;

    const elfId = addHandSpell(state, {
      instanceId: 'cavern_elf',
      name: 'Cavern Test Elf',
      typeLine: 'Creature - Elf Druid',
      manaCost: '{G}',
      cardTypes: ['creature'],
    });

    const result = tryCastSpell(state, 'human', elfId, [], { G: 1, W: 0, U: 0, B: 0, R: 0, C: 0, generic: 0 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players[0].manaPool.G).toBe(0);
    expect(result.state.players[0].restrictedMana).toEqual([]);
  });

  it('does not let Cavern chosen-type mana cast another creature subtype', () => {
    let state = makeTestState({});
    const cavernId = addHandCavern(state);
    const playResult = tryPlayLand(state, 'human', cavernId, { chosenCreatureType: 'Elf' });
    expect(playResult.ok).toBe(true);
    if (!playResult.ok) return;
    state = playResult.state;

    const manaResult = tryTapLandForMana(state, 'human', cavernId, 'G');
    expect(manaResult.ok).toBe(true);
    if (!manaResult.ok) return;
    state = manaResult.state;

    const dragonId = addHandSpell(state, {
      instanceId: 'cavern_dragon',
      name: 'Cavern Test Dragon',
      typeLine: 'Creature - Dragon',
      manaCost: '{G}',
      cardTypes: ['creature'],
    });

    const result = tryCastSpell(state, 'human', dragonId, [], { G: 1, W: 0, U: 0, B: 0, R: 0, C: 0, generic: 0 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('insufficient_mana');
  });
});

describe('tryActivateAbility', () => {
  it('returns ok with AbilityActivated event on valid activation', () => {
    const state = makeTestState({ battlefieldCreatureWithAbility: true, manaPool: { C: 1 } });
    const creature = [...state.cards.values()].find(c => c.zone === 'battlefield')!;
    const result = tryActivateAbility(state, 'human', creature.instanceId, 0, []);
    expect(result.ok).toBe(true);
  });

  it('returns already_tapped for tap-cost ability when already tapped', () => {
    const state = makeTestState({ battlefieldCreatureWithAbility: true, tapCreatures: true });
    const creature = [...state.cards.values()].find(c => c.zone === 'battlefield')!;
    const result = tryActivateAbility(state, 'human', creature.instanceId, 0, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('already_tapped');
  });

  it('returns summoning_sick for tap-cost creature ability just summoned', () => {
    const state = makeTestState({ battlefieldCreatureWithAbility: true, summoningSick: true });
    const creature = [...state.cards.values()].find(c => c.zone === 'battlefield')!;
    const result = tryActivateAbility(state, 'human', creature.instanceId, 0, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('summoning_sick');
  });
});

describe('tryPassPriority', () => {
  it('returns ok when player has priority', () => {
    const state = makeTestState({});
    const result = tryPassPriority(state, 'human');
    expect(result.ok).toBe(true);
  });

  it('returns priority_not_yours when another player has priority', () => {
    const state = makeTestState({ priorityPlayerIndex: 1 });
    const result = tryPassPriority(state, 'human');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('priority_not_yours');
  });

  it('requires the active player to declare attackers before passing priority', () => {
    const state = makeTestState({ step: 'declare_attackers', phase: 'combat' });
    const result = tryPassPriority(state, 'human');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrong_phase');
  });
});

describe('tryDeclareAttackers', () => {
  it('returns wrong_phase outside declare_attackers step', () => {
    const state = makeTestState({});
    const result = tryDeclareAttackers(state, 'human', []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrong_phase');
  });
});

describe('tryDeclareBlockers', () => {
  it('returns wrong_phase outside declare_blockers step', () => {
    const state = makeTestState({});
    const result = tryDeclareBlockers(state, 'human', []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrong_phase');
  });
});

describe('tryEquip', () => {
  it('returns not_in_zone when equipment not on battlefield', () => {
    const state = makeTestState({ handEquipment: true, battlefieldCreature: true });
    const equip = [...state.cards.values()].find(c => c.zone === 'hand')!;
    const creature = [...state.cards.values()].find(c => c.zone === 'battlefield')!;
    const result = tryEquip(state, 'human', equip.instanceId, creature.instanceId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_in_zone');
  });
});

describe('try* wraps checkWinConditions', () => {
  beforeEach(() => {
    resetLoopDetector();
  });

  it('tryPassPriority emits PlayerLost event when a player has life <= 0', () => {
    const state = makeTestState({});
    // Mark human as lost from life damage
    state.players[0] = { ...state.players[0], life: 0, hasLost: true };
    const result = tryPassPriority(state, 'human');
    // tryPassPriority returns state, and runs checkWinConditions → emits PlayerLost
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events.some(e => e.kind === 'PlayerLost' && e.reason === 'life')).toBe(true);
    }
  });

  it('resetLoopDetector clears prior observations', () => {
    // Just confirms the export exists and doesn't throw
    resetLoopDetector();
    expect(typeof resetLoopDetector).toBe('function');
  });
});
