import { describe, it, expect } from 'vitest';
import { parseOracleText, parseActivatedAbilities } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { canBlock } from '../keywords';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

/**
 * Slice 8 — activated self-tail pack:
 *
 *   (1) self-unblockable:  "{cost}: This creature can't be blocked this turn."
 *       Cards: Harbor Bandit, Frilled Sea Serpent, Biolume Egg
 *       Effect: GrantKeyword('Unblockable', Source)
 *
 *   (2) self-phase-out:    "{cost}: This creature phases out."
 *       Cards: Rainbow Efreet, Blink Dog (with "Teleport — " ability-word prefix)
 *       Effect: PhaseOut(Source)
 *
 *   (3) self-dynamic-pump: "{cost}: This creature gets +X/+X until end of turn,
 *                            where X is your life total."
 *       Cards: Loxodon Lifechanter
 *       Effect: ModifyPT(Source, LifeTotal, LifeTotal)
 */

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// (1) SELF-UNBLOCKABLE — Harbor Bandit / Frilled Sea Serpent family
// ---------------------------------------------------------------------------

describe('Slice 8 — self-unblockable activated tail: parser recognition', () => {
  it('Harbor Bandit: parses "{1}{B}: This creature can\'t be blocked this turn." as self-unblockable', () => {
    // Harbor Bandit oracle: {1}{B}: This creature can't be blocked this turn. Activate only if you control a Swamp.
    // We test the core line without the "Activate only if" rider.
    const r = parseOracleText("{1}{B}: This creature can't be blocked this turn.");
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    expect(r.abilities).toHaveLength(1);
    const ability = r.abilities[0];
    expect(ability.effects).toHaveLength(1);
    expect(ability.effects[0].kind).toBe('GrantKeyword');
    const gke = ability.effects[0] as Extract<typeof ability.effects[0], { kind: 'GrantKeyword' }>;
    expect(gke.keyword).toBe('Unblockable');
    expect(gke.untilEndOfTurn).toBe(true);
    expect(gke.target.kind).toBe('Source');
    expect(ability.targets).toHaveLength(0);
  });

  it('Frilled Sea Serpent: "{1}{U}: This creature can\'t be blocked this turn." — no targets', () => {
    const r = parseOracleText("{1}{U}: This creature can't be blocked this turn.");
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const ability = r.abilities[0];
    expect(ability.effects[0].kind).toBe('GrantKeyword');
    expect((ability.effects[0] as any).keyword).toBe('Unblockable');
    expect((ability.effects[0] as any).target.kind).toBe('Source');
    expect(ability.targets).toHaveLength(0);
  });

  it('~ subject form also parses: "~ can\'t be blocked this turn."', () => {
    const r = parseOracleText("{T}: ~ can't be blocked this turn.");
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const ability = r.abilities[0];
    expect(ability.effects[0].kind).toBe('GrantKeyword');
    expect((ability.effects[0] as any).keyword).toBe('Unblockable');
  });

  it('multi-ability card: both abilities parse when self-unblockable is one of them', () => {
    // Simulate a card that has both a draw ability and self-unblockable.
    const abilities = parseActivatedAbilities(
      "{2}: Draw a card.\n{1}{U}: This creature can't be blocked this turn.",
    );
    expect(abilities).toHaveLength(2);
    expect(abilities[0].effects[0].kind).toBe('Draw');
    expect(abilities[1].effects[0].kind).toBe('GrantKeyword');
    expect((abilities[1].effects[0] as any).keyword).toBe('Unblockable');
  });
});

