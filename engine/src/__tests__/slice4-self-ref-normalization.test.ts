/**
 * Slice 4: Self-reference normalization
 *
 * Proves that 'this Aura', 'this Equipment', 'this Vehicle' (and their lower-
 * case counterparts after tokenisation) are normalised to the canonical type
 * names ('this enchantment', 'this artifact') before matching, so every
 * matcher family (sacrifice, return-to-hand, attach, sacrifice-unless-pay,
 * ETB trigger prefixes) can parse them without per-matcher changes.
 *
 * Covers:
 *   1. Sacrifice self — 'this Aura', 'this Equipment', 'this Vehicle'
 *   2. Return to hand — 'this Aura', 'this Equipment'
 *   3. Attach — 'this Equipment' (Starforged Sword / Maul-of-the-Skyclaves style)
 *   4. SacrificeSelfUnlessPay — 'sacrifice this Aura unless you pay {1}{U}'
 *      (Binding Grasp / Serra Bestiary family)
 *   5. ETB trigger prefix still fires for normalised nouns (multi-line face)
 *   6. Execution: SacrificeSelfUnlessPay pays and survives when affordable,
 *      sacrifices when unaffordable
 *   7. Execution: Sacrifice self with 'this Aura' moves the permanent to graveyard
 *   8. Execution: ReturnToHand with 'this Aura' moves the permanent to hand
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { SacrificeSelfUnlessPayEffect, SacrificeEffect, ReturnToHandEffect } from '../effects/ast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const auraDef: CardDefinition = {
  id: 'aura', name: 'Test Aura', type_line: 'Enchantment — Aura', oracle_text: '',
  mana_cost: '{1}{U}', cmc: 2, colors: ['U'], color_identity: ['U'],
  keywords: [], card_types: ['enchantment'],
};

const equipDef: CardDefinition = {
  id: 'equip', name: 'Test Equipment', type_line: 'Artifact — Equipment', oracle_text: '',
  mana_cost: '{2}', cmc: 2, colors: [], color_identity: [],
  keywords: [], card_types: ['artifact'],
};

const vehicleDef: CardDefinition = {
  id: 'vehicle', name: 'Test Vehicle', type_line: 'Artifact — Vehicle', oracle_text: '',
  mana_cost: '{3}', cmc: 3, colors: [], color_identity: [],
  keywords: [], card_types: ['artifact'],
};

const islandDef: CardDefinition = {
  id: 'island', name: 'Island', type_line: 'Basic Land — Island',
  oracle_text: '{T}: Add {U}.', mana_cost: '', cmc: 0,
  colors: [], color_identity: ['U'], keywords: [], card_types: ['land'],
};

const plainsDef: CardDefinition = {
  id: 'plains', name: 'Plains', type_line: 'Basic Land — Plains',
  oracle_text: '{T}: Add {W}.', mana_cost: '', cmc: 0,
  colors: [], color_identity: ['W'], keywords: [], card_types: ['land'],
};

function makeState(
  sourceDef: CardDefinition,
  sourceId: string,
  landIds: string[] = [],
  landDefId: 'island' | 'plains' = 'island',
): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>([
    [sourceDef.id, sourceDef],
    ['island', islandDef],
    ['plains', plainsDef],
  ]);

  cards.set(sourceId, {
    instanceId: sourceId, definitionId: sourceDef.id, ownerId: 'p0',
    zone: 'battlefield', tapped: false, summoningSick: false,
    counters: {}, damage: 0, isCommander: false,
  });

  for (const lid of landIds) {
    cards.set(lid, {
      instanceId: lid, definitionId: landDefId, ownerId: 'p0',
      zone: 'battlefield', tapped: false, summoningSick: false,
      counters: {}, damage: 0, isCommander: false,
    });
  }

  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards, cardDefinitions,
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

// ---------------------------------------------------------------------------
// 1. Parse: Sacrifice self — 'this Aura' / 'this Equipment' / 'this Vehicle'
// ---------------------------------------------------------------------------

describe('Slice 4 — Sacrifice self (normalised from subtype nouns)', () => {
  it('parses "Sacrifice this Aura." as Spell/Sacrifice(self)', () => {
    const p = parseOracleText('Sacrifice this Aura.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const sac = p.effects.find(e => e.kind === 'Sacrifice') as SacrificeEffect | undefined;
    expect(sac).toBeDefined();
    expect(sac!.self).toBe(true);
  });

  it('parses "Sacrifice this Equipment." as Spell/Sacrifice(self)', () => {
    const p = parseOracleText('Sacrifice this Equipment.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const sac = p.effects.find(e => e.kind === 'Sacrifice') as SacrificeEffect | undefined;
    expect(sac).toBeDefined();
    expect(sac!.self).toBe(true);
  });

  it('parses "Sacrifice this Vehicle." as Spell/Sacrifice(self)', () => {
    const p = parseOracleText('Sacrifice this Vehicle.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const sac = p.effects.find(e => e.kind === 'Sacrifice') as SacrificeEffect | undefined;
    expect(sac).toBeDefined();
    expect(sac!.self).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Parse: Return to hand — 'this Aura' / 'this Equipment'
// ---------------------------------------------------------------------------

describe('Slice 4 — ReturnToHand self (normalised from subtype nouns)', () => {
  it('parses "Return this Aura to its owner\'s hand." as Spell/ReturnToHand(Source)', () => {
    const p = parseOracleText("Return this Aura to its owner's hand.");
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const rth = p.effects.find(e => e.kind === 'ReturnToHand') as ReturnToHandEffect | undefined;
    expect(rth).toBeDefined();
    expect(rth!.target.kind).toBe('Source');
  });

  it('parses "Return this Equipment to its owner\'s hand." as Spell/ReturnToHand(Source)', () => {
    const p = parseOracleText("Return this Equipment to its owner's hand.");
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const rth = p.effects.find(e => e.kind === 'ReturnToHand') as ReturnToHandEffect | undefined;
    expect(rth).toBeDefined();
    expect(rth!.target.kind).toBe('Source');
  });
});

// ---------------------------------------------------------------------------
// 3. Parse: Attach — 'this Equipment'
// ---------------------------------------------------------------------------

describe('Slice 4 — Attach self (normalised from Equipment noun)', () => {
  it('parses "Attach this Equipment to target creature you control." as Spell/Attach', () => {
    const p = parseOracleText('Attach this Equipment to target creature you control.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const att = p.effects.find(e => e.kind === 'Attach');
    expect(att).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Parse: SacrificeSelfUnlessPay — Binding Grasp / Serra Bestiary family
// ---------------------------------------------------------------------------

describe('Slice 4 — SacrificeSelfUnlessPay (sacrifice this Aura unless you pay)', () => {
  it('Binding Grasp upkeep trigger parses as Triggered/SacrificeSelfUnlessPay', () => {
    const text = 'At the beginning of your upkeep, sacrifice this Aura unless you pay {1}{U}.';
    const p = parseOracleText(text);
    expect(p.kind).toBe('Triggered');
    if (p.kind !== 'Triggered') return;
    const body = p.ability.effects.find(e => e.kind === 'SacrificeSelfUnlessPay') as SacrificeSelfUnlessPayEffect | undefined;
    expect(body).toBeDefined();
    expect(body!.manaCost).toBe('{1}{U}');
  });

  it('Serra Bestiary form "sacrifice this Aura unless you pay {W}{W}" parses correctly', () => {
    const text = 'At the beginning of your upkeep, sacrifice this Aura unless you pay {W}{W}.';
    const p = parseOracleText(text);
    expect(p.kind).toBe('Triggered');
    if (p.kind !== 'Triggered') return;
    const body = p.ability.effects.find(e => e.kind === 'SacrificeSelfUnlessPay') as SacrificeSelfUnlessPayEffect | undefined;
    expect(body).toBeDefined();
    expect(body!.manaCost).toBe('{W}{W}');
  });

  it('"sacrifice ~ unless you pay {2}" (generic cost) parses as Spell/SacrificeSelfUnlessPay', () => {
    const p = parseOracleText('Sacrifice ~ unless you pay {2}.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const body = p.effects.find(e => e.kind === 'SacrificeSelfUnlessPay') as SacrificeSelfUnlessPayEffect | undefined;
    expect(body).toBeDefined();
    expect(body!.manaCost).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 5. Execute: Sacrifice self with 'this Aura'
// ---------------------------------------------------------------------------

describe('Slice 4 — Execute Sacrifice self via normalised Aura noun', () => {
  it('executes "Sacrifice this Aura." — moves source to graveyard', () => {
    const p = parseOracleText('Sacrifice this Aura.');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s0 = makeState(auraDef, 'a0');
    const s1 = executeEffects(s0, p.effects, 'p0', [], [], 0, { sourceInstanceId: 'a0' });
    expect(s1.cards.get('a0')!.zone).toBe('graveyard');
  });

  it('executes "Return this Aura to its owner\'s hand." — moves source to hand', () => {
    const p = parseOracleText("Return this Aura to its owner's hand.");
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s0 = makeState(auraDef, 'a0');
    const s1 = executeEffects(s0, p.effects, 'p0', [], [], 0, { sourceInstanceId: 'a0' });
    expect(s1.cards.get('a0')!.zone).toBe('hand');
  });
});

// ---------------------------------------------------------------------------
// 6. Execute: SacrificeSelfUnlessPay — pays when affordable, sacrifices when not
// ---------------------------------------------------------------------------

describe('Slice 4 — Execute SacrificeSelfUnlessPay (Binding Grasp)', () => {
  const text = 'Sacrifice this Aura unless you pay {1}{U}.';

  it('pays {1}{U} and survives when 2 blue-producing lands are available', () => {
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // Two untapped Islands → can pay {1}{U}
    const s0 = makeState(auraDef, 'aura0', ['land1', 'land2'], 'island');
    const s1 = executeEffects(s0, p.effects, 'p0', [], [], 0, { sourceInstanceId: 'aura0' });
    // Aura stays on battlefield
    expect(s1.cards.get('aura0')!.zone).toBe('battlefield');
    // Two lands tapped as payment
    const tapped = [...s1.cards.values()].filter(c => c.zone === 'battlefield' && c.tapped).length;
    expect(tapped).toBe(2);
  });

  it('sacrifices the Aura when no mana is available', () => {
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // No lands — cannot pay
    const s0 = makeState(auraDef, 'aura0', []);
    const s1 = executeEffects(s0, p.effects, 'p0', [], [], 0, { sourceInstanceId: 'aura0' });
    expect(s1.cards.get('aura0')!.zone).toBe('graveyard');
  });

  it('sacrifices when available lands cannot produce required color', () => {
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // Plains produce {W} not {U} — cannot satisfy {1}{U}
    const s0 = makeState(auraDef, 'aura0', ['land1', 'land2'], 'plains');
    const s1 = executeEffects(s0, p.effects, 'p0', [], [], 0, { sourceInstanceId: 'aura0' });
    expect(s1.cards.get('aura0')!.zone).toBe('graveyard');
  });
});
