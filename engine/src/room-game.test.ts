import { describe, expect, it } from 'vitest';
import { initRoomGame, getPlayerView } from './room-game';
import { tryPassPriority, tryPlayLand } from './actions-public';
import { getCardsInZone } from './game-state';
import type { ScryfallCard } from './cards/deck-loader';

const cards: Record<string, ScryfallCard> = {
  Forest: {
    id: 'forest',
    name: 'Forest',
    type_line: 'Basic Land - Forest',
    oracle_text: '({T}: Add {G}.)',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
    keywords: [],
  },
  Island: {
    id: 'island',
    name: 'Island',
    type_line: 'Basic Land - Island',
    oracle_text: '({T}: Add {U}.)',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['U'],
    keywords: [],
  },
  'Goreclaw, Terror of Qal Sisma': {
    id: 'goreclaw',
    name: 'Goreclaw, Terror of Qal Sisma',
    type_line: 'Legendary Creature - Bear',
    oracle_text: 'Creature spells you cast with power 4 or greater cost {2} less to cast.',
    mana_cost: '{3}{G}',
    cmc: 4,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power: '4',
    toughness: '3',
  },
  'Leatherback Baloth': {
    id: 'leatherback-baloth',
    name: 'Leatherback Baloth',
    type_line: 'Creature - Beast',
    oracle_text: '',
    mana_cost: '{G}{G}{G}',
    cmc: 3,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power: '4',
    toughness: '5',
  },
  'Talrand, Sky Summoner': {
    id: 'talrand',
    name: 'Talrand, Sky Summoner',
    type_line: 'Legendary Creature - Merfolk Wizard',
    oracle_text: 'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.',
    mana_cost: '{2}{U}{U}',
    cmc: 4,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    power: '2',
    toughness: '2',
  },
};

function lookup(name: string) {
  return cards[name];
}

function roomGame() {
  return initRoomGame({
    players: [
      {
        id: 'p1',
        name: 'Duel Codex',
        deck: {
          id: 'p1-deck',
          commander: 'Goreclaw, Terror of Qal Sisma',
          list: ['Leatherback Baloth', 'Forest'],
          colors: ['G'],
          bracket: 2,
          theme: 'stompy',
        },
      },
      {
        id: 'p2',
        name: 'Grok',
        deck: {
          id: 'p2-deck',
          commander: 'Talrand, Sky Summoner',
          list: ['Island'],
          colors: ['U'],
          bracket: 2,
          theme: 'spells',
        },
      },
    ],
    cardLookup: lookup,
    firstPlayerId: 'p1',
  });
}

