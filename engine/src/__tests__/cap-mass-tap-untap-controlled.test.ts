import { describe, it, expect } from 'vitest';
import { executeEffects } from '../effects/executor';
import { parseOracleText } from '../effects/parser';
import type { Effect } from '../effects/ast';
import type { GameState, CardInstance, CardDefinition } from '../types';

/**
 * Capability: mass-tap-untap-controlled
 *
 * Tap/Untap mass branches now honour a "you control" restriction:
 *   - Tap   AllOfType { controllerControls: true }   taps only the caster's matching permanents.
 *   - Untap AllOfType { controllerControls: true }   untaps only the caster's matching permanents.
 * Without the flag the branch still affects EVERY matching permanent (all controllers),
 * preserving the previous "untap all <type>" / "tap all creatures" behaviour.
 *
 * Parser recognises:
 *   "tap all <type> you control", "untap all <type> you control",
 *   "untap all lands you control".
 *
 * "Honest": the executor restricts strictly to the caster's permanents (ownerId === caster),
 * never touches an opponent's permanents, and never no-ops the matching ones.
 */

function makeDef(
  id: string,
  name: string,
  type_line: string,
  card_types: string[],
): CardDefinition {
  return {
    id,
    name,
    type_line,
    oracle_text: '',
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types,
  } as CardDefinition;
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  tapped: boolean,
): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone: 'battlefield',
    tapped,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  } as CardInstance;
}

function makeState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  cardDefinitions.set('def-land', makeDef('def-land', 'Forest', 'Basic Land — Forest', ['land']));
  cardDefinitions.set('def-art', makeDef('def-art', 'Mana Rock', 'Artifact', ['artifact']));
  cardDefinitions.set('def-cre', makeDef('def-cre', 'Bear', 'Creature — Bear', ['creature']));

  // player-1: 2 lands, 1 artifact, 1 creature  (mix of tapped/untapped)
  cards.set('p1-land-a', makeCard('p1-land-a', 'def-land', 'player-1', true));   // tapped
  cards.set('p1-land-b', makeCard('p1-land-b', 'def-land', 'player-1', true));   // tapped
  cards.set('p1-art', makeCard('p1-art', 'def-art', 'player-1', false));          // untapped
  cards.set('p1-cre', makeCard('p1-cre', 'def-cre', 'player-1', false));          // untapped

  // player-2: 1 land, 1 artifact  (both tapped) — must remain untouched by "you control"
  cards.set('p2-land', makeCard('p2-land', 'def-land', 'player-2', true));        // tapped
  cards.set('p2-art', makeCard('p2-art', 'def-art', 'player-2', true));           // tapped

  const players = ['player-1', 'player-2'].map((id, idx) => ({
    id,
    name: id,
    life: 40,
    poisonCounters: 0,
    commanderDamage: {},
    commanderTax: 0,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    hasPlayedLand: false,
    hasPriority: idx === 0,
    hasLost: false,
  }));

  return {
    players,
    cards,
    cardDefinitions,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
  } as GameState;
}

const tapped = (s: GameState, id: string) => s.cards.get(id)!.tapped;

