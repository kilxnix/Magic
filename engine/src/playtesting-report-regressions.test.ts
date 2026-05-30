import { describe, expect, it } from 'vitest';
import { declareAttackers, declareBlockers, resolveCombatDamage } from './combat';
import { getCardsInZone, initGameState } from './game-state';
import { castSpell, checkTriggersForEvent, putTriggersOnStack, registerBattlefieldAbilities, resolveTopOfStack } from './stack';
import { cleanupDamage } from './state-based';
import { instanceHasKeyword } from './keywords';
import type { CardDefinition, GameState, Zone } from './types';
import { executeEffects } from './effects/executor';
import { getEffectivePower, registerContinuousEffect } from './effects/continuous';
import { getOverride } from './effects/overrides';
import { parseOracleText } from './effects/parser';
import type { Effect } from './effects/ast';

function card(
  id: string,
  name: string,
  typeLine: string,
  manaCost: string,
  cardTypes: CardDefinition['card_types'],
  oracleText = '',
  power?: number,
  toughness?: number,
): CardDefinition {
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: oracleText,
    mana_cost: manaCost,
    cmc: (manaCost.match(/\{[^}]+\}/g) || []).length,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: cardTypes,
    power,
    toughness,
  };
}

function creature(id: string, name = id, oracleText = '', power = 2, toughness = 2): CardDefinition {
  return card(id, name, 'Creature - Test', '{1}{G}', ['creature'], oracleText, power, toughness);
}

function moveFirstNamed(state: GameState, name: string, zone: Zone, summoningSick = false): GameState {
  const entry = [...state.cards.entries()].find(([, instance]) =>
    state.cardDefinitions.get(instance.definitionId)?.name === name
  );
  if (!entry) throw new Error(`Could not find ${name}`);

  const [id, instance] = entry;
  const cards = new Map(state.cards);
  cards.set(id, {
    ...instance,
    zone,
    summoningSick,
  });
  return { ...state, cards };
}

function moveAllToBattlefieldReady(state: GameState): GameState {
  const cards = new Map(state.cards);
  for (const [id, instance] of cards) {
    cards.set(id, {
      ...instance,
      zone: 'battlefield',
      tapped: false,
      summoningSick: false,
    });
  }
  return {
    ...state,
    cards,
    phase: 'combat',
    step: 'declare_attackers',
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
  };
}

function zonesByName(state: GameState): Record<string, Zone> {
  const zones: Record<string, Zone> = {};
  for (const instance of state.cards.values()) {
    const def = state.cardDefinitions.get(instance.definitionId);
    if (def) zones[def.name] = instance.zone;
  }
  return zones;
}

function libraryNames(state: GameState, playerId = 'p1'): string[] {
  return getCardsInZone(state, playerId, 'library').map(instance =>
    state.cardDefinitions.get(instance.definitionId)?.name || instance.definitionId
  );
}

