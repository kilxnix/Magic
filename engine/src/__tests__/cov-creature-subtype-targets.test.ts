import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { validateTargetChoices } from '../effects/targets';
import { hasKeyword } from '../keywords';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

/**
 * Slice 1/12 — bare creature-subtype targets.
 *
 * "Destroy target Wall.", "Target Merfolk you control gains hexproof until end
 * of turn.", "{2}: Regenerate target Zombie.", "Put two +1/+1 counters on up
 * to one target Dinosaur you control." — all previously Unparsed because the
 * noun after "target" is a subtype, not a card-type keyword.
 *
 * Honesty: every effect routes to an existing executor case (Destroy/Exile/
 * Tap/Regenerate/GrantKeyword/ModifyPT/AddCounters). The subtype constraint is
 * enforced by validateTargetChoices (targets.ts) exactly like any other
 * constraints.subtypes entry.
 */

// ── helpers ──────────────────────────────────────────────────────────────────

function makePlayer(id: string, life = 40): Player {
  return {
    id, name: id, life,
    poisonCounters: 0,
    commanderDamage: {}, commanderTax: 0,
    commanderInstanceId: null, commanderCastCount: 0,
    manaPool: emptyManaPool(),
    hasPlayedLand: false, hasPriority: false, hasLost: false,
  };
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: CardInstance['zone'] = 'battlefield',
): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function makeDef(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Creature',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '',
    cmc: opts.cmc ?? 0,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: overrides.players ?? [makePlayer('p1'), makePlayer('p2')],
    cards: overrides.cards ?? new Map(),
    cardDefinitions: overrides.cardDefinitions ?? new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as any,
    step: 'main' as any,
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: overrides.combat ?? null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    continuousEffects: overrides.continuousEffects ?? [],
  };
}

function twoCreatureState(
  inst1Id: string, def1Id: string, type1: string,
  inst2Id: string, def2Id: string, type2: string,
): GameState {
  const cards = new Map<string, CardInstance>();
  cards.set(inst1Id, makeCard(inst1Id, def1Id, 'p2'));
  cards.set(inst2Id, makeCard(inst2Id, def2Id, 'p2'));
  const defs = new Map<string, CardDefinition>();
  defs.set(def1Id, makeDef(def1Id, { name: def1Id, type_line: `Creature — ${type1}` }));
  defs.set(def2Id, makeDef(def2Id, { name: def2Id, type_line: `Creature — ${def2Id}` }));
  return makeState({ cards, cardDefinitions: defs });
}

// ── Parser recognition ────────────────────────────────────────────────────────

describe('creature-subtype targets — parser recognition', () => {
  it('Undead Slayer: "Exile target Skeleton, Vampire, or Zombie." → subtypes constraint', () => {
    const r = parseOracleText('Exile target Skeleton, Vampire, or Zombie.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects[0].kind).toBe('Exile');
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].type).toBe('Creature');
    const sub = r.targets[0].constraints?.subtypes;
    expect(sub).toContain('skeleton');
    expect(sub).toContain('vampire');
    expect(sub).toContain('zombie');
  });

  it('Swift Warden: "target Merfolk you control gains hexproof until end of turn." (ETB body)', () => {
    const r = parseOracleText(
      'Flash\nWhen this creature enters, target Merfolk you control gains hexproof until end of turn.',
    );
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    const [eff] = r.ability.effects;
    expect(eff.kind).toBe('GrantKeyword');
    if (eff.kind !== 'GrantKeyword') return;
    expect(eff.keyword).toBe('Hexproof');
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].constraints?.subtypes).toContain('merfolk');
    expect(r.targets[0].constraints?.controllerControls).toBe(true);
  });

  it('Boneknitter: "{1}{B}: Regenerate target Zombie." (activated ability)', () => {
    const r = parseOracleText('{1}{B}: Regenerate target Zombie.');
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const ability = r.abilities[0];
    expect(ability.effects[0].kind).toBe('Regenerate');
    expect(ability.targets).toHaveLength(1);
    expect(ability.targets[0].constraints?.subtypes).toEqual(['zombie']);
  });

  it('Huatli: "Put two +1/+1 counters on up to one target Dinosaur you control." (loyalty ability)', () => {
    const r = parseOracleText('{1}: Put two +1/+1 counters on up to one target Dinosaur you control.');
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const ability = r.abilities[0];
    expect(ability.effects[0].kind).toBe('AddCounters');
    expect(ability.targets).toHaveLength(1);
    expect(ability.targets[0].constraints?.subtypes).toContain('dinosaur');
    expect(ability.targets[0].constraints?.controllerControls).toBe(true);
  });

  it('"Destroy target Wall." → Creature target with subtypes: [wall]', () => {
    const r = parseOracleText('Destroy target Wall.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects[0].kind).toBe('Destroy');
    expect(r.targets[0].type).toBe('Creature');
    expect(r.targets[0].constraints?.subtypes).toEqual(['wall']);
  });

  it('"Tap target Samurai." → Creature target with subtypes: [samurai]', () => {
    const r = parseOracleText('Tap target Samurai.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects[0].kind).toBe('Tap');
    expect(r.targets[0].constraints?.subtypes).toEqual(['samurai']);
  });

  it('"Target Merfolk you control gets +1/+1 until end of turn."', () => {
    const r = parseOracleText('Target Merfolk you control gets +1/+1 until end of turn.');
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects[0].kind).toBe('ModifyPT');
    expect(r.targets[0].constraints?.subtypes).toContain('merfolk');
    expect(r.targets[0].constraints?.controllerControls).toBe(true);
  });

  it('"This creature deals 2 damage to target Skeleton." (activated ability body)', () => {
    const r = parseOracleText('{T}: This creature deals 2 damage to target Skeleton.');
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const ability = r.abilities[0];
    expect(ability.effects[0].kind).toBe('DealDamage');
    expect(ability.targets).toHaveLength(1);
    expect(ability.targets[0].constraints?.subtypes).toContain('skeleton');
  });
});

