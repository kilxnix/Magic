import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import type { Effect } from '../effects/ast';

// Coverage category: pump-grant — single-target combat tricks templated with a
// LEADING "Until end of turn, ..." duration (matchLeadingDurationPumpGrant).
// Standard trailing-duration forms are already covered by matchModifyPT /
// matchGrantKeyword; this matcher normalizes the front-loaded spelling and
// delegates to those, so only executor-backed ModifyPT + GRANTABLE-keyword
// GrantKeyword effects on a chosen Creature target are credited.

function effects(text: string): Effect[] {
  const parsed = parseOracleText(text);
  if (parsed.kind !== 'Spell') {
    throw new Error(`expected Spell, got ${parsed.kind} for: ${text}`);
  }
  return parsed.effects;
}

function chosenId(e: Effect): string | undefined {
  const t = (e as { target?: { kind: string; targetId?: string } }).target;
  return t && t.kind === 'Chosen' ? t.targetId : undefined;
}

describe('pump-grant: leading-duration single-target buffs', () => {
  it('parses "Until end of turn, target creature gets +N/+N and gains <keyword>" (Armor of Shadows)', () => {
    const es = effects('Until end of turn, target creature gets +1/+0 and gains indestructible.');
    expect(es).toHaveLength(2);

    const pt = es[0];
    expect(pt.kind).toBe('ModifyPT');
    expect((pt as Extract<Effect, { kind: 'ModifyPT' }>).power).toBe(1);
    expect((pt as Extract<Effect, { kind: 'ModifyPT' }>).toughness).toBe(0);
    expect((pt as Extract<Effect, { kind: 'ModifyPT' }>).untilEndOfTurn).toBe(true);

    const kw = es[1];
    expect(kw.kind).toBe('GrantKeyword');
    expect((kw as Extract<Effect, { kind: 'GrantKeyword' }>).keyword).toBe('Indestructible');
    expect((kw as Extract<Effect, { kind: 'GrantKeyword' }>).untilEndOfTurn).toBe(true);

    // Both effects must target the SAME chosen creature.
    expect(chosenId(pt)).toBeDefined();
    expect(chosenId(kw)).toBe(chosenId(pt));
  });

  it('parses the pure "Until end of turn, target creature gains <keyword>" form', () => {
    const es = effects('Until end of turn, target creature gains trample.');
    expect(es).toHaveLength(1);
    expect(es[0].kind).toBe('GrantKeyword');
    expect((es[0] as Extract<Effect, { kind: 'GrantKeyword' }>).keyword).toBe('Trample');
    expect((es[0] as Extract<Effect, { kind: 'GrantKeyword' }>).untilEndOfTurn).toBe(true);
    expect(chosenId(es[0])).toBeDefined();
  });

  it('parses bigger pump + grant (Revenge-of-the-Hunter style numbers)', () => {
    const es = effects('Until end of turn, target creature gets +6/+6 and gains trample.');
    expect(es[0].kind).toBe('ModifyPT');
    expect((es[0] as Extract<Effect, { kind: 'ModifyPT' }>).power).toBe(6);
    expect((es[0] as Extract<Effect, { kind: 'ModifyPT' }>).toughness).toBe(6);
    expect(es[1].kind).toBe('GrantKeyword');
    expect((es[1] as Extract<Effect, { kind: 'GrantKeyword' }>).keyword).toBe('Trample');
  });

  it('carries the "you control" constraint through to the chosen target', () => {
    const parsed = parseOracleText('Until end of turn, target creature you control gets +2/+2 and gains first strike.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');
    expect(parsed.targets[0].constraints?.controllerControls).toBe(true);

    const kw = parsed.effects.find(e => e.kind === 'GrantKeyword');
    expect(kw).toBeDefined();
    expect((kw as Extract<Effect, { kind: 'GrantKeyword' }>).keyword).toBe('First Strike');
  });

  it('parses multiple granted keywords in one leading-duration clause', () => {
    const es = effects('Until end of turn, target creature you control gets +2/+2 and gains trample and lifelink.');
    const kinds = es.map(e => e.kind);
    expect(kinds.filter(k => k === 'GrantKeyword')).toHaveLength(2);
    const kws = es
      .filter(e => e.kind === 'GrantKeyword')
      .map(e => (e as Extract<Effect, { kind: 'GrantKeyword' }>).keyword);
    expect(kws).toEqual(expect.arrayContaining(['Trample', 'Lifelink']));
  });

  it('now parses shadow and fear grants — evasion-keyword enforcement via grantedKeywords (Slice 6)', () => {
    // Shadow and fear are enforced by getEvasionKeywords (reads grantedKeywords) in keywords.ts,
    // so granting them via GrantKeyword is honest. They were added to GRANTABLE_KEYWORDS in Slice 6.
    const shadowResult = parseOracleText('Until end of turn, target creature gains shadow.');
    expect(shadowResult.kind).toBe('Spell');
    if (shadowResult.kind === 'Spell') {
      expect(shadowResult.effects).toHaveLength(1);
      expect(shadowResult.effects[0]).toMatchObject({ kind: 'GrantKeyword', keyword: 'Shadow' });
    }
    const fearResult = parseOracleText('Until end of turn, target creature gets +2/+0 and gains fear.');
    expect(fearResult.kind).toBe('Spell');
    if (fearResult.kind === 'Spell') {
      const grantKw = fearResult.effects.find(e => e.kind === 'GrantKeyword');
      expect(grantKw).toMatchObject({ kind: 'GrantKeyword', keyword: 'Fear' });
    }
  });

  it('now parses leading-duration quoted-dies-trigger grants (Slice 6 extension)', () => {
    // Slice 6 implements the leading-duration pump + quoted-dies-trigger family.
    // These were previously Unparsed; now they emit [ModifyPT, GrantDiesTrigger].
    const parsed = parseOracleText(
      'Until end of turn, target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield."',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(2);
    expect(parsed.effects[0].kind).toBe('ModifyPT');
    expect(parsed.effects[1].kind).toBe('GrantDiesTrigger');
    const gdt = parsed.effects[1];
    if (gdt.kind !== 'GrantDiesTrigger') return;
    expect(gdt.dieEffects[0].kind).toBe('ReturnFromGraveyard');
  });
});
