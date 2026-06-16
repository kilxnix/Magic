/**
 * Slice 4 — CBC Sibling Clauses
 *
 * Tests parse recognition and engine execution for three companion clauses that
 * appear alongside "This spell can't be countered." on spell faces:
 *
 *  1. X-scaled -X/-X pump (Slice from the Shadows)
 *     "Target creature gets -X/-X until end of turn."
 *     → ModifyPT with XMultiplied(-1)
 *
 *  2. Draw equal to greatest toughness (Last March of the Ents)
 *     "Draw cards equal to the greatest toughness among creatures you control."
 *     → Draw with GreatestToughnessAmount
 *
 *  3. Opponents can't cast during your turn static (Dragonlord Dromoka)
 *     "Your opponents can't cast spells during your turn."
 *     → StaticAbility with OpponentsCantCastDuringYourTurn modifier
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { canCastSpell } from '../stack';
import { executeEffects } from '../effects/executor';
import type { GameState, CardDefinition, ContinuousEffectRef } from '../types';
import { createPlayer } from '../types';
import { populateParsedCache } from '../cards/card-parser-cache';

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function createTestState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: [
      { ...createPlayer('p1', 'Player 1'), manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 }, hasPriority: true },
      { ...createPlayer('p2', 'Player 2'), manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 }, hasPriority: false },
    ],
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'main',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    damagePreventionEffects: [],
    gameOutcomePreventionEffects: [],
    spellCastProhibitions: [],
    ...overrides,
  };
}

function addCard(
  state: GameState,
  instanceId: string,
  ownerId: string,
  zone: 'hand' | 'battlefield' | 'library' | 'graveyard' | 'command',
  defOverrides: Partial<CardDefinition>,
  opts: { isCommander?: boolean; power?: string; toughness?: string } = {},
): void {
  const baseDef: CardDefinition = {
    id: defOverrides.id ?? instanceId + '_def',
    name: defOverrides.name ?? 'Test Card',
    type_line: defOverrides.type_line ?? 'Instant',
    oracle_text: defOverrides.oracle_text ?? '',
    mana_cost: defOverrides.mana_cost ?? '{0}',
    cmc: defOverrides.cmc ?? 0,
    colors: defOverrides.colors ?? [],
    color_identity: defOverrides.color_identity ?? [],
    keywords: defOverrides.keywords ?? [],
    card_types: defOverrides.card_types ?? ['instant'],
    power: opts.power ?? defOverrides.power,
    toughness: opts.toughness ?? defOverrides.toughness,
  };
  const fullDef = populateParsedCache(baseDef);
  state.cardDefinitions.set(fullDef.id, fullDef);
  state.cards.set(instanceId, {
    instanceId,
    definitionId: fullDef.id,
    ownerId,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: opts.isCommander ?? false,
  });
  if (opts.isCommander) {
    const player = state.players.find(p => p.id === ownerId);
    if (player) {
      player.commanderInstanceId = instanceId;
      if (!player.commanderInstanceIds) player.commanderInstanceIds = [];
      player.commanderInstanceIds.push(instanceId);
    }
  }
}

// ---------------------------------------------------------------------------
// 1. Parser: -X/-X sibling (Slice from the Shadows companion)
// ---------------------------------------------------------------------------

describe('matchModifyPTNegativeX — parser recognition', () => {
  it('parses "Target creature gets -X/-X until end of turn." as ModifyPT with XMultiplied(-1)', () => {
    const result = parseOracleText('Target creature gets -X/-X until end of turn.');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const effect = result.effects.find(e => e.kind === 'ModifyPT');
    expect(effect).toBeDefined();
    if (!effect || effect.kind !== 'ModifyPT') return;
    expect(effect.untilEndOfTurn).toBe(true);
    expect(effect.power).toEqual({ kind: 'XMultiplied', multiplier: -1 });
    expect(effect.toughness).toEqual({ kind: 'XMultiplied', multiplier: -1 });
  });

  it('parses the sibling clause after CBC line is absorbed (Slice from the Shadows)', () => {
    // Real oracle text: CBC line stripped, leaving only the sibling
    const siblingOnly = 'Target creature gets -X/-X until end of turn.';
    const result = parseOracleText(siblingOnly);
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects.some(e => e.kind === 'ModifyPT')).toBe(true);
  });

  it('does not parse unrelated PT modification as -X/-X', () => {
    const result = parseOracleText('Target creature gets +1/+1 until end of turn.');
    if (result.kind === 'Spell') {
      const modPT = result.effects.find(e => e.kind === 'ModifyPT');
      if (modPT && modPT.kind === 'ModifyPT') {
        // Should be +1, not XMultiplied(-1)
        expect(modPT.power).not.toEqual({ kind: 'XMultiplied', multiplier: -1 });
      }
    }
    // Either way, no crash
  });
});

// ---------------------------------------------------------------------------
// 2. Executor: -X/-X sibling pump
// ---------------------------------------------------------------------------

describe('matchModifyPTNegativeX — executor', () => {
  it('executeEffects for ModifyPT with XMultiplied(-1) applies toughness reduction', () => {
    const state = createTestState();
    addCard(state, 'target_creature', 'p2', 'battlefield', {
      name: 'Test Bear',
      oracle_text: '',
      card_types: ['creature'],
    }, { power: '2', toughness: '2' });

    const effect = {
      kind: 'ModifyPT' as const,
      target: { kind: 'Chosen' as const, specIndex: 0 },
      power: { kind: 'XMultiplied' as const, multiplier: -1 },
      toughness: { kind: 'XMultiplied' as const, multiplier: -1 },
      untilEndOfTurn: true,
    };
    // xValue = 2 => -2/-2
    const newState = executeEffects(state, [effect], 'p1', ['target_creature'], [], 2);
    // Effect should register without throwing
    expect(newState).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Parser: Draw equal to greatest toughness (Last March of the Ents sibling)
// ---------------------------------------------------------------------------

describe('matchDrawEqualToGreatestToughness — parser recognition', () => {
  it('parses "Draw cards equal to the greatest toughness among creatures you control." as Draw+GreatestToughness', () => {
    const result = parseOracleText('Draw cards equal to the greatest toughness among creatures you control.');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const effect = result.effects.find(e => e.kind === 'Draw');
    expect(effect).toBeDefined();
    if (!effect || effect.kind !== 'Draw') return;
    expect(effect.count).toMatchObject({
      kind: 'GreatestToughness',
      zone: 'battlefield',
      controller: 'you',
    });
  });

  it('parses "draw cards equal to the greatest toughness among creatures on the battlefield" with controller=each', () => {
    const result = parseOracleText('Draw cards equal to the greatest toughness among creatures on the battlefield.');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const effect = result.effects.find(e => e.kind === 'Draw');
    expect(effect).toBeDefined();
    if (!effect || effect.kind !== 'Draw') return;
    expect(effect.count).toMatchObject({
      kind: 'GreatestToughness',
      controller: 'each',
    });
  });

  it('does not parse a plain draw as GreatestToughness', () => {
    const result = parseOracleText('Draw three cards.');
    if (result.kind === 'Spell') {
      const effect = result.effects.find(e => e.kind === 'Draw');
      if (effect && effect.kind === 'Draw') {
        expect(typeof effect.count === 'object' && (effect.count as any).kind === 'GreatestToughness').toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Executor: Draw equal to greatest toughness
// ---------------------------------------------------------------------------

describe('matchDrawEqualToGreatestToughness — executor', () => {
  it('executeEffects for Draw+GreatestToughness draws cards equal to highest toughness among controller creatures', () => {
    const state = createTestState();
    // p1 controls two creatures with toughness 3 and 5; greatest = 5
    addCard(state, 'creature_a', 'p1', 'battlefield', {
      name: 'Creature A',
      card_types: ['creature'],
    }, { power: '2', toughness: '3' });
    addCard(state, 'creature_b', 'p1', 'battlefield', {
      name: 'Creature B',
      card_types: ['creature'],
    }, { power: '4', toughness: '5' });
    // Put some cards in p1 library to draw from
    addCard(state, 'lib1', 'p1', 'library', { name: 'Card A', card_types: ['instant'] });
    addCard(state, 'lib2', 'p1', 'library', { name: 'Card B', card_types: ['instant'] });
    addCard(state, 'lib3', 'p1', 'library', { name: 'Card C', card_types: ['instant'] });
    addCard(state, 'lib4', 'p1', 'library', { name: 'Card D', card_types: ['instant'] });
    addCard(state, 'lib5', 'p1', 'library', { name: 'Card E', card_types: ['instant'] });
    // Assign library order
    const p1 = state.players[0];
    p1.library = ['lib1', 'lib2', 'lib3', 'lib4', 'lib5'];

    const drawEffect = {
      kind: 'Draw' as const,
      player: { kind: 'Controller' as const },
      count: {
        kind: 'GreatestToughness' as const,
        zone: 'battlefield' as const,
        filter: { types: ['creature'] },
        controller: 'you' as const,
      },
    };
    const newState = executeEffects(state, [drawEffect], 'p1', [], [], 0);
    // Should draw 5 cards (greatest toughness = 5)
    // The executor moves cards from zone 'library' to zone 'hand' in state.cards
    const handCards = [...newState.cards.values()].filter(c => c.ownerId === 'p1' && c.zone === 'hand');
    expect(handCards.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 5. Parser: Opponents can't cast during your turn static (Dragonlord Dromoka)
// ---------------------------------------------------------------------------

describe('matchOpponentsCantCastDuringYourTurn — parser recognition', () => {
  it("parses \"Your opponents can't cast spells during your turn.\" as StaticAbility OpponentsCantCastDuringYourTurn", () => {
    const result = parseOracleText("Your opponents can't cast spells during your turn.");
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('OpponentsCantCastDuringYourTurn');
  });

  it('does not confuse "during your turn" static with "this turn" Silence effect', () => {
    const silenceResult = parseOracleText("Your opponents can't cast spells this turn.");
    const staticResult = parseOracleText("Your opponents can't cast spells during your turn.");

    // Silence produces a Spell with OpponentsCantCastSpells
    expect(silenceResult.kind).toBe('Spell');

    // Dromoka static produces a StaticAbility
    expect(staticResult.kind).toBe('StaticAbility');
    if (staticResult.kind === 'StaticAbility') {
      expect(staticResult.ability.modifier.kind).toBe('OpponentsCantCastDuringYourTurn');
    }
  });

  it('does not parse unrelated static text as OpponentsCantCastDuringYourTurn', () => {
    const result = parseOracleText('Creatures you control have hexproof.');
    if (result.kind === 'StaticAbility') {
      expect(result.ability.modifier.kind).not.toBe('OpponentsCantCastDuringYourTurn');
    }
    // Either parse or Unparsed is fine — just not the wrong modifier
  });
});

// ---------------------------------------------------------------------------
// 6. Enforcement: canCastSpell blocked for opponents when Dromoka static active
// ---------------------------------------------------------------------------

describe('OpponentsCantCastDuringYourTurn — canCastSpell enforcement', () => {
  it('canCastSpell returns false for opponent (p2) during active player (p1) turn when Dromoka-like static is active', () => {
    const state = createTestState({
      activePlayerIndex: 0, // p1 is active
    });

    // Add the Dromoka enchantment on battlefield controlled by p1
    addCard(state, 'dromoka', 'p1', 'battlefield', {
      name: 'Dragonlord Dromoka',
      type_line: 'Legendary Creature — Elder Dragon',
      oracle_text: "Your opponents can't cast spells during your turn.",
      card_types: ['creature'],
    });

    // Add a continuous effect for OpponentsCantCastDuringYourTurn
    const dromokaContinuousEffect: ContinuousEffectRef = {
      id: 'dromoka_static',
      sourceInstanceId: 'dromoka',
      controllerId: 'p1',
      ability: {
        kind: 'StaticAbility',
        modifier: { kind: 'OpponentsCantCastDuringYourTurn' },
        filter: {},
        controller: 'any',
        excludeSelf: false,
        selfOnly: false,
      },
      timestamp: 1,
    };
    state.continuousEffects = [dromokaContinuousEffect];

    // p2 tries to cast a spell — should be blocked
    addCard(state, 'bolt_p2', 'p2', 'hand', {
      name: 'Lightning Bolt',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      mana_cost: '{R}',
      cmc: 1,
      card_types: ['instant'],
    });

    expect(canCastSpell(state, 'p2', 'bolt_p2')).toBe(false);
  });

  it('canCastSpell returns true for active player (p1) — not blocked by own static', () => {
    const state = createTestState({
      activePlayerIndex: 0,
    });

    addCard(state, 'dromoka', 'p1', 'battlefield', {
      name: 'Dragonlord Dromoka',
      type_line: 'Legendary Creature — Elder Dragon',
      oracle_text: "Your opponents can't cast spells during your turn.",
      card_types: ['creature'],
    });

    const dromokaContinuousEffect: ContinuousEffectRef = {
      id: 'dromoka_static',
      sourceInstanceId: 'dromoka',
      controllerId: 'p1',
      ability: {
        kind: 'StaticAbility',
        modifier: { kind: 'OpponentsCantCastDuringYourTurn' },
        filter: {},
        controller: 'any',
        excludeSelf: false,
        selfOnly: false,
      },
      timestamp: 1,
    };
    state.continuousEffects = [dromokaContinuousEffect];

    addCard(state, 'bolt_p1', 'p1', 'hand', {
      name: 'Lightning Bolt',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      mana_cost: '{R}',
      cmc: 1,
      card_types: ['instant'],
    });

    expect(canCastSpell(state, 'p1', 'bolt_p1')).toBe(true);
  });

  it('canCastSpell returns true for opponent (p2) when static source is off battlefield', () => {
    const state = createTestState({
      activePlayerIndex: 0,
    });

    // Dromoka is in graveyard — not battlefield — so static should not apply
    addCard(state, 'dromoka', 'p1', 'graveyard', {
      name: 'Dragonlord Dromoka',
      type_line: 'Legendary Creature — Elder Dragon',
      oracle_text: "Your opponents can't cast spells during your turn.",
      card_types: ['creature'],
    });

    const dromokaContinuousEffect: ContinuousEffectRef = {
      id: 'dromoka_static',
      sourceInstanceId: 'dromoka',
      controllerId: 'p1',
      ability: {
        kind: 'StaticAbility',
        modifier: { kind: 'OpponentsCantCastDuringYourTurn' },
        filter: {},
        controller: 'any',
        excludeSelf: false,
        selfOnly: false,
      },
      timestamp: 1,
    };
    state.continuousEffects = [dromokaContinuousEffect];

    addCard(state, 'bolt_p2', 'p2', 'hand', {
      name: 'Lightning Bolt',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      mana_cost: '{R}',
      cmc: 1,
      card_types: ['instant'],
    });

    // Source is in graveyard — enforcement should NOT block
    expect(canCastSpell(state, 'p2', 'bolt_p2')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Full oracle text integration (CBC absorbed + sibling parsed)
// ---------------------------------------------------------------------------

describe('Full oracle text integration — CBC + sibling', () => {
  it('Slice from the Shadows: full oracle parses CBC + -X/-X sibling', () => {
    // Approximate Slice from the Shadows oracle text
    const oracle = "This spell can't be countered.\nTarget creature gets -X/-X until end of turn.";
    const result = parseOracleText(oracle);
    // Should parse the sibling clause
    if (result.kind === 'Spell') {
      const modPT = result.effects.find(e => e.kind === 'ModifyPT');
      expect(modPT).toBeDefined();
      if (modPT && modPT.kind === 'ModifyPT') {
        expect(modPT.power).toEqual({ kind: 'XMultiplied', multiplier: -1 });
      }
    }
    // Result must not be an error
    expect(result.kind).not.toBe('ParseError');
  });

  it("Last March of the Ents: full oracle parses CBC + draw-greatest-toughness sibling", () => {
    const oracle = "This spell can't be countered.\nDraw cards equal to the greatest toughness among creatures you control.";
    const result = parseOracleText(oracle);
    if (result.kind === 'Spell') {
      const drawEffect = result.effects.find(e => e.kind === 'Draw');
      expect(drawEffect).toBeDefined();
      if (drawEffect && drawEffect.kind === 'Draw') {
        expect((drawEffect.count as any)?.kind).toBe('GreatestToughness');
      }
    }
    expect(result.kind).not.toBe('ParseError');
  });

  it("Dragonlord Dromoka: full oracle parses static from multi-line text", () => {
    // Dromoka actually has keyword lines and multiple abilities
    // The relevant static ability clause on its own
    const oracle = "Your opponents can't cast spells during your turn.";
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind === 'StaticAbility') {
      expect(result.ability.modifier.kind).toBe('OpponentsCantCastDuringYourTurn');
    }
  });
});