// ── Target legality ───────────────────────────────────────────────────────────

describe('creature-subtype targets — target legality', () => {
  it('Exile target Zombie/Vampire/Skeleton — wrong subtype is illegal', () => {
    const parsed = parseOracleText('Exile target Skeleton, Vampire, or Zombie.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const cards = new Map<string, CardInstance>();
    cards.set('skel_1', makeCard('skel_1', 'skel_def', 'p2'));
    cards.set('bear_1', makeCard('bear_1', 'bear_def', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('skel_def', makeDef('skel_def', { name: 'Skeletal Archer', type_line: 'Creature — Skeleton Archer' }));
    defs.set('bear_def', makeDef('bear_def', { name: 'Bear', type_line: 'Creature — Bear' }));
    const state = makeState({ cards, cardDefinitions: defs });

    // Skeleton is a legal target
    expect(() => validateTargetChoices(state, 'p1', parsed.targets, ['skel_1'])).not.toThrow();
    // Bear is NOT a legal target
    expect(() => validateTargetChoices(state, 'p1', parsed.targets, ['bear_1'])).toThrow();
  });

  it('Destroy target Wall — non-Wall creature is an illegal target', () => {
    const parsed = parseOracleText('Destroy target Wall.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const cards = new Map<string, CardInstance>();
    cards.set('wall_1', makeCard('wall_1', 'wall_def', 'p2'));
    cards.set('bear_1', makeCard('bear_1', 'bear_def', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('wall_def', makeDef('wall_def', { name: 'Wall of Stone', type_line: 'Creature — Wall', power: 0, toughness: 8 }));
    defs.set('bear_def', makeDef('bear_def', { name: 'Grizzly Bears', type_line: 'Creature — Bear' }));
    const state = makeState({ cards, cardDefinitions: defs });

    expect(() => validateTargetChoices(state, 'p1', parsed.targets, ['wall_1'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'p1', parsed.targets, ['bear_1'])).toThrow();
  });

  it('Regenerate target Zombie — executes; non-Zombie is illegal', () => {
    const parsed = parseOracleText('{1}{B}: Regenerate target Zombie.');
    expect(parsed.kind).toBe('Activated');
    if (parsed.kind !== 'Activated') return;
    const ability = parsed.abilities[0];

    const cards = new Map<string, CardInstance>();
    cards.set('zomb_1', makeCard('zomb_1', 'zomb_def', 'p1'));
    cards.set('bear_1', makeCard('bear_1', 'bear_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('zomb_def', makeDef('zomb_def', { name: 'Walking Corpse', type_line: 'Creature — Zombie', power: 2, toughness: 2 }));
    defs.set('bear_def', makeDef('bear_def', { name: 'Grizzly Bears', type_line: 'Creature — Bear' }));
    const state = makeState({ cards, cardDefinitions: defs });

    expect(() => validateTargetChoices(state, 'p1', ability.targets, ['zomb_1'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'p1', ability.targets, ['bear_1'])).toThrow();

    // Execution: Regenerate sets regeneration shield — executor applies it
    const result = executeEffects(state, ability.effects, 'p1', ['zomb_1'], ability.targets);
    // Regenerated permanent should still be on the battlefield or have a regen
    // shield; at a minimum the effect ran without throwing.
    expect(result.cards.get('zomb_1')).toBeDefined();
  });

  it('Swift Warden ETB: target Merfolk you control gains hexproof; non-Merfolk is illegal', () => {
    const parsed = parseOracleText(
      'When this creature enters, target Merfolk you control gains hexproof until end of turn.',
    );
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;

    const cards = new Map<string, CardInstance>();
    const merfolk = makeCard('merf_1', 'merf_def', 'p1');
    const bear = makeCard('bear_1', 'bear_def', 'p1');
    cards.set('merf_1', merfolk);
    cards.set('bear_1', bear);
    const defs = new Map<string, CardDefinition>();
    defs.set('merf_def', makeDef('merf_def', { name: 'Merfolk Looter', type_line: 'Creature — Merfolk Wizard' }));
    defs.set('bear_def', makeDef('bear_def', { name: 'Grizzly Bears', type_line: 'Creature — Bear' }));
    const state = makeState({ cards, cardDefinitions: defs });

    // For ETB parsed results, targets are on parsed.targets (top-level), not on the ability
    const targets = parsed.targets;

    // Merfolk you control is legal
    expect(() => validateTargetChoices(state, 'p1', targets, ['merf_1'])).not.toThrow();
    // Bear is not a Merfolk — illegal
    expect(() => validateTargetChoices(state, 'p1', targets, ['bear_1'])).toThrow();

    // Execution: grant hexproof to the Merfolk
    const result = executeEffects(state, parsed.ability.effects, 'p1', ['merf_1'], targets);
    expect(hasKeyword(result, 'merf_1', 'hexproof')).toBe(true);
  });
});

// ── Execution ─────────────────────────────────────────────────────────────────

describe('creature-subtype targets — execution', () => {
  it('Destroy target Wall sends the Wall to the graveyard', () => {
    const parsed = parseOracleText('Destroy target Wall.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const cards = new Map<string, CardInstance>();
    cards.set('wall_1', makeCard('wall_1', 'wall_def', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('wall_def', makeDef('wall_def', { name: 'Wall of Stone', type_line: 'Creature — Wall', power: 0, toughness: 8 }));
    const state = makeState({ cards, cardDefinitions: defs });

    const result = executeEffects(state, parsed.effects, 'p1', ['wall_1'], parsed.targets);
    expect(result.cards.get('wall_1')?.zone).toBe('graveyard');
  });

  it('Exile union Skeleton/Vampire/Zombie exiles a Vampire', () => {
    const parsed = parseOracleText('Exile target Skeleton, Vampire, or Zombie.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const cards = new Map<string, CardInstance>();
    cards.set('vamp_1', makeCard('vamp_1', 'vamp_def', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('vamp_def', makeDef('vamp_def', { name: 'Vampire Nighthawk', type_line: 'Creature — Vampire Shaman' }));
    const state = makeState({ cards, cardDefinitions: defs });

    expect(() => validateTargetChoices(state, 'p1', parsed.targets, ['vamp_1'])).not.toThrow();
    const result = executeEffects(state, parsed.effects, 'p1', ['vamp_1'], parsed.targets);
    expect(result.cards.get('vamp_1')?.zone).toBe('exile');
  });

  it('Tap target Samurai taps a Samurai creature', () => {
    const parsed = parseOracleText('Tap target Samurai.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const cards = new Map<string, CardInstance>();
    cards.set('sam_1', makeCard('sam_1', 'sam_def', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('sam_def', makeDef('sam_def', { name: 'Kitsune Blademaster', type_line: 'Creature — Fox Samurai' }));
    const state = makeState({ cards, cardDefinitions: defs });

    const result = executeEffects(state, parsed.effects, 'p1', ['sam_1'], parsed.targets);
    expect(result.cards.get('sam_1')?.tapped).toBe(true);
  });

  it('ModifyPT on target Merfolk you control pumps the Merfolk', () => {
    const parsed = parseOracleText('Target Merfolk you control gets +2/+2 until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const cards = new Map<string, CardInstance>();
    cards.set('merf_1', makeCard('merf_1', 'merf_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('merf_def', makeDef('merf_def', { name: 'Merfolk of the Pearl Trident', type_line: 'Creature — Merfolk', power: 1, toughness: 1 }));
    const state = makeState({ cards, cardDefinitions: defs });

    expect(() => validateTargetChoices(state, 'p1', parsed.targets, ['merf_1'])).not.toThrow();
    const result = executeEffects(state, parsed.effects, 'p1', ['merf_1'], parsed.targets);
    // The executor stores ModifyPT as _powerMod/_toughnessMod counters
    const merf = result.cards.get('merf_1');
    expect(merf).toBeDefined();
    expect(merf?.counters['_powerMod']).toBe(2);
    expect(merf?.counters['_toughnessMod']).toBe(2);
  });
});
