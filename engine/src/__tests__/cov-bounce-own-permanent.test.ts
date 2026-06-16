/**
 * cov-bounce-own-permanent: parsing + executing tests for the
 * bounce-your-own-permanent trigger-body family:
 *
 *   "return a/an/another <artifact|creature|enchantment|land|permanent>
 *    [color-qualified] you control to its owner's hand"
 *
 * as an ETB / attacks / upkeep trigger body (Kor Skyfisher, Shrieking Drake,
 * Species Gorger, Salvage Scuttler, Horned Kavu, Eiganjo Free-Riders).
 *
 * The clause parses to ReturnToHand with a Chosen TargetSpec carrying
 * controllerControls (plus a colors / notSource constraint where worded), and
 * resolves through the executor's existing resolveTargetRef Chosen path.
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState } from '../game-state';
import {
  resolveTopOfStack,
  putTriggersOnStack,
  checkTriggersForEvent,
  registerBattlefieldAbilities,
  createETBTriggers,
} from '../stack';
import { declareAttackers } from '../combat';
import { getLegalTargets } from '../ai/legal-actions';
import type { CardDefinition, GameState, CardInstance } from '../types';
import type { Effect } from '../effects/ast';

function makeCreature(
  id: string,
  name: string,
  oracleText: string,
  colors: Array<'W' | 'U' | 'B' | 'R' | 'G'> = ['U'],
): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature - Test',
    oracle_text: oracleText,
    mana_cost: '{1}{U}',
    cmc: 2,
    colors,
    color_identity: colors,
    keywords: [],
    power: 2,
    toughness: 2,
    card_types: ['creature'],
  };
}

function makeArtifact(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Artifact',
    oracle_text: '',
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['artifact'],
  };
}

function makeLand(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Basic Land - Island',
    oracle_text: '{T}: Add {U}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['U'],
    keywords: [],
    card_types: ['land'],
  };
}

function createTestGame(p1Cards: CardDefinition[], p2Cards: CardDefinition[]): GameState {
  return initGameState([
    { playerId: 'p1', name: 'Player 1', cards: p1Cards, commanderId: 'nonexistent-cmd-1' },
    { playerId: 'p2', name: 'Player 2', cards: p2Cards, commanderId: 'nonexistent-cmd-2' },
  ]);
}

function moveToBattlefield(state: GameState, instanceId: string): GameState {
  const card = state.cards.get(instanceId);
  if (!card) throw new Error(`Card not found: ${instanceId}`);
  const newCards = new Map(state.cards);
  newCards.set(instanceId, { ...card, zone: 'battlefield', summoningSick: false });
  return { ...state, cards: newCards };
}

function findCard(state: GameState, defId: string): CardInstance {
  for (const card of state.cards.values()) {
    if (card.definitionId === defId) return card;
  }
  throw new Error(`Card not found for def: ${defId}`);
}

// ---------------------------------------------------------------------------
// PARSING
// ---------------------------------------------------------------------------

describe('cov-bounce-own-permanent parsing', () => {
  it('parses Kor Skyfisher ETB: "return a permanent you control to its owner\'s hand"', () => {
    const result = parseOracleText("When this creature enters, return a permanent you control to its owner's hand.");
    expect(result.kind).toBe('ETB');
    if (result.kind !== 'ETB') return;
    expect(result.ability.effects).toHaveLength(1);
    const eff = result.ability.effects[0] as Extract<Effect, { kind: 'ReturnToHand' }>;
    expect(eff.kind).toBe('ReturnToHand');
    expect(eff.target.kind).toBe('Chosen');
    expect(result.targets).toMatchObject([
      { type: 'Permanent', constraints: { controllerControls: true } },
    ]);
  });

  it('parses Salvage Scuttler attack trigger: "return an artifact you control..."', () => {
    const result = parseOracleText("Whenever this creature attacks, return an artifact you control to its owner's hand.");
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'Attacks', who: 'self' });
    expect(result.ability.effects[0]).toMatchObject({ kind: 'ReturnToHand', target: { kind: 'Chosen' } });
    expect(result.targets).toMatchObject([
      { type: 'Artifact', constraints: { controllerControls: true } },
    ]);
  });

  it('parses Species Gorger upkeep trigger: "return a creature you control..."', () => {
    const result = parseOracleText("At the beginning of your upkeep, return a creature you control to its owner's hand.");
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'yours' });
    expect(result.ability.effects[0]).toMatchObject({ kind: 'ReturnToHand', target: { kind: 'Chosen' } });
    expect(result.targets).toMatchObject([
      { type: 'Creature', constraints: { controllerControls: true } },
    ]);
  });

  it('parses Horned Kavu ETB with a multi-color qualifier: "return a red or green creature you control..."', () => {
    const result = parseOracleText("When this creature enters, return a red or green creature you control to its owner's hand.");
    expect(result.kind).toBe('ETB');
    if (result.kind !== 'ETB') return;
    expect(result.ability.effects[0]).toMatchObject({ kind: 'ReturnToHand', target: { kind: 'Chosen' } });
    expect(result.targets).toMatchObject([
      { type: 'Creature', constraints: { colors: ['R', 'G'], controllerControls: true } },
    ]);
  });

  it('parses Eiganjo Free-Riders upkeep trigger: "return a white creature you control..."', () => {
    const result = parseOracleText("At the beginning of your upkeep, return a white creature you control to its owner's hand.");
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'yours' });
    expect(result.targets).toMatchObject([
      { type: 'Creature', constraints: { colors: ['W'], controllerControls: true } },
    ]);
  });

  it('parses the "another" form with a notSource constraint', () => {
    const result = parseOracleText("When this creature enters, return another creature you control to its owner's hand.");
    expect(result.kind).toBe('ETB');
    if (result.kind !== 'ETB') return;
    expect(result.targets).toMatchObject([
      { type: 'Creature', constraints: { controllerControls: true, notSource: true } },
    ]);
  });

  it('regression: Karoo bounce-land ETB still parses, now with controllerControls', () => {
    const result = parseOracleText("This land enters tapped. When this land enters, return a land you control to its owner's hand. {T}: Add {G}{W}.");
    expect(result.kind).toBe('ETB');
    if (result.kind !== 'ETB') return;
    expect(result.ability.effects[0]).toMatchObject({ kind: 'ReturnToHand' });
    expect(result.targets).toMatchObject([
      { type: 'Land', constraints: { controllerControls: true } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// EXECUTION — the chosen permanent actually goes back to its owner's hand
// ---------------------------------------------------------------------------

describe('cov-bounce-own-permanent execution', () => {
  it('Kor Skyfisher-style ETB bounces a chosen permanent you control to hand', () => {
    const skyfisher = makeCreature(
      'kor-skyfisher',
      'Kor Skyfisher',
      "When this creature enters, return a permanent you control to its owner's hand.",
    );
    let state = createTestGame(
      [skyfisher, makeLand('plains', 'Plains'), makeLand('island', 'Island')],
      [makeLand('swamp', 'Swamp')],
    );

    const fisherInst = findCard(state, 'kor-skyfisher');
    const plainsInst = findCard(state, 'plains');
    state = moveToBattlefield(state, fisherInst.instanceId);
    state = moveToBattlefield(state, plainsInst.instanceId);
    state = registerBattlefieldAbilities(state, fisherInst.instanceId);
    state = createETBTriggers(state, fisherInst.instanceId);

    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0].requiredTargets).toMatchObject([
      { type: 'Permanent', constraints: { controllerControls: true } },
    ]);

    const triggerId = state.pendingTriggers[0].id;
    state = putTriggersOnStack(state, { [triggerId]: [plainsInst.instanceId] });
    state = resolveTopOfStack(state);

    expect(state.cards.get(plainsInst.instanceId)!.zone).toBe('hand');
    expect(state.cards.get(fisherInst.instanceId)!.zone).toBe('battlefield');
  });

  it('Salvage Scuttler-style attack trigger bounces a chosen artifact you control', () => {
    const scuttler = makeCreature(
      'salvage-scuttler',
      'Salvage Scuttler',
      "Whenever this creature attacks, return an artifact you control to its owner's hand.",
    );
    const trinket = makeArtifact('trinket', 'Trinket');
    let state = createTestGame(
      [scuttler, trinket, makeLand('island', 'Island')],
      [makeLand('swamp', 'Swamp')],
    );

    const scuttlerInst = findCard(state, 'salvage-scuttler');
    const trinketInst = findCard(state, 'trinket');
    state = moveToBattlefield(state, scuttlerInst.instanceId);
    state = moveToBattlefield(state, trinketInst.instanceId);
    state = registerBattlefieldAbilities(state, scuttlerInst.instanceId);
    state = { ...state, activePlayerIndex: 0, phase: 'combat' as any, step: 'declare_attackers' as any };

    state = declareAttackers(state, 'p1', [{ cardInstanceId: scuttlerInst.instanceId, defendingPlayerId: 'p2' }]);
    expect(state.pendingTriggers).toHaveLength(1);

    const triggerId = state.pendingTriggers[0].id;
    state = putTriggersOnStack(state, { [triggerId]: [trinketInst.instanceId] });
    state = resolveTopOfStack(state);

    expect(state.cards.get(trinketInst.instanceId)!.zone).toBe('hand');
    expect(state.cards.get(scuttlerInst.instanceId)!.zone).toBe('battlefield');
  });

  it('Species Gorger-style upkeep trigger bounces a chosen creature you control', () => {
    const gorger = makeCreature(
      'species-gorger',
      'Species Gorger',
      "At the beginning of your upkeep, return a creature you control to its owner's hand.",
    );
    const bear = makeCreature('bounce-bear', 'Bounce Bear', '');
    let state = createTestGame(
      [gorger, bear, makeLand('island', 'Island')],
      [makeLand('swamp', 'Swamp')],
    );

    const gorgerInst = findCard(state, 'species-gorger');
    const bearInst = findCard(state, 'bounce-bear');
    state = moveToBattlefield(state, gorgerInst.instanceId);
    state = moveToBattlefield(state, bearInst.instanceId);
    state = registerBattlefieldAbilities(state, gorgerInst.instanceId);

    state = { ...state, phase: 'beginning' as any, step: 'upkeep' as any, activePlayerIndex: 0, priorityPlayerIndex: 0 };
    state = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'p1' });
    expect(state.pendingTriggers).toHaveLength(1);

    const triggerId = state.pendingTriggers[0].id;
    state = putTriggersOnStack(state, { [triggerId]: [bearInst.instanceId] });
    state = resolveTopOfStack(state);

    expect(state.cards.get(bearInst.instanceId)!.zone).toBe('hand');
    expect(state.cards.get(gorgerInst.instanceId)!.zone).toBe('battlefield');
  });

  it('Horned Kavu-style color-qualified chooser only offers your red/green creatures', () => {
    const kavu = makeCreature(
      'horned-kavu',
      'Horned Kavu',
      "When this creature enters, return a red or green creature you control to its owner's hand.",
      ['R', 'G'],
    );
    const greenBear = makeCreature('green-bear', 'Green Bear', '', ['G']);
    const blueDrake = makeCreature('blue-drake', 'Blue Drake', '', ['U']);
    const opponentRed = makeCreature('opp-red', 'Opponent Red', '', ['R']);
    let state = createTestGame(
      [kavu, greenBear, blueDrake, makeLand('island', 'Island')],
      [opponentRed, makeLand('swamp', 'Swamp')],
    );

    const kavuInst = findCard(state, 'horned-kavu');
    const bearInst = findCard(state, 'green-bear');
    const drakeInst = findCard(state, 'blue-drake');
    const oppInst = findCard(state, 'opp-red');
    state = moveToBattlefield(state, kavuInst.instanceId);
    state = moveToBattlefield(state, bearInst.instanceId);
    state = moveToBattlefield(state, drakeInst.instanceId);
    state = moveToBattlefield(state, oppInst.instanceId);
    state = registerBattlefieldAbilities(state, kavuInst.instanceId);
    state = createETBTriggers(state, kavuInst.instanceId);

    expect(state.pendingTriggers).toHaveLength(1);
    const spec = state.pendingTriggers[0].requiredTargets![0];
    const legal = getLegalTargets(state, 'p1', spec as any, kavuInst.instanceId);

    // Your green bear and the Kavu itself (red/green, you control) are legal;
    // your blue drake and the opponent's red creature are not.
    expect(legal).toContain(bearInst.instanceId);
    expect(legal).toContain(kavuInst.instanceId);
    expect(legal).not.toContain(drakeInst.instanceId);
    expect(legal).not.toContain(oppInst.instanceId);

    const triggerId = state.pendingTriggers[0].id;
    state = putTriggersOnStack(state, { [triggerId]: [bearInst.instanceId] });
    state = resolveTopOfStack(state);
    expect(state.cards.get(bearInst.instanceId)!.zone).toBe('hand');
  });
});
