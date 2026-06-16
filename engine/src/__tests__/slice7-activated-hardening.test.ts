/**
 * Slice 7: Activated-line hardening tests
 *
 * Covers:
 *  (a) "Activate only as a sorcery." / "Activate only during your turn[...]."
 *      riders — parsed into timing='sorcery' and enforced in canActivateAbility.
 *  (b) PutIntoLibrary bodies targeting graveyard cards:
 *        - "put this creature on top of its owner's library" (Wayward Soul)
 *        - "put target card from a graveyard on the bottom of its owner's library"
 *          (Malevolent Chandelier / Cogwork Archivist)
 *        - "put target creature card from your graveyard on top of your library"
 *          (Hua Tuo, Honored Physician)
 *        - "put target card from your graveyard on the bottom of your library"
 *          (Barkform Harvester)
 */

import { describe, it, expect } from 'vitest';
import { parseActivatedAbilities } from '../effects/parser';
import { canActivateAbility, activateAbility } from '../actions';
import { resolveTopOfStack } from '../stack';
import type { GameState, CardDefinition, CardInstance } from '../types';

// ============================================================================
// Test helpers
// ============================================================================

function createTestDef(overrides: Partial<CardDefinition> & { id: string; name: string }): CardDefinition {
  return {
    type_line: 'Creature',
    oracle_text: '',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['creature'],
    power: 1,
    toughness: 1,
    ...overrides,
  };
}