describe('Slice 8 — self-unblockable: execution', () => {
  it('executing self-unblockable on the source creature grants Unblockable', () => {
    const parsed = parseOracleText("{1}{B}: This creature can't be blocked this turn.");
    expect(parsed.kind).toBe('Activated');
    if (parsed.kind !== 'Activated') return;
    const ability = parsed.abilities[0];

    const cards = new Map<string, CardInstance>();
    cards.set('att', makeCard('att', 'att_def', 'p1'));
    cards.set('blk', makeCard('blk', 'blk_def', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('att_def', makeDef('att_def', { power: 2 }));
    defs.set('blk_def', makeDef('blk_def', { power: 2 }));
    const state0 = makeState({ cards, cardDefinitions: defs, combat: {
      attackers: [{ cardInstanceId: 'att', defendingPlayerId: 'p2' }],
      blockers: [],
      damageAssignment: new Map(),
    }});

    expect(canBlock(state0, 'blk', 'att')).toBe(true);

    // Execute the ability with sourceInstanceId = 'att' (the source creature)
    const state1 = executeEffects(state0, ability.effects, 'p1', [], ability.targets, 0, { sourceInstanceId: 'att' });
    expect(state1.cards.get('att')!.grantedKeywords).toContain('Unblockable');
    expect(canBlock(state1, 'blk', 'att')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (2) SELF-PHASE-OUT — Rainbow Efreet / Blink Dog family
// ---------------------------------------------------------------------------

describe('Slice 8 — self-phase-out activated tail: parser recognition', () => {
  it('Rainbow Efreet: "{U}{U}: This creature phases out." parses as PhaseOut(Source)', () => {
    // Rainbow Efreet: {U}{U}: This creature phases out.
    const r = parseOracleText('{U}{U}: This creature phases out.');
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    expect(r.abilities).toHaveLength(1);
    const ability = r.abilities[0];
    expect(ability.effects).toHaveLength(1);
    expect(ability.effects[0].kind).toBe('PhaseOut');
    const po = ability.effects[0] as Extract<typeof ability.effects[0], { kind: 'PhaseOut' }>;
    expect(po.target.kind).toBe('Source');
    expect(ability.targets).toHaveLength(0);
  });

  it('Blink Dog: "Teleport — {U}{U}: This creature phases out." strips ability-word and parses', () => {
    // Blink Dog oracle: "Teleport — {U}{U}: This creature phases out."
    // The "Teleport — " ability-word prefix must be stripped from the cost part.
    const abilities = parseActivatedAbilities('Teleport — {U}{U}: This creature phases out.');
    expect(abilities).toHaveLength(1);
    expect(abilities[0].effects[0].kind).toBe('PhaseOut');
    expect((abilities[0].effects[0] as any).target.kind).toBe('Source');
  });

  it("Teferi's Honor Guard: {T}: This permanent phases out. — parses permanent form", () => {
    const r = parseOracleText('{T}: This permanent phases out.');
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const ability = r.abilities[0];
    expect(ability.effects[0].kind).toBe('PhaseOut');
    expect((ability.effects[0] as any).target.kind).toBe('Source');
  });
});

describe('Slice 8 — self-phase-out: execution', () => {
  it('executing self-phase-out sets phasedOut on the source card', () => {
    const parsed = parseOracleText('{U}{U}: This creature phases out.');
    expect(parsed.kind).toBe('Activated');
    if (parsed.kind !== 'Activated') return;
    const ability = parsed.abilities[0];

    const cards = new Map<string, CardInstance>();
    cards.set('efreet', makeCard('efreet', 'efreet_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('efreet_def', makeDef('efreet_def'));
    const state0 = makeState({ cards, cardDefinitions: defs });

    expect(state0.cards.get('efreet')!.phasedOut).toBeFalsy();

    // Execute with sourceInstanceId = 'efreet'
    const state1 = executeEffects(state0, ability.effects, 'p1', [], ability.targets, 0, { sourceInstanceId: 'efreet' });
    expect(state1.cards.get('efreet')!.phasedOut).toBe(true);
  });

  it('Blink Dog integrated: ability-word stripped then executed', () => {
    const abilities = parseActivatedAbilities('Teleport — {U}{U}: This creature phases out.');
    expect(abilities).toHaveLength(1);

    const cards = new Map<string, CardInstance>();
    cards.set('dog', makeCard('dog', 'dog_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('dog_def', makeDef('dog_def'));
    const state0 = makeState({ cards, cardDefinitions: defs });

    const state1 = executeEffects(state0, abilities[0].effects, 'p1', [], abilities[0].targets, 0, { sourceInstanceId: 'dog' });
    expect(state1.cards.get('dog')!.phasedOut).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (3) SELF-DYNAMIC-PUMP (LifeTotal) — Loxodon Lifechanter family
// ---------------------------------------------------------------------------

describe('Slice 8 — self-dynamic-pump LifeTotal: parser recognition', () => {
  it('Loxodon Lifechanter: parses "+X/+X until end of turn, where X is your life total"', () => {
    // Loxodon Lifechanter: {6}{W}: This creature gets +X/+X until end of turn, where X is your life total.
    const r = parseOracleText(
      '{6}{W}: This creature gets +X/+X until end of turn, where X is your life total.',
    );
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    expect(r.abilities).toHaveLength(1);
    const ability = r.abilities[0];
    expect(ability.effects).toHaveLength(1);
    expect(ability.effects[0].kind).toBe('ModifyPT');
    const mpt = ability.effects[0] as Extract<typeof ability.effects[0], { kind: 'ModifyPT' }>;
    expect(mpt.target.kind).toBe('Source');
    expect(mpt.untilEndOfTurn).toBe(true);
    // Both power and toughness should be the LifeTotal amount
    expect(typeof mpt.power).not.toBe('number');
    expect(typeof mpt.toughness).not.toBe('number');
    if (typeof mpt.power !== 'number') expect((mpt.power as any).kind).toBe('LifeTotal');
    if (typeof mpt.toughness !== 'number') expect((mpt.toughness as any).kind).toBe('LifeTotal');
    expect(ability.targets).toHaveLength(0);
  });

  it('spell form also parses: "This creature gets +X/+X until end of turn, where X is your life total."', () => {
    const r = parseOracleText(
      'This creature gets +X/+X until end of turn, where X is your life total.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects[0].kind).toBe('ModifyPT');
    const mpt = r.effects[0] as Extract<typeof r.effects[0], { kind: 'ModifyPT' }>;
    expect(mpt.target.kind).toBe('Source');
    if (typeof mpt.power !== 'number') expect((mpt.power as any).kind).toBe('LifeTotal');
  });
});

describe('Slice 8 — self-dynamic-pump LifeTotal: execution', () => {
  it('executing self-dynamic-pump with life=20 applies +20/+20 via _powerMod counters', () => {
    const r = parseOracleText(
      '{6}{W}: This creature gets +X/+X until end of turn, where X is your life total.',
    );
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const ability = r.abilities[0];

    const cards = new Map<string, CardInstance>();
    cards.set('lifechanter', makeCard('lifechanter', 'lc_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('lc_def', makeDef('lc_def', { power: 4, toughness: 4 }));

    // Controller has 20 life
    const state0 = makeState({
      players: [makePlayer('p1', 20), makePlayer('p2', 40)],
      cards, cardDefinitions: defs,
    });

    const state1 = executeEffects(state0, ability.effects, 'p1', [], ability.targets, 0, { sourceInstanceId: 'lifechanter' });

    // ModifyPT stores results in card.counters['_powerMod'] / ['_toughnessMod']
    const card = state1.cards.get('lifechanter')!;
    expect(card.counters['_powerMod']).toBe(20);
    expect(card.counters['_toughnessMod']).toBe(20);
  });

  it('life=35 results in +35/+35 applied to source creature', () => {
    const r = parseOracleText(
      '{6}{W}: This creature gets +X/+X until end of turn, where X is your life total.',
    );
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const ability = r.abilities[0];

    const cards = new Map<string, CardInstance>();
    cards.set('lc', makeCard('lc', 'lc_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('lc_def', makeDef('lc_def', { power: 4, toughness: 4 }));

    const state0 = makeState({
      players: [makePlayer('p1', 35), makePlayer('p2', 40)],
      cards, cardDefinitions: defs,
    });

    const state1 = executeEffects(state0, ability.effects, 'p1', [], ability.targets, 0, { sourceInstanceId: 'lc' });

    const card = state1.cards.get('lc')!;
    expect(card.counters['_powerMod']).toBe(35);
    expect(card.counters['_toughnessMod']).toBe(35);
  });
});
