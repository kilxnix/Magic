/**
 * Slice 2 — Beginning-of-combat pump/grant trigger tails:
 *   "other creatures you control gain <kw-list> until end of turn"
 *   "other creatures you control with power N or greater gain <kw-list> until end of turn"
 *   "other <Subtype>s you control gain <kw-list> until end of turn"
 *   "other creatures you control get +N/+N [and gain <kw-list>] until end of turn"
 *
 * Real cards covered:
 *   Cosmic Spider-Man:    "other Spiders you control gain vigilance, reach, and lifelink until end of turn"
 *   Cactusfolk Sureshot:  "other creatures you control with power 4 or greater gain trample and haste until end of turn"
 *   Primordial Plasm:     "other creatures you control get +2/+2 until end of turn" (Invasion of Muraganda back face)
 *
 * Declined:
 *   Brambleguard Captain — "gets +X/+0 where X is this creature's power" — no SourcePower AmountRef exists.
 *
 * EXECUTOR HONESTY: AllCreaturesYouControlMatching is handled inline (no resolveTargetRef call).
 * The new `notSource` CardFilter flag causes the executor to skip the source itself, mirroring
 * "other" semantics.
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect } from '../effects/ast';

// ── helpers ──────────────────────────────────────────────────────────────────

function def(
  id: string,
  name: string,
  typeLine: string,
  types: string[],
  pt?: [number, number],
): CardDefinition {
  return {
    id, name, type_line: typeLine, oracle_text: '', mana_cost: '{1}',
    cmc: 1, colors: [], color_identity: [], keywords: [],
    card_types: types as CardDefinition['card_types'],
    ...(pt ? { power: pt[0], toughness: pt[1] } : {}),
  };
}

const DEFS: CardDefinition[] = [
  def('d_source', 'Cosmic Spider-Man',   'Creature — Spider',  ['creature'], [2, 2]),
  def('d_spider', 'Spitwebber',          'Creature — Spider',  ['creature'], [2, 3]),
  def('d_cactus', 'Cactusfolk Sureshot', 'Creature — Cactus',  ['creature'], [3, 3]),
  def('d_big',    'Big Beast',           'Creature — Beast',   ['creature'], [5, 4]),
  def('d_small',  'Small Goblin',        'Creature — Goblin',  ['creature'], [1, 1]),
  def('d_plasm',  'Primordial Plasm',    'Creature — Ooze',    ['creature'], [3, 3]),
  def('d_foe',    'Foe Creature',        'Creature — Human',   ['creature'], [2, 2]),
];

function mk(id: string, defId: string, owner: string): CardInstance {
  return {
    instanceId: id, definitionId: defId, ownerId: owner, zone: 'battlefield',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function st(cards: CardInstance[]): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map(cards.map(c => [c.instanceId, c])),
    cardDefinitions: new Map(DEFS.map(d => [d.id, d])),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'begin_combat', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function triggeredEffects(text: string): Effect[] {
  const parsed = parseOracleText(text);
  if (parsed.kind !== 'Triggered') throw new Error(`Expected Triggered, got ${parsed.kind}: ${text}`);
  return parsed.ability.effects;
}

function spellEffects(text: string): Effect[] {
  const parsed = parseOracleText(text);
  if (parsed.kind !== 'Spell') throw new Error(`Expected Spell, got ${parsed.kind}: ${text}`);
  return parsed.effects;
}

// ── PARSE TESTS ──────────────────────────────────────────────────────────────

describe('slice2 combat-pump: other Subtype grant keyword list (Cosmic Spider-Man)', () => {
  it('parses multi-keyword list on other Spiders you control', () => {
    const text = 'At the beginning of combat on your turn, other Spiders you control gain vigilance, reach, and lifelink until end of turn.';
    const effects = triggeredEffects(text);
    // One GrantKeyword per keyword
    expect(effects).toHaveLength(3);
    const keywords = effects.map(e => {
      expect(e.kind).toBe('GrantKeyword');
      return (e as Extract<Effect, { kind: 'GrantKeyword' }>).keyword;
    });
    expect(keywords).toContain('Vigilance');
    expect(keywords).toContain('Reach');
    expect(keywords).toContain('Lifelink');
    // All target the same AllCreaturesYouControlMatching ref
    for (const e of effects) {
      const t = (e as Extract<Effect, { kind: 'GrantKeyword' }>).target;
      expect(t.kind).toBe('AllCreaturesYouControlMatching');
    }
  });

  it('filter contains the spider subtype and notSource', () => {
    const text = 'At the beginning of combat on your turn, other Spiders you control gain vigilance, reach, and lifelink until end of turn.';
    const effects = triggeredEffects(text);
    const target = (effects[0] as Extract<Effect, { kind: 'GrantKeyword' }>).target;
    expect(target.kind).toBe('AllCreaturesYouControlMatching');
    if (target.kind !== 'AllCreaturesYouControlMatching') return;
    expect(target.filter.subtypes).toContain('spider');
    expect(target.filter.notSource).toBe(true);
    expect(target.filter.types).toContain('creature');
  });

  it('untilEndOfTurn is true on all keyword effects', () => {
    const text = 'At the beginning of combat on your turn, other Spiders you control gain vigilance, reach, and lifelink until end of turn.';
    const effects = triggeredEffects(text);
    for (const e of effects) {
      expect((e as Extract<Effect, { kind: 'GrantKeyword' }>).untilEndOfTurn).toBe(true);
    }
  });
});

describe('slice2 combat-pump: other creatures with power filter (Cactusfolk Sureshot)', () => {
  it('parses "other creatures you control with power 4 or greater gain trample and haste until end of turn"', () => {
    const text = 'At the beginning of combat on your turn, other creatures you control with power 4 or greater gain trample and haste until end of turn.';
    const effects = triggeredEffects(text);
    expect(effects).toHaveLength(2);
    const keywords = effects.map(e => {
      expect(e.kind).toBe('GrantKeyword');
      return (e as Extract<Effect, { kind: 'GrantKeyword' }>).keyword;
    });
    expect(keywords).toContain('Trample');
    expect(keywords).toContain('Haste');
  });

  it('filter has power >= 4 and notSource', () => {
    const text = 'At the beginning of combat on your turn, other creatures you control with power 4 or greater gain trample and haste until end of turn.';
    const effects = triggeredEffects(text);
    const target = (effects[0] as Extract<Effect, { kind: 'GrantKeyword' }>).target;
    expect(target.kind).toBe('AllCreaturesYouControlMatching');
    if (target.kind !== 'AllCreaturesYouControlMatching') return;
    expect(target.filter.power).toEqual({ op: 'gte', value: 4 });
    expect(target.filter.notSource).toBe(true);
  });
});

describe('slice2 combat-pump: other creatures get +N/+N (Primordial Plasm)', () => {
  it('parses "other creatures you control get +2/+2 until end of turn" as a spell clause', () => {
    const effects = spellEffects('Other creatures you control get +2/+2 until end of turn.');
    expect(effects).toHaveLength(1);
    const e = effects[0];
    expect(e.kind).toBe('ModifyPT');
    if (e.kind !== 'ModifyPT') return;
    expect(e.power).toBe(2);
    expect(e.toughness).toBe(2);
    expect(e.untilEndOfTurn).toBe(true);
    const t = e.target;
    expect(t.kind).toBe('AllCreaturesYouControlMatching');
    if (t.kind !== 'AllCreaturesYouControlMatching') return;
    expect(t.filter.notSource).toBe(true);
  });

  it('parses as trigger tail (beginning of combat form)', () => {
    const text = 'At the beginning of combat on your turn, other creatures you control get +2/+2 until end of turn.';
    const effects = triggeredEffects(text);
    expect(effects).toHaveLength(1);
    expect(effects[0].kind).toBe('ModifyPT');
  });

  it('parses "other creatures you control get +1/+1 and gain trample until end of turn"', () => {
    const effects = spellEffects('Other creatures you control get +1/+1 and gain trample until end of turn.');
    expect(effects).toHaveLength(2);
    expect(effects[0].kind).toBe('ModifyPT');
    expect(effects[1].kind).toBe('GrantKeyword');
    if (effects[1].kind !== 'GrantKeyword') return;
    expect(effects[1].keyword).toBe('Trample');
    // Both effects point at the same AllCreaturesYouControlMatching target
    expect(effects[0].target.kind).toBe('AllCreaturesYouControlMatching');
    expect(effects[1].target.kind).toBe('AllCreaturesYouControlMatching');
  });
});

// ── EXECUTION TESTS ──────────────────────────────────────────────────────────

describe('slice2 combat-pump execution: notSource excludes source itself', () => {
  it('grants keywords to other Spiders but NOT to the source', () => {
    // source = 'src_spider' (d_source, Spider 2/2)
    // ally_spider = 'ally_spider' (d_spider, Spider 2/3, p0's)
    // foe_spider = 'foe_spider' (d_spider, Spider, p1's)
    const state = st([
      mk('src_spider',  'd_source', 'p0'),
      mk('ally_spider', 'd_spider', 'p0'),
      mk('foe_spider',  'd_spider', 'p1'),
    ]);
    const text = 'At the beginning of combat on your turn, other Spiders you control gain vigilance, reach, and lifelink until end of turn.';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    const s = executeEffects(
      state,
      parsed.ability.effects,
      'p0',
      [],
      [],
      0,
      { sourceInstanceId: 'src_spider' },
    );

    // Ally spider (same controller, not source) should have all 3 keywords
    const ally = s.cards.get('ally_spider')!;
    expect(ally.grantedKeywords).toBeDefined();
    expect(ally.grantedKeywords).toContain('Vigilance');
    expect(ally.grantedKeywords).toContain('Reach');
    expect(ally.grantedKeywords).toContain('Lifelink');

    // Source itself must NOT receive the keyword (it's excluded by notSource)
    const src = s.cards.get('src_spider')!;
    expect(src.grantedKeywords ?? []).not.toContain('Vigilance');

    // Opponent's spider must NOT receive (controller filter)
    const foe = s.cards.get('foe_spider')!;
    expect(foe.grantedKeywords ?? []).not.toContain('Vigilance');
  });

  it('applies power filter: only creatures with power >= 4 receive keywords', () => {
    // source = cactus (d_cactus, 3/3)
    // big = big_beast (d_big, 5/4) — qualifies
    // small = small_goblin (d_small, 1/1) — does NOT qualify
    const state = st([
      mk('cactus', 'd_cactus', 'p0'),
      mk('big',    'd_big',    'p0'),
      mk('small',  'd_small',  'p0'),
    ]);
    const text = 'At the beginning of combat on your turn, other creatures you control with power 4 or greater gain trample and haste until end of turn.';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    const s = executeEffects(
      state,
      parsed.ability.effects,
      'p0',
      [],
      [],
      0,
      { sourceInstanceId: 'cactus' },
    );

    // big (power 5) should get the keywords
    const big = s.cards.get('big')!;
    expect(big.grantedKeywords).toContain('Trample');
    expect(big.grantedKeywords).toContain('Haste');

    // small (power 1) should NOT
    const small = s.cards.get('small')!;
    expect(small.grantedKeywords ?? []).not.toContain('Trample');

    // source (power 3) should NOT (excluded by notSource, and power also < 4)
    const src = s.cards.get('cactus')!;
    expect(src.grantedKeywords ?? []).not.toContain('Trample');
  });

  it('applies +N/+N pump to other creatures, not source', () => {
    // source = plasm (d_plasm, 3/3)
    // ally = big_beast (d_big, 5/4)
    // foe = foe_creature (d_foe, 2/2, p1's — should NOT be pumped)
    const state = st([
      mk('plasm', 'd_plasm', 'p0'),
      mk('ally',  'd_big',   'p0'),
      mk('foe',   'd_foe',   'p1'),
    ]);
    const effects = spellEffects('Other creatures you control get +2/+2 until end of turn.');
    const s = executeEffects(
      state,
      effects,
      'p0',
      [],
      [],
      0,
      { sourceInstanceId: 'plasm' },
    );

    // ally gets +2 to power and toughness
    const ally = s.cards.get('ally')!;
    expect(ally.counters['_powerMod'] ?? 0).toBe(2);
    expect(ally.counters['_toughnessMod'] ?? 0).toBe(2);

    // source does NOT
    const src = s.cards.get('plasm')!;
    expect(src.counters['_powerMod'] ?? 0).toBe(0);
    expect(src.counters['_toughnessMod'] ?? 0).toBe(0);

    // opponent's creature does NOT
    const foe = s.cards.get('foe')!;
    expect(foe.counters['_powerMod'] ?? 0).toBe(0);
    expect(foe.counters['_toughnessMod'] ?? 0).toBe(0);
  });
});

describe('slice2 combat-pump: honesty bar', () => {
  it('does NOT parse Brambleguard Captain (no SourcePower AmountRef exists)', () => {
    // "target creature you control gets +X/+0 until end of turn, where X is this creature\'s power"
    // This involves SourcePower which has no AmountRef kind — must stay Unparsed or parse as something else
    // We just verify it does not mistakenly produce the "other creatures" pattern
    const text = 'At the beginning of combat on your turn, target creature you control gets +X/+0 until end of turn, where X is this creature\'s power.';
    const parsed = parseOracleText(text);
    // It parses as Triggered with a body — the body should NOT use AllCreaturesYouControlMatching
    if (parsed.kind === 'Triggered') {
      // If it somehow parsed the body, ensure no AllCreaturesYouControlMatching target
      for (const e of parsed.ability.effects) {
        if ('target' in e) {
          expect((e as any).target.kind).not.toBe('AllCreaturesYouControlMatching');
        }
      }
    }
    // The important thing is that it didn't crash and doesn't falsely parse as "other creatures"
  });

  it('now parses "other creatures you control gain shadow until end of turn" (shadow added to GRANTABLE_KEYWORDS in Slice 6)', () => {
    const text = 'Other creatures you control gain shadow until end of turn.';
    const parsed = parseOracleText(text);
    // Shadow is enforced via getEvasionKeywords (reads grantedKeywords), so the grant is honest.
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind === 'Spell') {
      expect(parsed.effects.length).toBeGreaterThan(0);
      expect(parsed.effects[0]).toMatchObject({ kind: 'GrantKeyword', keyword: 'Shadow' });
    }
  });
});