describe('room engine games', () => {
  it('creates a multiplayer game using room player ids', () => {
    const state = roomGame();

    expect(state.players.map(player => player.id)).toEqual(['p1', 'p2']);
    expect(state.players[0].hasPriority).toBe(true);
    expect(getCardsInZone(state, 'p1', 'hand')).toHaveLength(7);
    expect(getCardsInZone(state, 'p2', 'hand')).toHaveLength(7);
  });

  it('hides opponent hands in scoped views', () => {
    const state = roomGame();
    const p1View = getPlayerView(state, 'p1');
    const p2InP1View = p1View.players.find(player => player.id === 'p2')!;

    expect(p1View.players.find(player => player.id === 'p1')!.zones.hand.cards).toHaveLength(7);
    expect(p2InP1View.zones.hand.count).toBe(7);
    expect(p2InP1View.zones.hand.cards).toBeUndefined();
    expect(p2InP1View.zones.library.cards).toBeUndefined();
  });

  it('can apply a safe real action', () => {
    const state = roomGame();
    const result = tryPassPriority(state, 'p1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.priorityPlayerIndex).toBe(1);
    }
  });

  it('can play a real land once the game is in a main phase', () => {
    const state = { ...roomGame(), phase: 'precombat_main' as const };
    const land = getCardsInZone(state, 'p1', 'hand').find(card => card.definitionId === 'forest')!;
    const result = tryPlayLand(state, 'p1', land.instanceId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(getCardsInZone(result.state, 'p1', 'battlefield')).toHaveLength(1);
    }
  });

  it('shows main phase cleanly and advertises legal land plays in room views', () => {
    const state = { ...roomGame(), phase: 'precombat_main' as const, step: 'begin_combat' as const };
    const view = getPlayerView(state, 'p1');

    expect(view.step).toBe('main');
    expect(view.legalActions.find(action => action.action === 'Play Land')).toMatchObject({
      enabled: true,
      reason: 'Main phase, empty stack, land available.',
    });
  });

  it('does not advertise another land play after the turn land drop is used', () => {
    const state = { ...roomGame(), phase: 'precombat_main' as const };
    const land = getCardsInZone(state, 'p1', 'hand').find(card => card.definitionId === 'forest')!;
    const result = tryPlayLand(state, 'p1', land.instanceId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const view = getPlayerView(result.state, 'p1');
    expect(view.legalActions.find(action => action.action === 'Play Land')).toMatchObject({
      enabled: false,
      reason: 'No land plays remaining',
    });
  });

  it('does not advertise unpayable visible spells as castable', () => {
    const state = { ...roomGame(), phase: 'precombat_main' as const };
    const baloth = Array.from(state.cards.values()).find(card => card.definitionId === 'leatherback-baloth')!;
    baloth.zone = 'hand';
    const view = getPlayerView(state, 'p1');
    const handSpell = view.players
      .find(player => player.id === 'p1')!
      .zones.hand.cards!
      .find(card => card.name === 'Leatherback Baloth')!;

    expect(handSpell).toMatchObject({
      canCast: false,
      castReason: 'Insufficient mana in pool',
    });
    expect(view.legalActions.find(action => action.action === 'Cast From Hand')).toMatchObject({
      enabled: false,
      reason: 'No visible spell is currently legal and payable.',
    });
    expect(view.legalActions.find(action => action.action === 'Cast Commander')).toMatchObject({
      enabled: false,
      reason: 'Commander is not currently legal and payable.',
    });
  });

  it('explains stack items and available actions in scoped views', () => {
    const state = { ...roomGame(), phase: 'precombat_main' as const };
    const commander = getCardsInZone(state, 'p1', 'command')[0];
    state.stack = [{
      kind: 'Spell',
      id: 'stack_spell_1',
      cardInstanceId: commander.instanceId,
      casterId: 'p1',
      castFromZone: 'command',
      targets: ['p2'],
    }];

    const view = getPlayerView(state, 'p2');

    expect(view.stackSize).toBe(1);
    expect(view.stack[0]).toMatchObject({
      kind: 'Spell',
      label: 'Goreclaw, Terror of Qal Sisma',
      controllerName: 'Duel Codex',
      targetNames: ['Grok'],
      resolvesNext: true,
    });
    expect(view.stack[0].why).toContain('waiting for all players to pass priority');
    expect(view.legalActions.find(action => action.action === 'Pass Priority')).toMatchObject({
      enabled: false,
      reason: 'Waiting for Duel Codex to act.',
    });
  });

  it('groups pending triggers with why context before they hit the stack', () => {
    const state = roomGame();
    const source = getCardsInZone(state, 'p2', 'command')[0];
    const castCard = getCardsInZone(state, 'p1', 'command')[0];
    state.pendingTriggers = [
      {
        id: 'pending_1',
        sourceInstanceId: source.instanceId,
        controllerId: 'p2',
        ability: { kind: 'TriggeredAbility', trigger: { kind: 'OpponentCastSpell' }, effects: [] },
        requiredTargets: [],
        eventContext: { casterId: 'p1', cardInstanceId: castCard.instanceId },
      },
      {
        id: 'pending_2',
        sourceInstanceId: source.instanceId,
        controllerId: 'p2',
        ability: { kind: 'TriggeredAbility', trigger: { kind: 'OpponentCastSpell' }, effects: [] },
        requiredTargets: [],
        eventContext: { casterId: 'p1', cardInstanceId: castCard.instanceId },
      },
    ];

    const view = getPlayerView(state, 'p1');

    expect(view.pendingTriggerGroups).toHaveLength(1);
    expect(view.pendingTriggerGroups[0]).toMatchObject({
      sourceName: 'Talrand, Sky Summoner',
      controllerName: 'Grok',
      triggerKind: 'OpponentCastSpell',
      count: 2,
    });
    expect(view.pendingTriggerGroups[0].why).toContain('Duel Codex');
    expect(view.teachingNotes.some(note => note.includes('Triggers'))).toBe(true);
  });

  it('summarizes complex combat damage assignment for scoped room views', () => {
    const state = { ...roomGame(), phase: 'combat' as const, step: 'combat_damage' as const };
    const attacker = getCardsInZone(state, 'p1', 'command')[0];
    const blocker = getCardsInZone(state, 'p2', 'command')[0];
    attacker.zone = 'battlefield';
    attacker.summoningSick = false;
    attacker.grantedKeywords = ['Trample', 'Deathtouch'];
    blocker.zone = 'battlefield';
    blocker.summoningSick = false;
    state.combat = {
      attackers: [{ cardInstanceId: attacker.instanceId, defendingPlayerId: 'p2' }],
      blockers: [{ cardInstanceId: blocker.instanceId, blockingAttackerId: attacker.instanceId }],
      damageAssignment: new Map(),
    };

    const view = getPlayerView(state, 'p1');

    expect(view.combat?.assignments).toHaveLength(1);
    expect(view.combat?.assignments[0].attacker.name).toBe('Goreclaw, Terror of Qal Sisma');
    expect(view.combat?.assignments[0].blockers[0].name).toBe('Talrand, Sky Summoner');
    expect(view.combat?.assignments[0].attacker.keywords).toEqual(expect.arrayContaining(['Trample', 'Deathtouch']));
    expect(view.combat?.assignments[0].assignmentHint).toContain('trample and deathtouch');
  });

  it('does not offer pass priority before attackers are declared', () => {
    const state = { ...roomGame(), phase: 'combat' as const, step: 'declare_attackers' as const, combat: null };
    const view = getPlayerView(state, 'p1');

    expect(view.legalActions.find(action => action.action === 'Pass Priority')).toMatchObject({
      enabled: false,
      reason: 'Declare attackers first. You may declare no attackers.',
    });
    expect(view.legalActions.find(action => action.action === 'Declare Attackers')).toMatchObject({
      enabled: true,
    });
  });
});
