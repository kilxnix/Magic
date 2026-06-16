/**
 * Slice 5: Transform — Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun
 *
 * Tests two bugs:
 *   (1) TYPING: The front face ("Legendary Enchantment") must NOT leak the
 *       combined "Legendary Enchantment // Legendary Land" type_line onto
 *       the battlefield.
 *   (2) FLIP: "At the beginning of your end step, if you control four or more
 *       creatures, transform Growing Rites of Itlimoc." — triggers correctly at
 *       end step, transforms when creature count >= 4, does NOT transform when
 *       count < 4, and the back face (Itlimoc, Cradle of the Sun) produces {G}
 *       via its mana ability after the flip.
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState } from '../game-state';
import { getCardDefinition } from '../game-state';
import {
  registerBattlefieldAbilities,
  putTriggersOnStack,
  resolveTopOfStack,
  checkTriggersForEvent,
} from '../stack';
import { tapLandForMana } from '../actions';
import type { CardDefinition, CardDefinitionFace, GameState, CardInstance } from '../types';
import { convertCard } from '../cards/deck-loader';
import type { ScryfallCard } from '../cards/deck-loader';

// ---------------------------------------------------------------------------
// Card fixtures
// ---------------------------------------------------------------------------

const GROWING_RITES_SCRYFALL: ScryfallCard = {
  id: 'growing-rites-id',
  name: 'Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun',
  // Combined type_line — this is what Scryfall gives at the top level.
  type_line: 'Legendary Enchantment // Legendary Land',
  // Scryfall may include oracle_text at top level for transform cards —
  // this is exactly the scenario that triggers Bug 1.
  oracle_text: 'When Growing Rites of Itlimoc enters the battlefield, look at the top four cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in any order.\nAt the beginning of your end step, if you control four or more creatures, transform Growing Rites of Itlimoc.',
  mana_cost: '{3}{G}',
  cmc: 4,
  colors: ['G'],
  color_identity: ['G'],
  keywords: ['Transform'],
  layout: 'transform',
  card_faces: [
    {
      name: 'Growing Rites of Itlimoc',
      type_line: 'Legendary Enchantment',
      oracle_text: 'When Growing Rites of Itlimoc enters the battlefield, look at the top four cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in any order.\nAt the beginning of your end step, if you control four or more creatures, transform Growing Rites of Itlimoc.',
      mana_cost: '{3}{G}',
      colors: ['G'],
    },
    {
      name: 'Itlimoc, Cradle of the Sun',
      type_line: 'Legendary Land',
      oracle_text: '{T}: Add {G}.\n{T}: Add {G} for each creature you control.',
      mana_cost: '',
      colors: [],
    },
  ],
};

/** Build the CardDefinition as the engine would from Scryfall data. */
function makeGrowingRitesDef(): CardDefinition {
  return convertCard(GROWING_RITES_SCRYFALL);
}

function makeCreatureDef(id: string): CardDefinition {
  return {
    id,
    name: `Creature-${id}`,
    type_line: 'Creature — Beast',
    oracle_text: '',
    mana_cost: '{G}',
    cmc: 1,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
  };
}

function createGame(p1Cards: CardDefinition[]): GameState {
  return initGameState([
    { playerId: 'p1', name: 'Player 1', cards: p1Cards, commanderId: 'nonexistent-cmd' },
    { playerId: 'p2', name: 'Player 2', cards: [], commanderId: 'nonexistent-cmd-2' },
  ]);
}

function findCard(state: GameState, defId: string): CardInstance | undefined {
  for (const c of state.cards.values()) {
    if (c.definitionId === defId) return c;
  }
  return undefined;
}

function moveToBattlefield(state: GameState, instanceId: string): GameState {
  const card = state.cards.get(instanceId);
  if (!card) throw new Error('Card not found: ' + instanceId);
  const newCards = new Map(state.cards);
  newCards.set(instanceId, { ...card, zone: 'battlefield', summoningSick: false });
  return { ...state, cards: newCards };
}

