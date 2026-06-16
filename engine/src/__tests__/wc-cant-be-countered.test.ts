import { describe, it, expect } from 'vitest';
import { castSpell, resolveTopOfStack } from '../stack';
import { initGameState, getCardsInZone } from '../game-state';
import { parseOracleText } from '../effects/parser';
import { CardDefinition } from '../types';

// A creature spell whose ONLY non-keyword text is the spell-self "can't be
// countered" clause (Carnage Tyrant pattern). The keywords are engine-handled;
// the uncounterability is enforced at cast time by stack.ts and honored by
// executor.ts executeCounterSpell.
function makeUncounterableCreature(): CardDefinition {
  return {
    id: 'cbc-creature-1',
    name: 'Test Tyrant',
    type_line: 'Creature — Dinosaur',
    oracle_text: "This spell can't be countered.\nTrample, hexproof",
    mana_cost: '{G}',
    cmc: 1,
    colors: ['G'],
    color_identity: ['G'],
    keywords: ['Trample', 'Hexproof'],
    card_types: ['creature'],
    power: 7,
    toughness: 6,
  };
}

// Control: an ordinary creature spell with no protective text.
function makePlainCreature(): CardDefinition {
  return {
    id: 'plain-creature-1',
    name: 'Plain Beast',
    type_line: 'Creature — Beast',
    oracle_text: '',
    mana_cost: '{G}',
    cmc: 1,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
  };
}

function makeCounterspell(): CardDefinition {
  return {
    id: 'counterspell-cbc',
    name: 'Counterspell',
    type_line: 'Instant',
    oracle_text: 'Counter target spell.',
    mana_cost: '{U}{U}',
    cmc: 2,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    card_types: ['instant'],
  };
}

describe('whole-card: This spell can\'t be countered', () => {
  it('parses the spell-self clause as a CantBeCountered marker (keyword-only rest)', () => {
    const parsed = parseOracleText("This spell can't be countered.\nTrample, hexproof");
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.modifier.kind).toBe('GrantKeyword');
    expect((parsed.ability.modifier as { keyword: string }).keyword).toBe('CantBeCountered');
  });

  it('Slice 11: DOES claim a battlefield-source granted static ("Creature spells can\'t be countered")', () => {
    // Slice 11 adds matchBattlefieldCantBeCountered which now parses this as a
    // non-selfOnly StaticAbility (Gaea's Herald / Prowling Serpopard family).
    // The executor enforces it via the continuousEffects scan in executeCounterSpell.
    const parsed = parseOracleText("Creature spells can't be countered.");
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    const mod = parsed.ability.modifier;
    expect(mod.kind).toBe('GrantKeyword');
    expect((mod as any).keyword).toBe('CantBeCountered');
    // Must NOT be selfOnly — this is the battlefield-source form, not spell-self.
    expect(parsed.ability.selfOnly).toBeFalsy();
  });

  it('does NOT claim a face with a real unrun effect beside the CBC clause', () => {
    // "Look at the top 5 cards of your library." is an effect the engine does not
    // parse (no matcher for "look at the top N cards"), so the whole face stays
    // Unparsed and the CBC clause does not cause it to be mis-claimed as StaticAbility.
    const parsed = parseOracleText("This spell can't be countered.\nLook at the top 5 cards of your library.");
    expect(parsed.kind).toBe('Unparsed');
  });

  it('sets cantBeCountered on the stack item when cast', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeUncounterableCreature()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [makeCounterspell()], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const tyrant = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(tyrant.instanceId, { ...tyrant, zone: 'hand' });
    state = {
      ...state,
      phase: 'precombat_main' as any,
      players: state.players.map(p =>
        p.id === 'p1' ? { ...p, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 } } : p,
      ),
    };

    state = castSpell(state, 'p1', tyrant.instanceId);
    expect(state.stack).toHaveLength(1);
    expect((state.stack[0] as any).cantBeCountered).toBe(true);
  });

  it('a counterspell FAILS to counter it (it resolves to the battlefield)', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeUncounterableCreature()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [makeCounterspell()], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const tyrant = getCardsInZone(state, 'p1', 'library')[0];
    const counter = getCardsInZone(state, 'p2', 'library')[0];
    state.cards.set(tyrant.instanceId, { ...tyrant, zone: 'hand' });
    state.cards.set(counter.instanceId, { ...counter, zone: 'hand' });
    state = {
      ...state,
      phase: 'precombat_main' as any,
      players: state.players.map(p =>
        p.id === 'p1' ? { ...p, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 } } : p,
      ),
    };

    state = castSpell(state, 'p1', tyrant.instanceId);
    expect(state.stack[0].cardInstanceId).toBe(tyrant.instanceId);

    // Bob casts Counterspell targeting the tyrant.
    state = {
      ...state,
      priorityPlayerIndex: 1,
      players: state.players.map(p =>
        p.id === 'p2' ? { ...p, manaPool: { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 } } : p,
      ),
    };
    state = castSpell(state, 'p2', counter.instanceId, [tyrant.instanceId]);

    // Resolve Counterspell — it must NOT remove the tyrant from the stack.
    state = resolveTopOfStack(state);
    expect(state.cards.get(counter.instanceId)?.zone).toBe('graveyard');
    expect(state.cards.get(tyrant.instanceId)?.zone).toBe('stack');
    expect(state.stack).toHaveLength(1);
    expect(state.stack[0].cardInstanceId).toBe(tyrant.instanceId);

    // Resolve the tyrant — it enters the battlefield.
    state = resolveTopOfStack(state);
    expect(state.cards.get(tyrant.instanceId)?.zone).toBe('battlefield');
  });

  it('control: a plain creature spell IS counterable (goes to graveyard)', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makePlainCreature()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [makeCounterspell()], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const beast = getCardsInZone(state, 'p1', 'library')[0];
    const counter = getCardsInZone(state, 'p2', 'library')[0];
    state.cards.set(beast.instanceId, { ...beast, zone: 'hand' });
    state.cards.set(counter.instanceId, { ...counter, zone: 'hand' });
    state = {
      ...state,
      phase: 'precombat_main' as any,
      players: state.players.map(p =>
        p.id === 'p1' ? { ...p, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 } } : p,
      ),
    };

    state = castSpell(state, 'p1', beast.instanceId);
    expect((state.stack[0] as any).cantBeCountered).toBeFalsy();

    state = {
      ...state,
      priorityPlayerIndex: 1,
      players: state.players.map(p =>
        p.id === 'p2' ? { ...p, manaPool: { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 } } : p,
      ),
    };
    state = castSpell(state, 'p2', counter.instanceId, [beast.instanceId]);
    state = resolveTopOfStack(state);

    expect(state.cards.get(beast.instanceId)?.zone).toBe('graveyard');
    expect(state.stack).toHaveLength(0);
  });
});