describe('cap-mass-tap-untap-controlled', () => {
  it('Untap AllOfType lands controllerControls untaps only the caster\'s lands', () => {
    const effects: Effect[] = [
      { kind: 'Untap', target: { kind: 'AllOfType', filter: { types: ['land'] }, controllerControls: true } },
    ];
    const r = executeEffects(makeState(), effects, 'player-1', [], []);

    expect(tapped(r, 'p1-land-a')).toBe(false); // caster's lands untapped
    expect(tapped(r, 'p1-land-b')).toBe(false);
    expect(tapped(r, 'p2-land')).toBe(true);    // opponent's land untouched
    expect(tapped(r, 'p2-art')).toBe(true);     // opponent's artifact untouched (not a land anyway)
    expect(tapped(r, 'p1-art')).toBe(false);    // was already untapped, not a land
  });

  it('Untap AllOfType WITHOUT the flag still untaps EVERY matching land (all controllers) — unchanged', () => {
    const effects: Effect[] = [
      { kind: 'Untap', target: { kind: 'AllOfType', filter: { types: ['land'] } } },
    ];
    const r = executeEffects(makeState(), effects, 'player-1', [], []);

    expect(tapped(r, 'p1-land-a')).toBe(false);
    expect(tapped(r, 'p1-land-b')).toBe(false);
    expect(tapped(r, 'p2-land')).toBe(false); // opponent's land ALSO untapped (legacy behaviour)
  });

  it('Tap AllOfType artifacts controllerControls taps only the caster\'s artifacts', () => {
    const effects: Effect[] = [
      { kind: 'Tap', target: { kind: 'AllOfType', filter: { types: ['artifact'] }, controllerControls: true } },
    ];
    const r = executeEffects(makeState(), effects, 'player-1', [], []);

    expect(tapped(r, 'p1-art')).toBe(true);   // caster's artifact tapped
    expect(tapped(r, 'p2-art')).toBe(true);   // opponent's was already tapped, must stay tapped
    expect(tapped(r, 'p1-cre')).toBe(false);  // creature not an artifact — untouched
    expect(tapped(r, 'p1-land-a')).toBe(true); // unrelated land unchanged
  });

  it('Tap AllOfType artifacts WITHOUT the flag taps EVERY artifact (all controllers)', () => {
    const effects: Effect[] = [
      { kind: 'Tap', target: { kind: 'AllOfType', filter: { types: ['artifact'] } } },
    ];
    const r = executeEffects(makeState(), effects, 'player-1', [], []);

    expect(tapped(r, 'p1-art')).toBe(true);
    expect(tapped(r, 'p2-art')).toBe(true);
  });

  it('Tap AllCreatures (legacy) is unchanged — taps both players\' creatures', () => {
    const state = makeState();
    // give player-2 a creature too
    state.cards.set('p2-cre', makeCard('p2-cre', 'def-cre', 'player-2', false));
    const effects: Effect[] = [{ kind: 'Tap', target: { kind: 'AllCreatures' } }];
    const r = executeEffects(state, effects, 'player-1', [], []);

    expect(tapped(r, 'p1-cre')).toBe(true);
    expect(tapped(r, 'p2-cre')).toBe(true);
  });

  it('parser: "untap all lands you control" -> Untap AllOfType land controllerControls, executes honestly', () => {
    const parsed = parseOracleText('Untap all lands you control.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(1);
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('Untap');
    if (eff.kind !== 'Untap') return;
    expect(eff.target.kind).toBe('AllOfType');
    if (eff.target.kind !== 'AllOfType') return;
    expect(eff.target.filter).toEqual({ types: ['land'] });
    expect(eff.target.controllerControls).toBe(true);

    const r = executeEffects(makeState(), parsed.effects, 'player-1', [], []);
    expect(tapped(r, 'p1-land-a')).toBe(false);
    expect(tapped(r, 'p1-land-b')).toBe(false);
    expect(tapped(r, 'p2-land')).toBe(true); // opponent untouched
  });

  it('parser: "tap all artifacts you control" -> Tap AllOfType artifact controllerControls', () => {
    const parsed = parseOracleText('Tap all artifacts you control.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('Tap');
    if (eff.kind !== 'Tap') return;
    expect(eff.target.kind).toBe('AllOfType');
    if (eff.target.kind !== 'AllOfType') return;
    expect(eff.target.filter).toEqual({ types: ['artifact'] });
    expect(eff.target.controllerControls).toBe(true);

    const r = executeEffects(makeState(), parsed.effects, 'player-1', [], []);
    expect(tapped(r, 'p1-art')).toBe(true);
    expect(tapped(r, 'p2-art')).toBe(true); // was already tapped; opponent never modified
  });

  it('parser: "untap all creatures you control" still maps to AllCreaturesYouControl (unchanged)', () => {
    const parsed = parseOracleText('Untap all creatures you control.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('Untap');
    if (eff.kind !== 'Untap') return;
    expect(eff.target).toEqual({ kind: 'AllCreaturesYouControl' });
  });

  it('parser: "tap all creatures" (no restriction) still maps to AllCreatures (unchanged)', () => {
    const parsed = parseOracleText('Tap all creatures.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('Tap');
    if (eff.kind !== 'Tap') return;
    expect(eff.target).toEqual({ kind: 'AllCreatures' });
  });
});
