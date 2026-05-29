import { describe, expect, it } from 'vitest';
import { getNewPlayerSuggestion } from '../src/lib/newPlayerSuggestions';
import type { SimpleCard, SimpleGameState, SimpleLegalAction } from '../src/hooks/useShelectorGame';

function card(overrides: Partial<SimpleCard> = {}): SimpleCard {
  return {
    instanceId: 'card-1',
    name: 'Forest',
    manaCost: '',
    typeLine: 'Basic Land - Forest',
    oracleText: '{T}: Add {G}.',
    tapped: false,
    zone: 'hand',
    ownerId: 'human',
    cardTypes: ['land'],
    isCommander: false,
    counters: {},
    isToken: false,
    ...overrides,
  };
}

function action(overrides: Partial<SimpleLegalAction>): SimpleLegalAction {
  const kind = overrides.kind ?? 'PassPriority';
  return {
    kind,
    label: overrides.label ?? kind,
    _engineAction: { kind } as SimpleLegalAction['_engineAction'],
    ...overrides,
  };
}

function state(overrides: Partial<SimpleGameState> = {}): SimpleGameState {
  return {
    turnNumber: 1,
    phase: 'precombat_main',
    step: 'main',
    activePlayerId: 'human',
    priorityPlayerId: 'human',
    humanPlayer: { id: 'human', name: 'You', life: 40, handCount: 1, libraryCount: 90 },
    humanCommander: 'Atraxa',
    humanHand: [],
    humanBattlefield: [],
    humanGraveyard: [],
    humanCommandZone: [],
    stack: [],
    gameOver: false,
    winnerId: null,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    aiPlayers: [],
    aiHands: {},
    aiBattlefields: {},
    aiGraveyards: {},
    aiCommandZones: {},
    aiCommanderNames: {},
    aiPlayer: { id: 'ai1', name: 'AI', life: 40, handCount: 7, libraryCount: 90 },
    aiCommander: 'Opponent',
    aiHand: [],
    aiBattlefield: [],
    aiGraveyard: [],
    aiCommandZone: [],
    ...overrides,
  };
}

describe('getNewPlayerSuggestion', () => {
  it('prioritizes playing a land during a main phase', () => {
    const forest = card();
    const suggestion = getNewPlayerSuggestion(
      state({ humanHand: [forest] }),
      [
        action({ kind: 'ActivateManaAbility', label: 'Tap Sol Ring' }),
        action({ kind: 'PlayLand', cardInstanceId: forest.instanceId, cardName: forest.name, label: 'Play Forest' }),
        action({ kind: 'PassPriority', label: 'End Phase' }),
      ],
    );

    expect(suggestion?.kind).toBe('land');
    expect(suggestion?.actionLabel).toBe('Forest');
  });

  it('suggests tapping mana when no spell is currently castable', () => {
    const suggestion = getNewPlayerSuggestion(
      state(),
      [
        action({ kind: 'ActivateManaAbility', label: 'Tap Forest for G' }),
        action({ kind: 'PassPriority', label: 'End Phase' }),
      ],
    );

    expect(suggestion?.kind).toBe('mana');
    expect(suggestion?.reason).toContain('Tap mana sources');
  });

  it('suggests casting a spell once it is legal', () => {
    const creature = card({
      instanceId: 'card-2',
      name: 'Llanowar Elves',
      manaCost: '{G}',
      typeLine: 'Creature - Elf Druid',
      oracleText: '{T}: Add {G}.',
      cardTypes: ['creature'],
    });
    const suggestion = getNewPlayerSuggestion(
      state({ humanHand: [creature] }),
      [
        action({ kind: 'CastSpell', cardInstanceId: creature.instanceId, cardName: creature.name, label: 'Cast Llanowar Elves' }),
        action({ kind: 'PassPriority', label: 'End Phase' }),
      ],
    );

    expect(suggestion?.kind).toBe('spell');
    expect(suggestion?.reason).toContain('develops your board');
  });

  it('does not recommend likely infinite-combo cards in guide mode', () => {
    const comboPiece = card({
      instanceId: 'combo-card',
      name: 'Loop Engine',
      manaCost: '{2}',
      typeLine: 'Artifact',
      oracleText: 'Repeat this process any number of times.',
      cardTypes: ['artifact'],
    });
    const suggestion = getNewPlayerSuggestion(
      state({ humanHand: [comboPiece] }),
      [
        action({ kind: 'CastSpell', cardInstanceId: comboPiece.instanceId, cardName: comboPiece.name, label: 'Cast Loop Engine' }),
        action({ kind: 'PassPriority', label: 'End Phase' }),
      ],
    );

    expect(suggestion?.kind).toBe('pass');
    expect(suggestion?.actionLabel).toBe('End Phase');
  });

  it('prioritizes instant and sorcery spells when an instant/sorcery payoff is on board', () => {
    const talrand = card({
      instanceId: 'talrand',
      name: 'Talrand, Sky Summoner',
      manaCost: '{2}{U}{U}',
      typeLine: 'Legendary Creature - Merfolk Wizard',
      oracleText: 'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.',
      zone: 'battlefield',
      cardTypes: ['creature'],
      isCommander: true,
    });
    const merfolk = card({
      instanceId: 'creature-spell',
      name: 'Coral Merfolk',
      manaCost: '{1}{U}',
      typeLine: 'Creature - Merfolk',
      oracleText: '',
      cardTypes: ['creature'],
    });
    const opt = card({
      instanceId: 'spell-card',
      name: 'Opt',
      manaCost: '{U}',
      typeLine: 'Instant',
      oracleText: 'Scry 1. Draw a card.',
      cardTypes: ['instant'],
    });

    const suggestion = getNewPlayerSuggestion(
      state({ humanBattlefield: [talrand], humanHand: [merfolk, opt] }),
      [
        action({ kind: 'CastSpell', cardInstanceId: merfolk.instanceId, cardName: merfolk.name, label: 'Cast Coral Merfolk' }),
        action({ kind: 'CastSpell', cardInstanceId: opt.instanceId, cardName: opt.name, label: 'Cast Opt' }),
        action({ kind: 'PassPriority', label: 'End Phase' }),
      ],
    );

    expect(suggestion?.kind).toBe('spell');
    expect(suggestion?.actionLabel).toBe('Opt');
    expect(suggestion?.reason).toContain('more cards');
  });

  it('prefers a response when the stack has an item', () => {
    const counter = card({
      instanceId: 'card-3',
      name: 'Counterspell',
      manaCost: '{U}{U}',
      typeLine: 'Instant',
      oracleText: 'Counter target spell.',
      cardTypes: ['instant'],
    });
    const suggestion = getNewPlayerSuggestion(
      state({ humanHand: [counter], stack: [{ id: 'stack-1', name: 'Wrath of God', casterId: 'ai1' }] }),
      [
        action({ kind: 'CastSpell', cardInstanceId: counter.instanceId, cardName: counter.name, label: 'Cast Counterspell' }),
        action({ kind: 'PassPriority', label: 'Pass' }),
      ],
    );

    expect(suggestion?.kind).toBe('response');
    expect(suggestion?.actionLabel).toBe('Counterspell');
  });

  it('falls back to passing when no stronger legal play exists', () => {
    const suggestion = getNewPlayerSuggestion(
      state(),
      [action({ kind: 'PassPriority', label: 'End Phase' })],
    );

    expect(suggestion?.kind).toBe('pass');
    expect(suggestion?.actionLabel).toBe('End Phase');
  });
});
