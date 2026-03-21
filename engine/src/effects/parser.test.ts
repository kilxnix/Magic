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

  // Phase 10: New patterns
  describe('exile patterns', () => {
    it('parses "Exile target creature."', () => {
      const result = parseOracleText('Exile target creature.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Exile');
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].type).toBe('Creature');
    });

    it('parses "Exile target permanent."', () => {
      const result = parseOracleText('Exile target permanent.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects[0].kind).toBe('Exile');
      expect(result.targets[0].type).toBe('Any');
    });
  });

  describe('return to hand patterns', () => {
    it('parses "Return target creature to its owner\'s hand."', () => {
      const result = parseOracleText("Return target creature to its owner's hand.");

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('ReturnToHand');
      expect(result.targets).toHaveLength(1);
    });
  });

  describe('mill patterns', () => {
    it('parses "Mill 3 cards."', () => {
      const result = parseOracleText('Mill 3 cards.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Mill');

      const mill = result.effects[0];
      if (mill.kind !== 'Mill') return;
      expect(mill.count).toBe(3);
      expect(mill.player.kind).toBe('Controller');
    });

    it('parses "Target player mills 5 cards."', () => {
      const result = parseOracleText('Target player mills 5 cards.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects[0].kind).toBe('Mill');
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].type).toBe('Player');
    });
  });

  describe('counter patterns', () => {
    it('parses "Put a +1/+1 counter on target creature."', () => {
      const result = parseOracleText('Put a +1/+1 counter on target creature.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('AddCounters');

      const add = result.effects[0];
      if (add.kind !== 'AddCounters') return;
      expect(add.counterType).toBe('+1/+1');
      expect(add.count).toBe(1);
    });

    it('parses "Put 3 +1/+1 counters on target creature."', () => {
      const result = parseOracleText('Put 3 +1/+1 counters on target creature.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      const add = result.effects[0];
      if (add.kind !== 'AddCounters') return;
      expect(add.count).toBe(3);
    });
  });

  describe('tap/untap patterns', () => {
    it('parses "Tap target creature."', () => {
      const result = parseOracleText('Tap target creature.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Tap');
    });

    it('parses "Untap target creature."', () => {
      const result = parseOracleText('Untap target creature.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Untap');
    });
  });

  describe('token creation patterns', () => {
    it('parses "Create a 1/1 white soldier creature token."', () => {
      const result = parseOracleText('Create a 1/1 white soldier creature token.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('CreateToken');

      const create = result.effects[0];
      if (create.kind !== 'CreateToken') return;
      expect(create.token.power).toBe(1);
      expect(create.token.toughness).toBe(1);
      expect(create.token.colors).toContain('W');
      expect(create.count).toBe(1);
    });

    it('parses "Create 2 2/2 black zombie creature tokens."', () => {
      const result = parseOracleText('Create 2 2/2 black zombie creature tokens.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      const create = result.effects[0];
      if (create.kind !== 'CreateToken') return;
      expect(create.token.power).toBe(2);
      expect(create.token.toughness).toBe(2);
      expect(create.token.colors).toContain('B');
      expect(create.count).toBe(2);
    });
  });

  describe('scry patterns', () => {
    it('parses "Scry 2."', () => {
      const result = parseOracleText('Scry 2.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Scry');

      const scry = result.effects[0];
      if (scry.kind !== 'Scry') return;
      expect(scry.count).toBe(2);
    });
  });

  describe('discard patterns', () => {
    it('parses "Target player discards a card."', () => {
      const result = parseOracleText('Target player discards a card.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Discard');
      expect(result.targets).toHaveLength(1);
    });

    it('parses "Target player discards 2 cards."', () => {
      const result = parseOracleText('Target player discards 2 cards.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      const discard = result.effects[0];
      if (discard.kind !== 'Discard') return;
      expect(discard.count).toBe(2);
    });
  });

  describe('X cost patterns', () => {
    it('parses "~ deals X damage to any target." with xCost flag', () => {
      const result = parseOracleText('~ deals X damage to any target.', '{X}{R}');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('DealDamage');

      const dmg = result.effects[0];
      if (dmg.kind !== 'DealDamage') return;
      expect(dmg.amount).toEqual({ kind: 'X' });
      expect(result.xCost).toBe(true);
    });

    it('parses "Draw X cards."', () => {
      const result = parseOracleText('Draw X cards.', '{X}{U}');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      const draw = result.effects[0];
      if (draw.kind !== 'Draw') return;
      expect(draw.count).toEqual({ kind: 'X' });
    });
  });

  describe('modal spell patterns', () => {
    it('parses "Choose one — • Draw a card. • Gain 3 life."', () => {
      const result = parseOracleText('Choose one — • Draw a card. • Gain 3 life.');

      expect(result.kind).toBe('Modal');
      if (result.kind !== 'Modal') return;

      expect(result.modal.chooseCount).toBe(1);
      expect(result.modal.choices).toHaveLength(2);
      expect(result.modal.choices[0].effects[0].kind).toBe('Draw');
      expect(result.modal.choices[1].effects[0].kind).toBe('GainLife');
    });

    it('parses "Choose two —" modal spells', () => {
      const result = parseOracleText('Choose two — • Draw a card. • Destroy target creature.');

      expect(result.kind).toBe('Modal');
      if (result.kind !== 'Modal') return;

      expect(result.modal.chooseCount).toBe(2);
    });
  });
});

  // "Each opponent" and "all creatures" patterns
  describe('each opponent patterns', () => {
    it('parses "Each opponent loses 2 life."', () => {
      const result = parseOracleText('Each opponent loses 2 life.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('LoseLife');

      const lose = result.effects[0];
      if (lose.kind !== 'LoseLife') return;
      expect(lose.amount).toBe(2);
      expect(lose.player).toEqual({ kind: 'EachOpponent' });

      // No targets needed — applies to all opponents
      expect(result.targets).toHaveLength(0);
    });

    it('parses "Each opponent discards a card."', () => {
      const result = parseOracleText('Each opponent discards a card.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Discard');

      const discard = result.effects[0];
      if (discard.kind !== 'Discard') return;
      expect(discard.count).toBe(1);
      expect(discard.player).toEqual({ kind: 'EachOpponent' });

      expect(result.targets).toHaveLength(0);
    });

    it('parses "Each opponent discards 2 cards."', () => {
      const result = parseOracleText('Each opponent discards 2 cards.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      const discard = result.effects[0];
      if (discard.kind !== 'Discard') return;
      expect(discard.count).toBe(2);
      expect(discard.player).toEqual({ kind: 'EachOpponent' });
    });
  });

  describe('destroy all patterns', () => {
    it('parses "Destroy all creatures."', () => {
      const result = parseOracleText('Destroy all creatures.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Destroy');

      const destroy = result.effects[0];
      if (destroy.kind !== 'Destroy') return;
      expect(destroy.target).toEqual({ kind: 'AllCreatures' });

      // No targets needed — affects all creatures
      expect(result.targets).toHaveLength(0);
    });

    it('still parses "Destroy target creature." correctly', () => {
      const result = parseOracleText('Destroy target creature.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects[0].kind).toBe('Destroy');
      const destroy = result.effects[0];
      if (destroy.kind !== 'Destroy') return;
      expect(destroy.target.kind).toBe('Chosen');

      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].type).toBe('Creature');
    });
  });