function createTestState(
  cards: {
    def: CardDefinition;
    zone: string;
    ownerId: string;
    tapped?: boolean;
    summoningSick?: boolean;
  }[],
  opts?: { phase?: GameState['phase']; stackNonEmpty?: boolean },
): GameState {
  const cardDefinitions = new Map<string, CardDefinition>();
  const cardInstances = new Map<string, CardInstance>();

  for (let i = 0; i < cards.length; i++) {
    const { def, zone, ownerId, tapped, summoningSick } = cards[i];
    cardDefinitions.set(def.id, def);
    const instanceId = `inst_${i + 1}`;
    cardInstances.set(instanceId, {
      instanceId,
      definitionId: def.id,
      ownerId,
      zone: zone as any,
      tapped: tapped ?? false,
      summoningSick: summoningSick ?? false,
      counters: {},
      damage: 0,
      isCommander: false,
    });
  }

  // Build a fake stack item for stackNonEmpty option
  const fakeStack: GameState['stack'] = opts?.stackNonEmpty
    ? ([{ kind: 'Spell', id: 'fake_spell', cardInstanceId: 'fake', casterId: 'p1', effects: [], targets: [], targetSpecs: [] }] as any)
    : [];

  return {
    players: [
      {
        id: 'p1',
        name: 'Player 1',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: { W: 0, U: 2, B: 0, R: 0, G: 2, C: 2 },
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'p2',
        name: 'Player 2',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards: cardInstances,
    cardDefinitions,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: opts?.phase ?? 'precombat_main',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: fakeStack,
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

// ============================================================================
// (a) Activate-only-as-a-sorcery rider
// ============================================================================

describe('Slice 7: Activate only as a sorcery rider', () => {
  const SORCERY_ORACLE = '{G}: This creature gets +4/+4 and gains trample until end of turn. Activate only as a sorcery.';
  // Sagu Pummeler-style oracle
  const TURN_ORACLE = '{U}: Put this creature on top of its owner\'s library. Activate only during your turn.';

  it('parseActivatedAbilities sets timing=sorcery for "Activate only as a sorcery."', () => {
    const abilities = parseActivatedAbilities(SORCERY_ORACLE);
    expect(abilities).toHaveLength(1);
    expect(abilities[0].timing).toBe('sorcery');
    // Effect body still parsed correctly
    expect(abilities[0].effects.some(e => e.kind === 'ModifyPT')).toBe(true);
  });

  it('parseActivatedAbilities sets timing=sorcery for "Activate only during your turn."', () => {
    const abilities = parseActivatedAbilities(TURN_ORACLE);
    expect(abilities).toHaveLength(1);
    expect(abilities[0].timing).toBe('sorcery');
    expect(abilities[0].effects.some(e => e.kind === 'PutIntoLibrary')).toBe(true);
  });

  it('parseActivatedAbilities does NOT set timing on a normal ability', () => {
    const abilities = parseActivatedAbilities('{T}: Draw a card.');
    expect(abilities).toHaveLength(1);
    expect(abilities[0].timing).toBeUndefined();
  });

  it('canActivateAbility returns true for sorcery-speed ability during main phase with empty stack', () => {
    const def = createTestDef({
      id: 'sagu',
      name: 'Sagu Pummeler',
      oracle_text: SORCERY_ORACLE,
    });
    const state = createTestState([{ def, zone: 'battlefield', ownerId: 'p1' }]);
    // p1 is active player, precombat_main, empty stack
    expect(canActivateAbility(state, 'p1', 'inst_1', 0)).toBe(true);
  });

  it('canActivateAbility returns false for sorcery-speed ability during opponent turn', () => {
    const def = createTestDef({
      id: 'sagu',
      name: 'Sagu Pummeler',
      oracle_text: SORCERY_ORACLE,
    });
    const state = createTestState([{ def, zone: 'battlefield', ownerId: 'p1' }]);
    // Set active player to p2 (opponent's turn)
    const opponentsTurn = { ...state, activePlayerIndex: 1, priorityPlayerIndex: 1 };
    expect(canActivateAbility(opponentsTurn, 'p1', 'inst_1', 0)).toBe(false);
  });

  it('canActivateAbility returns false for sorcery-speed ability during combat phase', () => {
    const def = createTestDef({
      id: 'sagu',
      name: 'Sagu Pummeler',
      oracle_text: SORCERY_ORACLE,
    });
    const state = createTestState(
      [{ def, zone: 'battlefield', ownerId: 'p1' }],
      { phase: 'combat' },
    );
    expect(canActivateAbility(state, 'p1', 'inst_1', 0)).toBe(false);
  });

  it('canActivateAbility returns false for sorcery-speed ability when stack is non-empty', () => {
    const def = createTestDef({
      id: 'sagu',
      name: 'Sagu Pummeler',
      oracle_text: SORCERY_ORACLE,
    });
    const state = createTestState(
      [{ def, zone: 'battlefield', ownerId: 'p1' }],
      { stackNonEmpty: true },
    );
    expect(canActivateAbility(state, 'p1', 'inst_1', 0)).toBe(false);
  });

  it('Dreadlight Monstrosity-style: "Activate only during your turn, and only before attackers are declared."', () => {
    const oracle = '{3}: ~ gets +3/+0 until end of turn. Activate only during your turn, and only before attackers are declared.';
    const abilities = parseActivatedAbilities(oracle);
    expect(abilities).toHaveLength(1);
    expect(abilities[0].timing).toBe('sorcery');
  });
});

// ============================================================================
// (b) PutIntoLibrary graveyard-source patterns
// ============================================================================

describe('Slice 7: PutIntoLibrary graveyard-source matchers — parse', () => {
  it('Wayward Soul: "put this creature on top of its owner\'s library"', () => {
    const abilities = parseActivatedAbilities('{U}: Put this creature on top of its owner\'s library.');
    expect(abilities).toHaveLength(1);
    const eff = abilities[0].effects[0];
    expect(eff.kind).toBe('PutIntoLibrary');
    if (eff.kind !== 'PutIntoLibrary') return;
    expect(eff.position).toBe('top');
    expect(eff.target).toEqual({ kind: 'Source' });
  });

  it('Malevolent Chandelier: "put target card from a graveyard on the bottom of its owner\'s library"', () => {
    const abilities = parseActivatedAbilities('{2}, {T}: Put target card from a graveyard on the bottom of its owner\'s library.');
    expect(abilities).toHaveLength(1);
    const eff = abilities[0].effects[0];
    expect(eff.kind).toBe('PutIntoLibrary');
    if (eff.kind !== 'PutIntoLibrary') return;
    expect(eff.position).toBe('bottom');
    // Target is a card in a graveyard
    expect(abilities[0].targets).toHaveLength(1);
    expect(abilities[0].targets[0].type).toBe('CardInGraveyard');
  });

  it('Cogwork Archivist: "put target card from a graveyard on the bottom of its owner\'s library"', () => {
    const abilities = parseActivatedAbilities('{T}: Put target card from a graveyard on the bottom of its owner\'s library.');
    expect(abilities).toHaveLength(1);
    const eff = abilities[0].effects[0];
    expect(eff.kind).toBe('PutIntoLibrary');
    if (eff.kind !== 'PutIntoLibrary') return;
    expect(eff.position).toBe('bottom');
    expect(abilities[0].targets[0].type).toBe('CardInGraveyard');
  });

  it('Hua Tuo: "put target creature card from your graveyard on top of your library"', () => {
    const abilities = parseActivatedAbilities('{T}: Put target creature card from your graveyard on top of your library.');
    expect(abilities).toHaveLength(1);
    const eff = abilities[0].effects[0];
    expect(eff.kind).toBe('PutIntoLibrary');
    if (eff.kind !== 'PutIntoLibrary') return;
    expect(eff.position).toBe('top');
    expect(abilities[0].targets).toHaveLength(1);
    expect(abilities[0].targets[0].type).toBe('CreatureCardInGraveyard');
    // controllerControls constraint from "your graveyard"
    expect(abilities[0].targets[0].constraints?.controllerControls).toBe(true);
  });

  it('Barkform Harvester: "put target card from your graveyard on the bottom of your library"', () => {
    const abilities = parseActivatedAbilities('{2}: Put target card from your graveyard on the bottom of your library.');
    expect(abilities).toHaveLength(1);
    const eff = abilities[0].effects[0];
    expect(eff.kind).toBe('PutIntoLibrary');
    if (eff.kind !== 'PutIntoLibrary') return;
    expect(eff.position).toBe('bottom');
    expect(abilities[0].targets[0].type).toBe('CardInGraveyard');
    expect(abilities[0].targets[0].constraints?.controllerControls).toBe(true);
  });
});

// ============================================================================
// (b) PutIntoLibrary execution tests
// ============================================================================

describe('Slice 7: PutIntoLibrary graveyard-source — execution', () => {
  it('Wayward Soul self-bounce: activated ability puts source creature on top of library', () => {
    const waywardSoul = createTestDef({
      id: 'wayward-soul',
      name: 'Wayward Soul',
      oracle_text: '{U}: Put this creature on top of its owner\'s library.',
      mana_cost: '{1}{U}',
    });
    let state = createTestState([{ def: waywardSoul, zone: 'battlefield', ownerId: 'p1' }]);
    // Give p1 blue mana
    state = { ...state, players: state.players.map((p, i) => i === 0 ? { ...p, manaPool: { ...p.manaPool, U: 1 } } : p) };

    expect(canActivateAbility(state, 'p1', 'inst_1', 0)).toBe(true);
    let newState = activateAbility(state, 'p1', 'inst_1', 0, []);
    // Resolve the stack
    newState = resolveTopOfStack(newState);
    const card = newState.cards.get('inst_1')!;
    expect(card.zone).toBe('library');
  });

  it('Hua Tuo: graveyard creature card moves to top of library on resolution', () => {
    const huaTuo = createTestDef({
      id: 'hua-tuo',
      name: 'Hua Tuo, Honored Physician',
      oracle_text: '{T}: Put target creature card from your graveyard on top of your library.',
      mana_cost: '{1}{G}',
    });
    const bearCard = createTestDef({
      id: 'bear',
      name: 'Bear',
      type_line: 'Creature — Bear',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });
    // Hua Tuo on battlefield, bear in graveyard
    let state = createTestState([
      { def: huaTuo, zone: 'battlefield', ownerId: 'p1' },
      { def: bearCard, zone: 'graveyard', ownerId: 'p1' },
    ]);

    expect(canActivateAbility(state, 'p1', 'inst_1', 0)).toBe(true);
    let newState = activateAbility(state, 'p1', 'inst_1', 0, ['inst_2']);
    newState = resolveTopOfStack(newState);

    const bear = newState.cards.get('inst_2')!;
    expect(bear.zone).toBe('library');
  });

  it('Barkform Harvester: any graveyard card moves to bottom of library', () => {
    const harvester = createTestDef({
      id: 'harvester',
      name: 'Barkform Harvester',
      oracle_text: '{2}: Put target card from your graveyard on the bottom of your library.',
      mana_cost: '{4}{G}',
    });
    const instantCard = createTestDef({
      id: 'lightning',
      name: 'Lightning Bolt',
      type_line: 'Instant',
      card_types: ['instant'],
      power: 0,
      toughness: 0,
    });
    const libraryCard = createTestDef({
      id: 'lib-card',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      card_types: ['land'],
    });
    let state = createTestState([
      { def: harvester, zone: 'battlefield', ownerId: 'p1' },
      { def: instantCard, zone: 'graveyard', ownerId: 'p1' },
      { def: libraryCard, zone: 'library', ownerId: 'p1' },
    ]);
    // Give p1 generic mana for {2} cost
    state = { ...state, players: state.players.map((p, i) => i === 0 ? { ...p, manaPool: { ...p.manaPool, C: 2 } } : p) };

    expect(canActivateAbility(state, 'p1', 'inst_1', 0)).toBe(true);
    let newState = activateAbility(state, 'p1', 'inst_1', 0, ['inst_2']);
    newState = resolveTopOfStack(newState);

    const instant = newState.cards.get('inst_2')!;
    expect(instant.zone).toBe('library');

    // Verify the moved card is at the bottom (library order: existing card first, then inst_2)
    const libraryOrder = [...newState.cards.values()]
      .filter(c => c.ownerId === 'p1' && c.zone === 'library')
      .map(c => c.instanceId);
    expect(libraryOrder[libraryOrder.length - 1]).toBe('inst_2'); // bottom
  });
});
