import { describe, it, expect } from 'vitest';
import type { GameState, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { hasKeyword } from '../keywords';

// ---------------------------------------------------------------------------
// Family: token-variants
// matchCreateToken must parse (and executeCreateToken must honestly run):
//   - plural N: "Create N <P/T> <color> <type> creature tokens"
//   - keyworded: "Create a <P/T> <type> creature token with <keyword[s]>"
//       (including two-word keywords like "first strike" / "double strike")
//   - tapped/attacking: "Create N tapped ... tokens" AND the trailing
//       "... that are tapped and attacking" wording.
// Predefined tokens (Treasure/Clue/Food) already work and are unchanged.
// ---------------------------------------------------------------------------

function baseState(): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map<string, CardInstance>(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 3,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function tokensOnBf(s: GameState, controllerId: string): CardInstance[] {
  return [...s.cards.values()].filter(c => c.zone === 'battlefield' && c.isToken && c.ownerId === controllerId);
}

function defOf(s: GameState, c: CardInstance) {
  return s.cardDefinitions.get(c.definitionId)!;
}

function run(oracle: string, controllerId = 'p0'): GameState {
  const p = parseOracleText(oracle);
  if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind + ' for: ' + oracle);
  const create = p.effects.find(e => e.kind === 'CreateToken');
  expect(create).toBeDefined();
  return executeEffects(baseState(), p.effects, controllerId, [], []);
}

describe('token-variants: plural N creature tokens', () => {
  it('creates EXACTLY N tokens with the right P/T/color/subtype', () => {
    const s = run('Create three 2/2 green Bear creature tokens.');
    const toks = tokensOnBf(s, 'p0');
    expect(toks.length).toBe(3); // genuinely THREE, not one
    for (const t of toks) {
      const d = defOf(s, t);
      expect(d.power).toBe(2);
      expect(d.toughness).toBe(2);
      expect(d.colors).toEqual(['G']);
      expect(d.card_types).toContain('creature');
      expect(d.type_line.toLowerCase()).toContain('bear');
      expect(t.tapped).toBe(false);
      expect(t.zone).toBe('battlefield');
    }
  });

  it('word-number "five" creates five tokens', () => {
    const s = run('Create five 1/1 white Soldier creature tokens.');
    expect(tokensOnBf(s, 'p0').length).toBe(5);
  });

  it('multicolored plural: "white and blue Bird" tokens carry both colors', () => {
    const s = run('Create two 1/1 white and blue Bird creature tokens with flying.');
    const toks = tokensOnBf(s, 'p0');
    expect(toks.length).toBe(2);
    for (const t of toks) {
      expect(new Set(defOf(s, t).colors)).toEqual(new Set(['W', 'U']));
      // Flying genuinely functions on the token instance, not just stored as a string.
      expect(hasKeyword(s, t.instanceId, 'flying')).toBe(true);
    }
  });
});

describe('token-variants: "with <keyword>" honestly grants functional keywords', () => {
  it('single keyword: token has flying as a real keyword', () => {
    const s = run('Create a 1/1 white Spirit creature token with flying.');
    const toks = tokensOnBf(s, 'p0');
    expect(toks.length).toBe(1);
    expect(hasKeyword(s, toks[0].instanceId, 'flying')).toBe(true);
  });

  it('two-word keyword "first strike" stored as ONE canonical keyword and functions', () => {
    const s = run('Create a 2/2 black Zombie creature token with first strike.');
    const toks = tokensOnBf(s, 'p0');
    expect(toks.length).toBe(1);
    const d = defOf(s, toks[0]);
    // Not split into ["First","Strike"] — exactly one keyword entry.
    expect(d.keywords).toEqual(['First Strike']);
    expect(hasKeyword(s, toks[0].instanceId, 'first strike')).toBe(true);
  });

  it('"flying and double strike": both keywords function', () => {
    const s = run('Create a 3/3 red Dragon creature token with flying and double strike.');
    const t = tokensOnBf(s, 'p0')[0];
    expect(hasKeyword(s, t.instanceId, 'flying')).toBe(true);
    expect(hasKeyword(s, t.instanceId, 'double strike')).toBe(true);
  });
});

describe('token-variants: tapped / attacking', () => {
  it('leading "tapped": token enters tapped', () => {
    const s = run('Create a tapped 3/3 green Beast creature token.');
    const toks = tokensOnBf(s, 'p0');
    expect(toks.length).toBe(1);
    expect(toks[0].tapped).toBe(true);
  });

  it('trailing "that are tapped and attacking": ALL tokens enter tapped', () => {
    const s = run('Create two 1/1 red Goblin creature tokens that are tapped and attacking.');
    const toks = tokensOnBf(s, 'p0');
    expect(toks.length).toBe(2);
    for (const t of toks) expect(t.tapped).toBe(true);
  });

  it("trailing \"that's tapped and attacking\" (singular): token enters tapped", () => {
    const s = run("Create a 1/1 red Goblin creature token that's tapped and attacking.");
    const toks = tokensOnBf(s, 'p0');
    expect(toks.length).toBe(1);
    expect(toks[0].tapped).toBe(true);
  });

  it('non-tapped wording leaves tokens untapped (no false positive)', () => {
    const s = run('Create two 1/1 white Soldier creature tokens.');
    const toks = tokensOnBf(s, 'p0');
    expect(toks.length).toBe(2);
    for (const t of toks) expect(t.tapped).toBe(false);
  });
});

describe('token-variants: deterministic', () => {
  it('repeated runs create identical token counts', () => {
    const a = tokensOnBf(run('Create three 2/2 green Bear creature tokens.'), 'p0').length;
    const b = tokensOnBf(run('Create three 2/2 green Bear creature tokens.'), 'p0').length;
    expect(a).toBe(b);
    expect(a).toBe(3);
  });
});