describe('playtesting report regressions', () => {
  it('stops Tainted Pact at the configured Oracle line instead of exiling through the library', () => {
    const override = getOverride('tainted-pact', 'Tainted Pact');
    expect(override?.kind).toBe('Spell');
    if (!override || override.kind !== 'Spell') return;

    const state = initGameState([
      {
        playerId: 'p1',
        name: 'Pilot',
        commanderId: 'none',
        cards: [
          card('filler-1', 'Lotus Petal', 'Artifact', '{0}', ['artifact']),
          card('filler-2', 'Brainstorm', 'Instant', '{U}', ['instant']),
          card('oracle', "Thassa's Oracle", 'Creature - Merfolk Wizard', '{U}{U}', ['creature'], '', 1, 3),
          card('filler-3', 'Dark Ritual', 'Instant', '{B}', ['instant']),
        ],
      },
    ]);

    const next = executeEffects(state, override.effects, 'p1', [], [], 0, {
      namedCardChoices: { namedCard: "Thassa's Oracle" },
    });
    const zones = zonesByName(next);

    expect(zones['Lotus Petal']).toBe('exile');
    expect(zones['Brainstorm']).toBe('exile');
    expect(zones["Thassa's Oracle"]).toBe('hand');
    expect(zones['Dark Ritual']).toBe('library');
  });

  it('uses the live named-card choice for Tainted Pact instead of an Oracle shortcut', () => {
    const override = getOverride('tainted-pact', 'Tainted Pact');
    expect(override?.kind).toBe('Spell');
    if (!override || override.kind !== 'Spell') return;

    const state = initGameState([
      {
        playerId: 'p1',
        name: 'Pilot',
        commanderId: 'none',
        cards: [
          card('filler-1', 'Lotus Petal', 'Artifact', '{0}', ['artifact']),
          card('filler-2', 'Brainstorm', 'Instant', '{U}', ['instant']),
          card('oracle', "Thassa's Oracle", 'Creature - Merfolk Wizard', '{U}{U}', ['creature'], '', 1, 3),
          card('ritual', 'Dark Ritual', 'Instant', '{B}', ['instant']),
        ],
      },
    ]);

    const next = executeEffects(state, override.effects, 'p1', [], [], 0, {
      namedCardChoices: { namedCard: 'Dark Ritual' },
    });
    const zones = zonesByName(next);

    expect(zones['Lotus Petal']).toBe('exile');
    expect(zones['Brainstorm']).toBe('exile');
    expect(zones["Thassa's Oracle"]).toBe('exile');
    expect(zones['Dark Ritual']).toBe('hand');
  });

  it('exiles Demonic Consultation initial six cards before finding the named Oracle line', () => {
    const override = getOverride('demonic-consultation', 'Demonic Consultation');
    expect(override?.kind).toBe('Spell');
    if (!override || override.kind !== 'Spell') return;

    const cards = Array.from({ length: 6 }, (_, index) =>
      card(`burn-${index}`, `Burn ${index}`, 'Instant', '{R}', ['instant'])
    );
    cards.push(card('oracle', "Thassa's Oracle", 'Creature - Merfolk Wizard', '{U}{U}', ['creature'], '', 1, 3));
    cards.push(card('after', 'After Card', 'Instant', '{U}', ['instant']));

    const state = initGameState([{ playerId: 'p1', name: 'Pilot', commanderId: 'none', cards }]);
    const next = executeEffects(state, override.effects, 'p1', [], [], 0, {
      namedCardChoices: { namedCard: "Thassa's Oracle" },
    });
    const zones = zonesByName(next);

    for (let i = 0; i < 6; i++) {
      expect(zones[`Burn ${i}`]).toBe('exile');
    }
    expect(zones["Thassa's Oracle"]).toBe('hand');
    expect(zones['After Card']).toBe('library');
  });

  it('carries named-card choices from cast action through stack resolution', () => {
    const pact = card('pact', 'Tainted Pact', 'Instant', '{1}{B}', ['instant']);
    const ritual = card('ritual', 'Dark Ritual', 'Instant', '{B}', ['instant']);
    const oracle = card('oracle', "Thassa's Oracle", 'Creature - Merfolk Wizard', '{U}{U}', ['creature'], '', 1, 3);

    let state = initGameState([
      { playerId: 'p1', name: 'Pilot', commanderId: 'none', cards: [pact, oracle, ritual] },
    ]);
    state = moveFirstNamed(state, 'Tainted Pact', 'hand');
    state = {
      ...state,
      players: state.players.map(player =>
        player.id === 'p1'
          ? { ...player, manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 1 } }
          : player,
      ),
    };

    const pactInstance = getCardsInZone(state, 'p1', 'hand')[0];
    state = castSpell(state, 'p1', pactInstance.instanceId, [], {
      namedCardChoices: { namedCard: 'Dark Ritual' },
    });
    state = resolveTopOfStack(state);
    const zones = zonesByName(state);

    expect(zones["Thassa's Oracle"]).toBe('exile');
    expect(zones['Dark Ritual']).toBe('hand');
  });

  it('uses tutor choices to move the selected library card instead of drawing the first card', () => {
    const override = getOverride('demonic-tutor', 'Demonic Tutor');
    expect(override?.kind).toBe('Spell');
    if (!override || override.kind !== 'Spell') return;

    const state = initGameState([
      {
        playerId: 'p1',
        name: 'Pilot',
        commanderId: 'none',
        cards: [
          card('first', 'Forest', 'Basic Land - Forest', '', ['land']),
          card('target', 'Worldly Tutor Target', 'Creature - Elf', '{G}', ['creature'], '', 1, 1),
          card('after', 'After Card', 'Instant', '{U}', ['instant']),
        ],
      },
    ]);

    const next = executeEffects(state, override.effects, 'p1', [], [], 0, {
      namedCardChoices: { tutorCard: 'Worldly Tutor Target' },
    });
    const zones = zonesByName(next);

    expect(zones['Forest']).toBe('library');
    expect(zones['Worldly Tutor Target']).toBe('hand');
    expect(zones['After Card']).toBe('library');
  });

  it.each([
    {
      overrideId: 'worldly-tutor',
      name: 'Worldly Tutor',
      target: card('creature-target', 'Worldly Tutor Target', 'Creature - Elf', '{G}', ['creature'], '', 1, 1),
    },
    {
      overrideId: 'mystical-tutor',
      name: 'Mystical Tutor',
      target: card('instant-target', 'Mystical Tutor Target', 'Instant', '{U}', ['instant']),
    },
    {
      overrideId: 'enlightened-tutor',
      name: 'Enlightened Tutor',
      target: card('artifact-target', 'Enlightened Tutor Target', 'Artifact', '{1}', ['artifact']),
    },
  ])('$name puts the chosen card on top of the library instead of into hand', ({ overrideId, name, target }) => {
    const override = getOverride(overrideId, name);
    expect(override?.kind).toBe('Spell');
    if (!override || override.kind !== 'Spell') return;

    const state = initGameState([
      {
        playerId: 'p1',
        name: 'Pilot',
        commanderId: 'none',
        cards: [
          card('first', 'First Library Card', 'Basic Land - Forest', '', ['land']),
          target,
          card('after', 'After Card', 'Instant', '{U}', ['instant']),
        ],
      },
    ]);

    const next = executeEffects(state, override.effects, 'p1', [], [], 0, {
      namedCardChoices: { tutorCard: target.name },
    });
    const zones = zonesByName(next);

    expect(zones[target.name]).toBe('library');
    expect(getCardsInZone(next, 'p1', 'hand')).toHaveLength(0);
    expect(libraryNames(next)[0]).toBe(target.name);
  });

  it.each([
    { overrideId: 'vampiric-tutor', name: 'Vampiric Tutor' },
    { overrideId: 'imperial-seal', name: 'Imperial Seal' },
  ])('$name puts any chosen card on top and still charges two life', ({ overrideId, name }) => {
    const override = getOverride(overrideId, name);
    expect(override?.kind).toBe('Spell');
    if (!override || override.kind !== 'Spell') return;

    const state = initGameState([
      {
        playerId: 'p1',
        name: 'Pilot',
        commanderId: 'none',
        cards: [
          card('first', 'First Library Card', 'Basic Land - Forest', '', ['land']),
          card('target', 'Top Tutor Target', 'Sorcery', '{B}', ['sorcery']),
          card('after', 'After Card', 'Instant', '{U}', ['instant']),
        ],
      },
    ]);

    const next = executeEffects(state, override.effects, 'p1', [], [], 0, {
      namedCardChoices: { tutorCard: 'Top Tutor Target' },
    });

    expect(next.players[0].life).toBe(38);
    expect(libraryNames(next)[0]).toBe('Top Tutor Target');
    expect(getCardsInZone(next, 'p1', 'hand')).toHaveLength(0);
  });

  it('Wheel of Fortune discards every player hand before each player draws seven', () => {
    const override = getOverride('wheel-of-fortune', 'Wheel of Fortune');
    expect(override?.kind).toBe('Spell');
    if (!override || override.kind !== 'Spell') return;

    const p1Hand = [
      card('p1-hand-1', 'Pilot Hand 1', 'Instant', '{U}', ['instant']),
      card('p1-hand-2', 'Pilot Hand 2', 'Instant', '{U}', ['instant']),
      card('p1-hand-3', 'Pilot Hand 3', 'Instant', '{U}', ['instant']),
    ];
    const p2Hand = [
      card('p2-hand-1', 'Opponent Hand 1', 'Instant', '{B}', ['instant']),
      card('p2-hand-2', 'Opponent Hand 2', 'Instant', '{B}', ['instant']),
    ];
    const p1Library = Array.from({ length: 8 }, (_, index) =>
      card(`p1-library-${index}`, `Pilot Draw ${index}`, 'Sorcery', '{1}{U}', ['sorcery'])
    );
    const p2Library = Array.from({ length: 8 }, (_, index) =>
      card(`p2-library-${index}`, `Opponent Draw ${index}`, 'Sorcery', '{1}{B}', ['sorcery'])
    );

    let state = initGameState([
      { playerId: 'p1', name: 'Pilot', commanderId: 'none', cards: [...p1Hand, ...p1Library] },
      { playerId: 'p2', name: 'Opponent', commanderId: 'none', cards: [...p2Hand, ...p2Library] },
    ]);

    const cards = new Map(state.cards);
    for (const [instanceId, instance] of cards) {
      const name = state.cardDefinitions.get(instance.definitionId)?.name || '';
      cards.set(instanceId, {
        ...instance,
        zone: /Hand/.test(name) ? 'hand' : 'library',
      });
    }
    state = { ...state, cards };

    const next = executeEffects(state, override.effects, 'p1', [], [], 0);

    expect(getCardsInZone(next, 'p1', 'hand')).toHaveLength(7);
    expect(getCardsInZone(next, 'p2', 'hand')).toHaveLength(7);
    expect(getCardsInZone(next, 'p1', 'graveyard').map(instance =>
      next.cardDefinitions.get(instance.definitionId)?.name
    )).toEqual(expect.arrayContaining(['Pilot Hand 1', 'Pilot Hand 2', 'Pilot Hand 3']));
    expect(getCardsInZone(next, 'p2', 'graveyard').map(instance =>
      next.cardDefinitions.get(instance.definitionId)?.name
    )).toEqual(expect.arrayContaining(['Opponent Hand 1', 'Opponent Hand 2']));
  });

  it('uses attacked-this-turn state for Chart a Course discard condition', () => {
    const chart = card('chart', 'Chart a Course', 'Sorcery', '{1}{U}', ['sorcery']);
    const keep = card('keep', 'Kept Card', 'Instant', '{U}', ['instant']);
    const drawA = card('draw-a', 'Drawn Card A', 'Instant', '{U}', ['instant']);
    const drawB = card('draw-b', 'Drawn Card B', 'Instant', '{U}', ['instant']);
    const attacker = creature('attacker', 'Practice Attacker');
    const p2Land = card('p2-land', 'Opponent Land', 'Basic Land', '', ['land']);

    let noAttack = initGameState([
      { playerId: 'p1', name: 'Pilot', commanderId: 'none', cards: [chart, keep, drawA, drawB] },
      { playerId: 'p2', name: 'Opponent', commanderId: 'none-2', cards: [p2Land] },
    ]);
    noAttack = moveFirstNamed(moveFirstNamed(noAttack, 'Chart a Course', 'hand'), 'Kept Card', 'hand');
    noAttack.players[0].manaPool = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 1 };
    noAttack = { ...noAttack, activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'draw' };
    const noAttackChart = getCardsInZone(noAttack, 'p1', 'hand')
      .find(instance => noAttack.cardDefinitions.get(instance.definitionId)?.name === 'Chart a Course')!;

    noAttack = resolveTopOfStack(castSpell(noAttack, 'p1', noAttackChart.instanceId));
    expect(getCardsInZone(noAttack, 'p1', 'hand')).toHaveLength(2);

    let attacked = initGameState([
      { playerId: 'p1', name: 'Pilot', commanderId: 'none', cards: [chart, keep, drawA, drawB, attacker] },
      { playerId: 'p2', name: 'Opponent', commanderId: 'none-2', cards: [p2Land] },
    ]);
    attacked = moveFirstNamed(moveFirstNamed(attacked, 'Chart a Course', 'hand'), 'Kept Card', 'hand');
    attacked = moveFirstNamed(attacked, 'Practice Attacker', 'battlefield', false);
    attacked = { ...attacked, activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'combat', step: 'declare_attackers' };
    const attackerId = getCardsInZone(attacked, 'p1', 'battlefield')
      .find(instance => attacked.cardDefinitions.get(instance.definitionId)?.name === 'Practice Attacker')!.instanceId;
    attacked = declareAttackers(attacked, 'p1', [{ cardInstanceId: attackerId, defendingPlayerId: 'p2' }]);
    expect(attacked.playersWhoAttackedThisTurn).toContain('p1');

    attacked.players[0].manaPool = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 1 };
    attacked = { ...attacked, phase: 'postcombat_main', step: 'end_of_combat', priorityPlayerIndex: 0, stack: [] };
    const attackedChart = getCardsInZone(attacked, 'p1', 'hand')
      .find(instance => attacked.cardDefinitions.get(instance.definitionId)?.name === 'Chart a Course')!;

    attacked = resolveTopOfStack(castSpell(attacked, 'p1', attackedChart.instanceId));
    expect(getCardsInZone(attacked, 'p1', 'hand')).toHaveLength(3);
  });

  it('parses Dragonhawk enters-or-attacks as a power-counted exile trigger', () => {
    const oracle = "Whenever ~ enters or attacks, exile the top X cards of your library, where X is the number of creatures you control with power 4 or greater. You may play those cards until your next end step. At the beginning of your next end step, ~ deals 2 damage to each opponent for each of those cards that are still exiled.";
    const parsed = parseOracleText(oracle);

    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;
    expect(parsed.ability.effects[0]).toMatchObject({
      kind: 'ExileFromLibrary',
      count: {
        kind: 'ForEach',
        zone: 'battlefield',
        filter: { types: ['creature'], power: { op: 'gte', value: 4 } },
        controller: 'you',
      },
      mayPlay: true,
      delayedDamageEachOpponentPerCard: 2,
    });
  });

  it('Dragonhawk exiles one card per creature you control with power 4 or greater when it enters', () => {
    const dragonhawk = creature(
      'dragonhawk',
      "Dragonhawk, Fate's Tempest",
      "Flying\nWhenever Dragonhawk, Fate's Tempest enters or attacks, exile the top X cards of your library, where X is the number of creatures you control with power 4 or greater. You may play those cards until your next end step. At the beginning of your next end step, Dragonhawk deals 2 damage to each opponent for each of those cards that are still exiled.",
      5,
      5,
    );
    dragonhawk.mana_cost = '{3}{R}{R}';
    dragonhawk.colors = ['R'];
    dragonhawk.color_identity = ['R'];

    let state = initGameState([
      {
        playerId: 'p1',
        name: 'Pilot',
        commanderId: 'none',
        cards: [
          dragonhawk,
          creature('big', 'Big Creature', '', 4, 4),
          creature('small', 'Small Creature', '', 3, 3),
          card('top-1', 'Top One', 'Sorcery', '{R}', ['sorcery']),
          card('top-2', 'Top Two', 'Sorcery', '{R}', ['sorcery']),
          card('top-3', 'Top Three', 'Sorcery', '{R}', ['sorcery']),
        ],
      },
      {
        playerId: 'p2',
        name: 'Opponent',
        commanderId: 'none',
        cards: [creature('opp', 'Opponent Creature')],
      },
    ]);

    state = moveFirstNamed(state, 'Big Creature', 'battlefield', false);
    state = moveFirstNamed(state, 'Small Creature', 'battlefield', false);
    state = moveFirstNamed(state, "Dragonhawk, Fate's Tempest", 'hand', false);
    const dragonhawkInstance = getCardsInZone(state, 'p1', 'hand')[0];
    state = {
      ...state,
      phase: 'precombat_main',
      priorityPlayerIndex: 0,
      players: state.players.map((player, index) =>
        index === 0 ? { ...player, manaPool: { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 } } : player,
      ),
    };

    state = castSpell(state, 'p1', dragonhawkInstance.instanceId);
    state = resolveTopOfStack(state);
    const dragonhawkOnBattlefield = getCardsInZone(state, 'p1', 'battlefield')
      .find(instance => state.cardDefinitions.get(instance.definitionId)?.name === "Dragonhawk, Fate's Tempest");
    expect(dragonhawkOnBattlefield).toBeDefined();
    expect(state.battlefieldAbilities.get(dragonhawkOnBattlefield!.instanceId)?.some(ability => ability.trigger.kind === 'Attacks')).toBe(true);

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    const zones = zonesByName(state);

    expect(zones['Top One']).toBe('exile');
    expect(zones['Top Two']).toBe('exile');
    expect(zones['Top Three']).toBe('library');
    expect(state.delayedTriggers?.length).toBe(1);

    state = {
      ...state,
      phase: 'ending',
      step: 'end',
      activePlayerIndex: 0,
    };
    state = checkTriggersForEvent(state, { kind: 'EndStepStart', activePlayerId: 'p1' });
    expect(state.delayedTriggers?.length).toBe(0);
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    expect(state.players.find(player => player.id === 'p2')?.life).toBe(36);
  });

  it('creates tokens for the active opponent from each-opponent end step triggers', () => {
    const spymaster = creature(
      'goblin-spymaster',
      'Goblin Spymaster',
      'First strike\nAt the beginning of each opponent\'s end step, that player creates a 1/1 red Goblin creature token with "This creature can\'t block."',
      2,
      1,
    );

    let state = initGameState([
      { playerId: 'p1', name: 'Controller', commanderId: 'none', cards: [spymaster] },
      { playerId: 'p2', name: 'Opponent', commanderId: 'none', cards: [] },
    ]);

    state = moveFirstNamed(state, 'Goblin Spymaster', 'battlefield', false);
    const spymasterInstance = getCardsInZone(state, 'p1', 'battlefield')
      .find(instance => state.cardDefinitions.get(instance.definitionId)?.name === 'Goblin Spymaster');
    expect(spymasterInstance).toBeDefined();
    state = registerBattlefieldAbilities(state, spymasterInstance!.instanceId);

    state = {
      ...state,
      phase: 'ending',
      step: 'end',
      activePlayerIndex: 1,
      priorityPlayerIndex: 1,
    };

    state = checkTriggersForEvent(state, { kind: 'EndStepStart', activePlayerId: 'p2' });
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    const goblinToken = getCardsInZone(state, 'p2', 'battlefield').find(instance => instance.isToken);
    expect(goblinToken).toBeDefined();
    const tokenDef = state.cardDefinitions.get(goblinToken!.definitionId);
    expect(tokenDef?.name).toBe('Goblin');
    expect(tokenDef?.colors).toEqual(['R']);
    expect(tokenDef?.card_types).toContain('creature');
    expect(tokenDef?.type_line.toLowerCase()).toContain('goblin');
  });

  it('removes triggered and continuous effects when their source is bounced', () => {
    const rhystic = card(
      'rhystic',
      'Rhystic Study',
      'Enchantment',
      '{2}{U}',
      ['enchantment'],
      'Whenever an opponent casts a spell, draw a card.',
    );
    const anthem = card('anthem', 'Glorious Anthem', 'Enchantment', '{1}{W}{W}', ['enchantment']);
    const bear = creature('bear', 'Bear');

    let state = initGameState([
      { playerId: 'p1', name: 'Alice', commanderId: 'none', cards: [rhystic, anthem, bear] },
      { playerId: 'p2', name: 'Bob', commanderId: 'none', cards: [] },
    ]);
    state = moveFirstNamed(state, 'Rhystic Study', 'battlefield');
    state = moveFirstNamed(state, 'Glorious Anthem', 'battlefield');
    state = moveFirstNamed(state, 'Bear', 'battlefield');
    state = registerBattlefieldAbilities(state, getCardsInZone(state, 'p1', 'battlefield').find(instance =>
      state.cardDefinitions.get(instance.definitionId)?.name === 'Rhystic Study'
    )!.instanceId);

    const anthemInstance = getCardsInZone(state, 'p1', 'battlefield').find(instance =>
      state.cardDefinitions.get(instance.definitionId)?.name === 'Glorious Anthem'
    )!;
    state = registerContinuousEffect(state, anthemInstance.instanceId, 'p1', {
      kind: 'StaticAbility',
      modifier: { kind: 'ModifyPT', power: 1, toughness: 1 },
      filter: { types: ['creature'] },
      controller: 'you',
      excludeSelf: false,
    });

    expect(state.battlefieldAbilities.size).toBe(1);
    expect(state.continuousEffects).toHaveLength(1);

    const effects: Effect[] = [
      { kind: 'ReturnToHand', target: { kind: 'AllOfType', filter: { types: ['enchantment'] } } },
    ];
    const bounced = executeEffects(state, effects, 'p1', [], []);

    expect(bounced.battlefieldAbilities.size).toBe(0);
    expect(bounced.continuousEffects).toHaveLength(0);

    const afterOpponentSpell = checkTriggersForEvent(bounced, {
      kind: 'SpellCast',
      casterId: 'p2',
      cardInstanceId: 'spell-on-stack',
    });
    expect(afterOpponentSpell.pendingTriggers).toHaveLength(0);
  });

  it('parses swarm attack and combat-damage-to-player triggers', () => {
    const attack = parseOracleText('Whenever a creature you control attacks, draw a card.');
    expect(attack.kind).toBe('Triggered');
    if (attack.kind === 'Triggered') {
      expect(attack.ability.trigger).toEqual({ kind: 'CreatureYouControlAttacks' });
    }

    const teamDamage = parseOracleText('Whenever a creature you control deals combat damage to a player, draw a card.');
    expect(teamDamage.kind).toBe('Triggered');
    if (teamDamage.kind === 'Triggered') {
      expect(teamDamage.ability.trigger).toEqual({ kind: 'CombatDamageToPlayer', who: 'creatureYouControl' });
    }

    const selfDamage = parseOracleText('Whenever ~ deals combat damage to a player, draw a card.');
    expect(selfDamage.kind).toBe('Triggered');
    if (selfDamage.kind === 'Triggered') {
      expect(selfDamage.ability.trigger).toEqual({ kind: 'CombatDamageToPlayer', who: 'self' });
    }
  });

  it('creates one attack trigger per attacking creature in a swarm', () => {
    const raidLeader = creature(
      'raid-leader',
      'Raid Leader',
      'Whenever a creature you control attacks, draw a card.',
    );
    const attackers = Array.from({ length: 8 }, (_, index) => creature(`attacker-${index}`, `Attacker ${index}`));

    let state = initGameState([
      { playerId: 'p1', name: 'Alice', commanderId: 'none', cards: [raidLeader, ...attackers] },
      { playerId: 'p2', name: 'Bob', commanderId: 'none', cards: [] },
    ]);
    state = moveAllToBattlefieldReady(state);
    const source = getCardsInZone(state, 'p1', 'battlefield').find(instance =>
      state.cardDefinitions.get(instance.definitionId)?.name === 'Raid Leader'
    )!;
    state = registerBattlefieldAbilities(state, source.instanceId);

    const attackDeclarations = getCardsInZone(state, 'p1', 'battlefield')
      .filter(instance => state.cardDefinitions.get(instance.definitionId)?.name.startsWith('Attacker '))
      .map(instance => ({ cardInstanceId: instance.instanceId, defendingPlayerId: 'p2' }));

    state = declareAttackers(state, 'p1', attackDeclarations);

    expect(state.pendingTriggers).toHaveLength(8);
    expect(state.pendingTriggers.every(trigger => trigger.sourceInstanceId === source.instanceId)).toBe(true);
  });

  it('fires combat damage triggers only for creatures that actually connect', () => {
    const reconnaissance = card(
      'reconnaissance',
      'Reconnaissance Mission',
      'Enchantment',
      '{2}{U}{U}',
      ['enchantment'],
      'Whenever a creature you control deals combat damage to a player, draw a card.',
    );
    const unblocked = creature('unblocked', 'Unblocked');
    const blocked = creature('blocked', 'Blocked');
    const blocker = creature('blocker', 'Blocker', '', 1, 4);

    let state = initGameState([
      { playerId: 'p1', name: 'Alice', commanderId: 'none', cards: [reconnaissance, unblocked, blocked] },
      { playerId: 'p2', name: 'Bob', commanderId: 'none', cards: [blocker] },
    ]);
    state = moveAllToBattlefieldReady(state);
    const source = getCardsInZone(state, 'p1', 'battlefield').find(instance =>
      state.cardDefinitions.get(instance.definitionId)?.name === 'Reconnaissance Mission'
    )!;
    state = registerBattlefieldAbilities(state, source.instanceId);

    const p1Creatures = getCardsInZone(state, 'p1', 'battlefield').filter(instance =>
      state.cardDefinitions.get(instance.definitionId)?.card_types.includes('creature')
    );
    const unblockedInstance = p1Creatures.find(instance =>
      state.cardDefinitions.get(instance.definitionId)?.name === 'Unblocked'
    )!;
    const blockedInstance = p1Creatures.find(instance =>
      state.cardDefinitions.get(instance.definitionId)?.name === 'Blocked'
    )!;
    const blockerInstance = getCardsInZone(state, 'p2', 'battlefield')[0];

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: unblockedInstance.instanceId, defendingPlayerId: 'p2' },
      { cardInstanceId: blockedInstance.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = declareBlockers(state, 'p2', [
      { cardInstanceId: blockerInstance.instanceId, blockingAttackerId: blockedInstance.instanceId },
    ]);
    state = resolveCombatDamage(state);

    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0].eventContext?.cardInstanceId).toBe(unblockedInstance.instanceId);
  });

  it('keeps until-end-of-turn buffs through combat and removes them at cleanup', () => {
    const bear = creature('bear', 'Bear', '', 2, 2);
    let state = initGameState([{ playerId: 'p1', name: 'Alice', commanderId: 'none', cards: [bear] }]);
    state = moveFirstNamed(state, 'Bear', 'battlefield');
    const bearInstance = getCardsInZone(state, 'p1', 'battlefield')[0];

    state = executeEffects(state, [
      { kind: 'ModifyPT', target: { kind: 'Chosen', targetId: 'target' }, power: 2, toughness: 2, untilEndOfTurn: true },
      { kind: 'GrantKeyword', target: { kind: 'Chosen', targetId: 'target' }, keyword: 'Trample', untilEndOfTurn: true },
    ], 'p1', [bearInstance.instanceId], [{ id: 'target' }]);

    expect(getEffectivePower(state, bearInstance.instanceId)).toBe(4);
    expect(instanceHasKeyword(state, bearInstance.instanceId, 'Trample')).toBe(true);

    state = { ...state, step: 'end_of_combat' };
    expect(getEffectivePower(state, bearInstance.instanceId)).toBe(4);
    expect(instanceHasKeyword(state, bearInstance.instanceId, 'Trample')).toBe(true);

    state = cleanupDamage({ ...state, step: 'cleanup' });
    expect(getEffectivePower(state, bearInstance.instanceId)).toBe(2);
    expect(instanceHasKeyword(state, bearInstance.instanceId, 'Trample')).toBe(false);
    expect(state.cards.get(bearInstance.instanceId)?.counters['_powerMod']).toBeUndefined();
  });

  it('casts Toxic Deluge with paid X life and applies -X/-X instead of destroying everything', () => {
    const toxic = card(
      'toxic-deluge',
      'Toxic Deluge',
      'Sorcery',
      '{2}{B}',
      ['sorcery'],
      'As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn.',
    );
    const small = creature('small-creature', 'Small Creature', '', 2, 2);
    const large = creature('large-creature', 'Large Creature', '', 5, 5);
    const opponentSmall = creature('opponent-small', 'Opponent Small', '', 3, 3);

    let state = initGameState([
      { playerId: 'p1', name: 'Alice', commanderId: 'none', cards: [toxic, small, large] },
      { playerId: 'p2', name: 'Bob', commanderId: 'none', cards: [opponentSmall] },
    ]);
    state = moveFirstNamed(state, 'Toxic Deluge', 'hand');
    state = moveFirstNamed(state, 'Small Creature', 'battlefield');
    state = moveFirstNamed(state, 'Large Creature', 'battlefield');
    state = moveFirstNamed(state, 'Opponent Small', 'battlefield');
    state = {
      ...state,
      phase: 'precombat_main',
      step: 'main',
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      players: state.players.map((player, index) =>
        index === 0
          ? { ...player, manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 2 } }
          : player
      ),
    };

    const toxicInstance = getCardsInZone(state, 'p1', 'hand').find(instance =>
      state.cardDefinitions.get(instance.definitionId)?.name === 'Toxic Deluge'
    )!;
    state = castSpell(state, 'p1', toxicInstance.instanceId, [], { xValue: 3 });

    expect(state.players[0].life).toBe(37);
    expect(state.stack[state.stack.length - 1]).toMatchObject({ xValue: 3 });

    state = resolveTopOfStack(state);

    expect(getCardsInZone(state, 'p1', 'graveyard').some(instance =>
      state.cardDefinitions.get(instance.definitionId)?.name === 'Small Creature'
    )).toBe(true);
    expect(getCardsInZone(state, 'p2', 'graveyard').some(instance =>
      state.cardDefinitions.get(instance.definitionId)?.name === 'Opponent Small'
    )).toBe(true);
    const survivingLarge = getCardsInZone(state, 'p1', 'battlefield').find(instance =>
      state.cardDefinitions.get(instance.definitionId)?.name === 'Large Creature'
    )!;
    expect(getEffectivePower(state, survivingLarge.instanceId)).toBe(2);

    state = cleanupDamage({ ...state, step: 'cleanup' });
    expect(getEffectivePower(state, survivingLarge.instanceId)).toBe(5);
  });
});