function countCreatures(state: GameState, playerId: string): number {
  let n = 0;
  for (const c of state.cards.values()) {
    if (c.ownerId === playerId && c.zone === 'battlefield') {
      const def = getCardDefinition(state, c);
      if (def.card_types.includes('creature')) n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Bug 1: Typing
// ---------------------------------------------------------------------------

describe('Transform typing — Bug 1: front face type_line', () => {
  it('convertCard uses front face type_line "Legendary Enchantment", not the combined form', () => {
    const def = makeGrowingRitesDef();
    // The top-level type_line must be the FRONT FACE only.
    expect(def.type_line).toBe('Legendary Enchantment');
    expect(def.card_types).toContain('enchantment');
    expect(def.card_types).not.toContain('land');
  });

  it('getCardDefinition returns front-face type_line for unflipped card on battlefield', () => {
    const def = makeGrowingRitesDef();
    const state = createGame([def]);
    const inst = findCard(state, def.id)!;
    const bfState = moveToBattlefield(state, inst.instanceId);
    const resolvedDef = getCardDefinition(bfState, bfState.cards.get(inst.instanceId)!);
    expect(resolvedDef.type_line).toBe('Legendary Enchantment');
    expect(resolvedDef.card_types).not.toContain('land');
  });

  it('getCardDefinition returns back-face type_line for flipped card', () => {
    const def = makeGrowingRitesDef();
    const state = createGame([def]);
    const inst = findCard(state, def.id)!;
    let bfState = moveToBattlefield(state, inst.instanceId);
    // Manually flip by setting activeFaceName.
    const newCards = new Map(bfState.cards);
    newCards.set(inst.instanceId, { ...bfState.cards.get(inst.instanceId)!, activeFaceName: 'Itlimoc, Cradle of the Sun' });
    bfState = { ...bfState, cards: newCards };
    const resolvedDef = getCardDefinition(bfState, bfState.cards.get(inst.instanceId)!);
    expect(resolvedDef.type_line).toBe('Legendary Land');
    expect(resolvedDef.card_types).toContain('land');
  });

  it('faces array has two entries: front (Enchantment) and back (Land)', () => {
    const def = makeGrowingRitesDef();
    expect(def.faces).toHaveLength(2);
    expect(def.faces![0].name).toBe('Growing Rites of Itlimoc');
    expect(def.faces![0].card_types).toContain('enchantment');
    expect(def.faces![0].card_types).not.toContain('land');
    expect(def.faces![1].name).toBe('Itlimoc, Cradle of the Sun');
    expect(def.faces![1].card_types).toContain('land');
  });
});

// ---------------------------------------------------------------------------
// Bug 2 parsing: "if you control four or more creatures, transform ~"
// ---------------------------------------------------------------------------

describe('Transform parse — Bug 2: oracle text parsing', () => {
  it('parses "At the beginning of your end step, if you control four or more creatures, transform ~." as Triggered/EndStep', () => {
    const line = 'At the beginning of your end step, if you control four or more creatures, transform ~.';
    const parsed = parseOracleText(line);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger.kind).toBe('EndStep');
    expect((parsed.ability.trigger as { kind: 'EndStep'; whose: string }).whose).toBe('yours');
    // The effect must be Conditional wrapping TransformSelf.
    expect(parsed.ability.effects).toHaveLength(1);
    const effect = parsed.ability.effects[0] as { kind: string; condition?: { kind: string; count?: number }; effect?: { kind: string } };
    expect(effect.kind).toBe('Conditional');
    expect(effect.condition?.kind).toBe('CardsInZoneAtLeast');
    expect(effect.condition?.count).toBe(4);
    expect(effect.effect?.kind).toBe('TransformSelf');
  });

  it('parses an upkeep trigger "if you control three or more artifacts, transform ~." as conditional TransformSelf', () => {
    // A bare conditional WITHOUT a trigger prefix parses as a Spell effect clause —
    // only with a prefix like "At the beginning of your upkeep" does it become Triggered.
    const line = 'At the beginning of your upkeep, if you control three or more artifacts, transform ~.';
    const parsed = parseOracleText(line);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger.kind).toBe('Upkeep');
    const effect = parsed.ability.effects[0] as { kind: string; condition?: { kind: string; count?: number }; effect?: { kind: string } };
    expect(effect.kind).toBe('Conditional');
    expect(effect.condition?.count).toBe(3);
    expect(effect.effect?.kind).toBe('TransformSelf');
  });

  it('parses "transform ~" standalone as TransformSelf', () => {
    const parsed = parseOracleText('transform ~.');
    // standalone transform ~ is an effect clause — may parse as Triggered or effect-only
    // depending on prefix. Just check it produces a TransformSelf somewhere.
    const text = JSON.stringify(parsed);
    expect(text).toContain('TransformSelf');
  });
});

// ---------------------------------------------------------------------------
// Bug 2 execution: end-step flip logic
// ---------------------------------------------------------------------------

describe('Transform execution — Bug 2: flip at end step', () => {
  /**
   * Helper: set up Growing Rites on p1's battlefield plus N creature tokens.
   * Register battlefield abilities, then fire the end step event.
   */
  function setupAndFireEndStep(creatureCount: number): { state: GameState; ritesId: string } {
    const rites = makeGrowingRitesDef();
    const creatures = Array.from({ length: creatureCount }, (_, i) => makeCreatureDef(`beast-${i}`));
    const allCards = [rites, ...creatures];

    let state = createGame(allCards);

    // Move everything to battlefield.
    for (const c of state.cards.values()) {
      state = moveToBattlefield(state, c.instanceId);
    }

    // Register battlefield abilities for Growing Rites.
    const ritesInst = findCard(state, rites.id)!;
    state = registerBattlefieldAbilities(state, ritesInst.instanceId);

    // Fire end step event.
    state = { ...state, phase: 'ending', step: 'end', activePlayerIndex: 0, priorityPlayerIndex: 0 };
    state = checkTriggersForEvent(state, { kind: 'EndStepStart', activePlayerId: 'p1' });

    return { state, ritesId: rites.id };
  }

  it('does NOT transform when fewer than 4 creatures (3 creatures)', () => {
    const { state: stateAfterEvent, ritesId } = setupAndFireEndStep(3);
    expect(stateAfterEvent.pendingTriggers).toHaveLength(1);

    let state = stateAfterEvent;
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    const ritesInst = findCard(state, ritesId)!;
    const resolved = getCardDefinition(state, state.cards.get(ritesInst.instanceId)!);
    // Should still be front face (Enchantment) because condition fails.
    expect(resolved.card_types).not.toContain('land');
    expect(resolved.type_line).toBe('Legendary Enchantment');
  });

  it('transforms when 4 or more creatures are controlled', () => {
    const { state: stateAfterEvent, ritesId } = setupAndFireEndStep(4);
    expect(stateAfterEvent.pendingTriggers).toHaveLength(1);

    let state = stateAfterEvent;
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    const ritesInst = findCard(state, ritesId)!;
    const card = state.cards.get(ritesInst.instanceId)!;
    // activeFaceName should be the back face.
    expect(card.activeFaceName).toBe('Itlimoc, Cradle of the Sun');
    const resolved = getCardDefinition(state, card);
    expect(resolved.type_line).toBe('Legendary Land');
    expect(resolved.card_types).toContain('land');
  });

  it('tapping Itlimoc (after flip) for {G} works via mana ability', () => {
    const { state: stateAfterEvent, ritesId } = setupAndFireEndStep(4);
    let state = stateAfterEvent;
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    const ritesInst = findCard(state, ritesId)!;
    const card = state.cards.get(ritesInst.instanceId)!;
    expect(card.activeFaceName).toBe('Itlimoc, Cradle of the Sun');

    // Tap the transformed Itlimoc for {G}.
    const beforeG = state.players.find(p => p.id === 'p1')!.manaPool.G;
    state = tapLandForMana(state, 'p1', ritesInst.instanceId, 'G');
    const afterG = state.players.find(p => p.id === 'p1')!.manaPool.G;
    // Should have produced at least 1 {G}.
    expect(afterG).toBeGreaterThan(beforeG);
  });

  it('is idempotent: a second end step with 4 creatures does not error', () => {
    const { state: stateAfterEvent, ritesId } = setupAndFireEndStep(4);
    let state = stateAfterEvent;
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    // Fire end step again.
    state = { ...state, pendingTriggers: [] };
    state = checkTriggersForEvent(state, { kind: 'EndStepStart', activePlayerId: 'p1' });
    if (state.pendingTriggers.length > 0) {
      state = putTriggersOnStack(state);
      state = resolveTopOfStack(state);
    }
    // Still on back face — no error, no state corruption.
    const ritesInst = findCard(state, ritesId)!;
    const card = state.cards.get(ritesInst.instanceId)!;
    expect(card.activeFaceName).toBe('Itlimoc, Cradle of the Sun');
  });
});
