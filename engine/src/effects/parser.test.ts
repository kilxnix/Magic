import { describe, it, expect } from 'vitest';
import { parseOracleText, canParseOracleText } from './parser';

describe('parseOracleText', () => {
  describe('deal damage patterns', () => {
    it('parses "~ deals 3 damage to any target."', () => {
      const result = parseOracleText('~ deals 3 damage to any target.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('DealDamage');

      const dmg = result.effects[0];
      if (dmg.kind !== 'DealDamage') return;
      expect(dmg.amount).toBe(3);
      expect(dmg.target.kind).toBe('Chosen');

      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].type).toBe('Any');
    });

    it('parses "~ deals 2 damage to target creature."', () => {
      const result = parseOracleText('~ deals 2 damage to target creature.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      const dmg = result.effects[0];
      if (dmg.kind !== 'DealDamage') return;
      expect(dmg.amount).toBe(2);

      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].type).toBe('Creature');
    });

    it('parses "~ deals 5 damage to target player."', () => {
      const result = parseOracleText('~ deals 5 damage to target player.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      expect(result.targets[0].type).toBe('Player');
    });
  });

  describe('destroy patterns', () => {
    it('parses "Destroy target creature."', () => {
      const result = parseOracleText('Destroy target creature.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Destroy');

      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].type).toBe('Creature');
      expect(result.targets[0].constraints).toBeUndefined();
    });

    it('parses "Destroy target creature an opponent controls."', () => {
      const result = parseOracleText('Destroy target creature an opponent controls.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Destroy');

      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].type).toBe('Creature');
      expect(result.targets[0].constraints?.opponentControls).toBe(true);
    });
  });

  describe('draw patterns', () => {
    it('parses "Draw a card."', () => {
      const result = parseOracleText('Draw a card.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Draw');

      const draw = result.effects[0];
      if (draw.kind !== 'Draw') return;
      expect(draw.count).toBe(1);
      expect(draw.player.kind).toBe('Controller');

      expect(result.targets).toHaveLength(0);
    });

    it('parses "Draw 3 cards."', () => {
      const result = parseOracleText('Draw 3 cards.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      const draw = result.effects[0];
      if (draw.kind !== 'Draw') return;
      expect(draw.count).toBe(3);
    });
  });

  describe('life patterns', () => {
    it('parses "Gain 4 life."', () => {
      const result = parseOracleText('Gain 4 life.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('GainLife');

      const gain = result.effects[0];
      if (gain.kind !== 'GainLife') return;
      expect(gain.amount).toBe(4);
    });

    it('parses "Lose 2 life."', () => {
      const result = parseOracleText('Lose 2 life.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('LoseLife');

      const lose = result.effects[0];
      if (lose.kind !== 'LoseLife') return;
      expect(lose.amount).toBe(2);
    });
  });

  describe('ETB trigger patterns', () => {
    it('parses "When ~ enters the battlefield, draw a card."', () => {
      const result = parseOracleText('When ~ enters the battlefield, draw a card.');

      expect(result.kind).toBe('ETB');
      if (result.kind !== 'ETB') return;

      expect(result.ability.kind).toBe('TriggeredAbility');
      expect(result.ability.trigger.kind).toBe('ETB');
      expect(result.ability.trigger.who).toBe('self');
      expect(result.ability.effects).toHaveLength(1);
      expect(result.ability.effects[0].kind).toBe('Draw');
    });

    it('parses "Whenever ~ enters the battlefield, destroy target creature."', () => {
      const result = parseOracleText('Whenever ~ enters the battlefield, destroy target creature.');

      expect(result.kind).toBe('ETB');
      if (result.kind !== 'ETB') return;

      expect(result.ability.effects).toHaveLength(1);
      expect(result.ability.effects[0].kind).toBe('Destroy');
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].type).toBe('Creature');
    });

    it('parses ETB with damage effect', () => {
      const result = parseOracleText('When ~ enters the battlefield, ~ deals 2 damage to any target.');

      expect(result.kind).toBe('ETB');
      if (result.kind !== 'ETB') return;

      expect(result.ability.effects[0].kind).toBe('DealDamage');
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].type).toBe('Any');
    });
  });

  describe('unparsed cases', () => {
    it('returns Unparsed for empty text', () => {
      const result = parseOracleText('');
      expect(result.kind).toBe('Unparsed');
    });

    it('returns Unparsed for unrecognized patterns', () => {
      const result = parseOracleText('Counter target spell.');
      expect(result.kind).toBe('Unparsed');
    });

    it('partially parses multi-effect cards (only first effect)', () => {
      // The v0 parser matches the first effect and ignores the rest
      // Full multi-effect parsing is Phase 10
      const result = parseOracleText('Draw a card, then discard a card.');
      expect(result.kind).toBe('Spell');
      if (result.kind === 'Spell') {
        expect(result.effects[0].kind).toBe('Draw');
      }
    });
  });

  describe('canParseOracleText', () => {
    it('returns true for parseable text', () => {
      expect(canParseOracleText('Draw a card.')).toBe(true);
      expect(canParseOracleText('Destroy target creature.')).toBe(true);
    });

    it('returns false for unparseable text', () => {
      expect(canParseOracleText('Counter target spell.')).toBe(false);
      expect(canParseOracleText('')).toBe(false);
    });
  });
});
