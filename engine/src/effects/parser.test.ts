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
      const result = parseOracleText('Some completely unrecognized text.');
      expect(result.kind).toBe('Unparsed');
    });

    it('parses multi-effect cards with all effects', () => {
      const result = parseOracleText('Draw a card, then discard a card.');
      expect(result.kind).toBe('Spell');
      if (result.kind === 'Spell') {
        expect(result.effects).toHaveLength(2);
        expect(result.effects[0].kind).toBe('Draw');
        expect(result.effects[1].kind).toBe('Discard');
      }
    });
  });

  describe('canParseOracleText', () => {
    it('returns true for parseable text', () => {
      expect(canParseOracleText('Draw a card.')).toBe(true);
      expect(canParseOracleText('Destroy target creature.')).toBe(true);
    });

    it('returns false for unparseable text', () => {
      expect(canParseOracleText('Some completely unrecognized text.')).toBe(false);
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
      expect(result.targets[0].type).toBe('Permanent');
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

  // ===== New parser expansion tests =====

  describe('expanded destroy patterns', () => {
    it('parses "Destroy target permanent."', () => {
      const result = parseOracleText('Destroy target permanent.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('Destroy');
      expect(result.targets[0].type).toBe('Permanent');
    });

    it('parses "Destroy target artifact."', () => {
      const result = parseOracleText('Destroy target artifact.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('Destroy');
      expect(result.targets[0].type).toBe('Artifact');
    });

    it('parses "Destroy target enchantment."', () => {
      const result = parseOracleText('Destroy target enchantment.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('Destroy');
      expect(result.targets[0].type).toBe('Enchantment');
    });

    it('parses "Destroy target artifact or enchantment."', () => {
      const result = parseOracleText('Destroy target artifact or enchantment.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('Destroy');
      expect(result.targets[0].type).toBe('ArtifactOrEnchantment');
    });
  });

  describe('expanded exile patterns', () => {
    it('parses "Exile target nonland permanent."', () => {
      const result = parseOracleText('Exile target nonland permanent.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('Exile');
      expect(result.targets[0].type).toBe('NonlandPermanent');
    });
  });

  describe('expanded bounce patterns', () => {
    it('parses "Return target nonland permanent to its owner\'s hand."', () => {
      const result = parseOracleText("Return target nonland permanent to its owner's hand.");
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('ReturnToHand');
      expect(result.targets[0].type).toBe('NonlandPermanent');
    });
  });

  describe('counter spell patterns', () => {
    it('parses "Counter target spell."', () => {
      const result = parseOracleText('Counter target spell.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('CounterSpell');
      expect(result.targets[0].type).toBe('Spell');
    });

    it('parses "Counter target noncreature spell."', () => {
      const result = parseOracleText('Counter target noncreature spell.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('CounterSpell');
      if (result.effects[0].kind !== 'CounterSpell') return;
      expect(result.effects[0].filter).toBe('noncreature');
      expect(result.targets[0].type).toBe('NoncreatureSpell');
    });
  });

  describe('graveyard recursion patterns', () => {
    it('parses "Return target creature card from your graveyard to your hand."', () => {
      const result = parseOracleText('Return target creature card from your graveyard to your hand.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('ReturnFromGraveyard');
      if (result.effects[0].kind !== 'ReturnFromGraveyard') return;
      expect(result.effects[0].destination).toBe('hand');
      expect(result.targets[0].type).toBe('CreatureCardInGraveyard');
    });

    it('parses "Return target creature card from your graveyard to the battlefield."', () => {
      const result = parseOracleText('Return target creature card from your graveyard to the battlefield.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('ReturnFromGraveyard');
      if (result.effects[0].kind !== 'ReturnFromGraveyard') return;
      expect(result.effects[0].destination).toBe('battlefield');
      expect(result.targets[0].type).toBe('CreatureCardInGraveyard');
    });
  });

  describe('P/T modification patterns', () => {
    it('parses "Target creature gets +2/+2 until end of turn."', () => {
      const result = parseOracleText('Target creature gets +2/+2 until end of turn.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('ModifyPT');
      if (result.effects[0].kind !== 'ModifyPT') return;
      expect(result.effects[0].power).toBe(2);
      expect(result.effects[0].toughness).toBe(2);
      expect(result.effects[0].untilEndOfTurn).toBe(true);
      expect(result.targets[0].type).toBe('Creature');
    });

    it('parses "Target creature gets -3/-3 until end of turn."', () => {
      const result = parseOracleText('Target creature gets -3/-3 until end of turn.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('ModifyPT');
      if (result.effects[0].kind !== 'ModifyPT') return;
      expect(result.effects[0].power).toBe(-3);
      expect(result.effects[0].toughness).toBe(-3);
    });

    it('parses "Creatures you control get +1/+1 until end of turn."', () => {
      const result = parseOracleText('Creatures you control get +1/+1 until end of turn.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('ModifyPT');
      if (result.effects[0].kind !== 'ModifyPT') return;
      expect(result.effects[0].power).toBe(1);
      expect(result.effects[0].toughness).toBe(1);
      expect(result.effects[0].target).toEqual({ kind: 'AllCreaturesYouControl' });
      expect(result.targets).toHaveLength(0); // no targeting needed
    });
  });

  describe('new trigger type patterns', () => {
    it('parses "Whenever ~ attacks, draw a card."', () => {
      const result = parseOracleText('Whenever ~ attacks, draw a card.');
      expect(result.kind).toBe('Triggered');
      if (result.kind !== 'Triggered') return;
      expect(result.ability.trigger).toEqual({ kind: 'Attacks', who: 'self' });
      expect(result.ability.effects[0].kind).toBe('Draw');
    });

    it('parses "At the beginning of your upkeep, draw a card."', () => {
      const result = parseOracleText('At the beginning of your upkeep, draw a card.');
      expect(result.kind).toBe('Triggered');
      if (result.kind !== 'Triggered') return;
      expect(result.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'yours' });
      expect(result.ability.effects[0].kind).toBe('Draw');
    });

    it('parses "At the beginning of your end step, gain 2 life."', () => {
      const result = parseOracleText('At the beginning of your end step, gain 2 life.');
      expect(result.kind).toBe('Triggered');
      if (result.kind !== 'Triggered') return;
      expect(result.ability.trigger).toEqual({ kind: 'EndStep', whose: 'yours' });
      expect(result.ability.effects[0].kind).toBe('GainLife');
    });

    it('parses "Whenever another creature enters the battlefield under your control, draw a card."', () => {
      const result = parseOracleText('Whenever another creature enters the battlefield under your control, draw a card.');
      expect(result.kind).toBe('Triggered');
      if (result.kind !== 'Triggered') return;
      expect(result.ability.trigger).toEqual({ kind: 'AnotherCreatureETB', controller: 'yours' });
      expect(result.ability.effects[0].kind).toBe('Draw');
    });

    it('parses "Whenever a creature you control dies, draw a card."', () => {
      const result = parseOracleText('Whenever a creature you control dies, draw a card.');
      expect(result.kind).toBe('Triggered');
      if (result.kind !== 'Triggered') return;
      expect(result.ability.trigger).toEqual({ kind: 'CreatureYouControlDies' });
      expect(result.ability.effects[0].kind).toBe('Draw');
    });

    it('parses "Whenever you cast a spell, draw a card."', () => {
      const result = parseOracleText('Whenever you cast a spell, draw a card.');
      expect(result.kind).toBe('Triggered');
      if (result.kind !== 'Triggered') return;
      expect(result.ability.trigger).toEqual({ kind: 'YouCastSpell' });
      expect(result.ability.effects[0].kind).toBe('Draw');
    });

    it('parses triggers with targeted effects', () => {
      const result = parseOracleText('Whenever ~ attacks, destroy target creature.');
      expect(result.kind).toBe('Triggered');
      if (result.kind !== 'Triggered') return;
      expect(result.ability.trigger).toEqual({ kind: 'Attacks', who: 'self' });
      expect(result.ability.effects[0].kind).toBe('Destroy');
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].type).toBe('Creature');
    });
  });

  describe('multi-effect parsing', () => {
    it('parses "Draw a card, then discard a card."', () => {
      const result = parseOracleText('Draw a card, then discard a card.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(2);
      expect(result.effects[0].kind).toBe('Draw');
      expect(result.effects[1].kind).toBe('Discard');
    });

    it('parses "Gain 3 life and draw a card."', () => {
      const result = parseOracleText('Gain 3 life and draw a card.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(2);
      expect(result.effects[0].kind).toBe('GainLife');
      expect(result.effects[1].kind).toBe('Draw');
    });

    it('parses ETB with multi-effect', () => {
      const result = parseOracleText('When ~ enters the battlefield, draw a card and gain 3 life.');
      expect(result.kind).toBe('ETB');
      if (result.kind !== 'ETB') return;
      expect(result.ability.effects).toHaveLength(2);
      expect(result.ability.effects[0].kind).toBe('Draw');
      expect(result.ability.effects[1].kind).toBe('GainLife');
    });

    it('parses period-separated effects', () => {
      const result = parseOracleText('Draw a card. Gain 2 life.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(2);
      expect(result.effects[0].kind).toBe('Draw');
      expect(result.effects[1].kind).toBe('GainLife');
    });
  });

  // ===== Phase 14: Expanded parser coverage tests =====

  // 1. "For each" scaling
  describe('for each scaling patterns', () => {
    it('parses "Draw a card for each creature you control."', () => {
      const result = parseOracleText('Draw a card for each creature you control.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Draw');
      if (result.effects[0].kind !== 'Draw') return;
      expect(result.effects[0].count).toEqual({
        kind: 'ForEach',
        zone: 'battlefield',
        filter: { types: ['creature'] },
        controller: 'you',
      });
    });

    it('parses "Draw a card for each artifact you control."', () => {
      const result = parseOracleText('Draw a card for each artifact you control.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('Draw');
      if (result.effects[0].kind !== 'Draw') return;
      expect(result.effects[0].count).toEqual({
        kind: 'ForEach',
        zone: 'battlefield',
        filter: { types: ['artifact'] },
        controller: 'you',
      });
    });

    it('parses "Draw a card for each card in your graveyard."', () => {
      const result = parseOracleText('Draw a card for each card in your graveyard.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('Draw');
      if (result.effects[0].kind !== 'Draw') return;
      expect(result.effects[0].count).toEqual({
        kind: 'ForEach',
        zone: 'graveyard',
        controller: 'you',
      });
    });

    it('parses "Draw a card for each creature an opponent controls."', () => {
      const result = parseOracleText('Draw a card for each creature an opponent controls.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('Draw');
      if (result.effects[0].kind !== 'Draw') return;
      expect(result.effects[0].count).toEqual({
        kind: 'ForEach',
        zone: 'battlefield',
        filter: { types: ['creature'] },
        controller: 'opponent',
      });
    });

    it('parses "~ deals damage equal to the number of creatures you control to any target."', () => {
      const result = parseOracleText('~ deals damage equal to the number of creatures you control to any target.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('DealDamage');
      if (result.effects[0].kind !== 'DealDamage') return;
      expect(result.effects[0].amount).toEqual({
        kind: 'ForEach',
        zone: 'battlefield',
        filter: { types: ['creature'] },
        controller: 'you',
      });
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].type).toBe('Any');
    });
  });

  // 2. "Exile top N cards of your library"
  describe('exile from library top patterns', () => {
    it('parses "Exile the top card of your library."', () => {
      const result = parseOracleText('Exile the top card of your library.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('ExileFromLibrary');
      if (result.effects[0].kind !== 'ExileFromLibrary') return;
      expect(result.effects[0].count).toBe(1);
    });

    it('parses "Exile the top three cards of your library."', () => {
      const result = parseOracleText('Exile the top three cards of your library.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('ExileFromLibrary');
      if (result.effects[0].kind !== 'ExileFromLibrary') return;
      expect(result.effects[0].count).toBe(3);
    });

    it('parses "Exile the top 5 cards of your library."', () => {
      const result = parseOracleText('Exile the top 5 cards of your library.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('ExileFromLibrary');
      if (result.effects[0].kind !== 'ExileFromLibrary') return;
      expect(result.effects[0].count).toBe(5);
    });

    it('parses "Exile the top three cards of your library. You may play them this turn."', () => {
      const result = parseOracleText('Exile the top three cards of your library. You may play them this turn.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('ExileFromLibrary');
      if (result.effects[0].kind !== 'ExileFromLibrary') return;
      expect(result.effects[0].count).toBe(3);
      expect(result.effects[0].mayPlay).toBe(true);
    });
  });

  // 3. "Choose one or both" modal
  describe('choose one or both modal', () => {
    it('parses "Choose one or both — • Draw a card. • Gain 3 life."', () => {
      const result = parseOracleText('Choose one or both — • Draw a card. • Gain 3 life.');
      expect(result.kind).toBe('Modal');
      if (result.kind !== 'Modal') return;
      expect(result.modal.chooseCount).toBe(2);
      expect(result.modal.upTo).toBe(true);
      expect(result.modal.choices).toHaveLength(2);
      expect(result.modal.choices[0].effects[0].kind).toBe('Draw');
      expect(result.modal.choices[1].effects[0].kind).toBe('GainLife');
    });
  });

  // 4. "Search your library for a card" (generic tutor)
  describe('generic tutor patterns', () => {
    it('parses "Search your library for a card, put it into your hand, then shuffle."', () => {
      const result = parseOracleText('Search your library for a card, put it into your hand, then shuffle.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(2);
      // Simplified as Draw 1
      expect(result.effects[0].kind).toBe('Draw');
      if (result.effects[0].kind !== 'Draw') return;
      expect(result.effects[0].count).toBe(1);
      // Plus shuffle
      expect(result.effects[1].kind).toBe('ShuffleLibrary');
    });

    it('parses "Search your library for a card."', () => {
      const result = parseOracleText('Search your library for a card.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('Draw');
    });
  });

  // 5. "Sacrifice" as an effect
  describe('sacrifice as effect patterns', () => {
    it('parses "Sacrifice a creature."', () => {
      const result = parseOracleText('Sacrifice a creature.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Sacrifice');
      if (result.effects[0].kind !== 'Sacrifice') return;
      expect(result.effects[0].player).toEqual({ kind: 'Controller' });
      expect(result.effects[0].filter).toEqual({ types: ['creature'] });
      expect(result.effects[0].count).toBe(1);
    });

    it('parses "Sacrifice an artifact."', () => {
      const result = parseOracleText('Sacrifice an artifact.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('Sacrifice');
      if (result.effects[0].kind !== 'Sacrifice') return;
      expect(result.effects[0].filter).toEqual({ types: ['artifact'] });
    });

    it('parses "Target player sacrifices a creature."', () => {
      const result = parseOracleText('Target player sacrifices a creature.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Sacrifice');
      if (result.effects[0].kind !== 'Sacrifice') return;
      expect(result.effects[0].filter).toEqual({ types: ['creature'] });
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].type).toBe('Player');
    });
  });

  // 6. "Each opponent" + "each player" effects
  describe('each opponent/player expanded patterns', () => {
    it('parses "Each opponent sacrifices a creature."', () => {
      const result = parseOracleText('Each opponent sacrifices a creature.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Sacrifice');
      if (result.effects[0].kind !== 'Sacrifice') return;
      expect(result.effects[0].player).toEqual({ kind: 'EachOpponent' });
      expect(result.effects[0].filter).toEqual({ types: ['creature'] });
    });

    it('parses "Each opponent sacrifices an artifact."', () => {
      const result = parseOracleText('Each opponent sacrifices an artifact.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('Sacrifice');
      if (result.effects[0].kind !== 'Sacrifice') return;
      expect(result.effects[0].player).toEqual({ kind: 'EachOpponent' });
      expect(result.effects[0].filter).toEqual({ types: ['artifact'] });
    });

    it('parses "Each player draws a card."', () => {
      const result = parseOracleText('Each player draws a card.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Draw');
      if (result.effects[0].kind !== 'Draw') return;
      expect(result.effects[0].player).toEqual({ kind: 'EachPlayer' });
      expect(result.effects[0].count).toBe(1);
    });

    it('parses "Each player draws 2 cards."', () => {
      const result = parseOracleText('Each player draws 2 cards.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('Draw');
      if (result.effects[0].kind !== 'Draw') return;
      expect(result.effects[0].player).toEqual({ kind: 'EachPlayer' });
      expect(result.effects[0].count).toBe(2);
    });

    it('parses "Each player sacrifices a creature."', () => {
      const result = parseOracleText('Each player sacrifices a creature.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('Sacrifice');
      if (result.effects[0].kind !== 'Sacrifice') return;
      expect(result.effects[0].player).toEqual({ kind: 'EachPlayer' });
      expect(result.effects[0].filter).toEqual({ types: ['creature'] });
    });

    it('parses "Each player discards a card."', () => {
      const result = parseOracleText('Each player discards a card.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('Discard');
      if (result.effects[0].kind !== 'Discard') return;
      expect(result.effects[0].player).toEqual({ kind: 'EachPlayer' });
      expect(result.effects[0].count).toBe(1);
    });

    it('parses "Each player loses 3 life."', () => {
      const result = parseOracleText('Each player loses 3 life.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('LoseLife');
      if (result.effects[0].kind !== 'LoseLife') return;
      expect(result.effects[0].player).toEqual({ kind: 'EachPlayer' });
      expect(result.effects[0].amount).toBe(3);
    });
  });

  // 7. "Gain control" effects
  describe('gain control patterns', () => {
    it('parses "Gain control of target creature."', () => {
      const result = parseOracleText('Gain control of target creature.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('GainControl');
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].type).toBe('Creature');
    });

    it('parses "Gain control of target permanent."', () => {
      const result = parseOracleText('Gain control of target permanent.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('GainControl');
      expect(result.targets[0].type).toBe('Permanent');
    });

    it('parses "Gain control of target artifact."', () => {
      const result = parseOracleText('Gain control of target artifact.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('GainControl');
      expect(result.targets[0].type).toBe('Artifact');
    });
  });

  // 8. "Return all" / "exile all" / "destroy all" expanded
  describe('return all / exile all / destroy all expanded patterns', () => {
    it('parses "Return all creatures to their owners\' hands."', () => {
      const result = parseOracleText("Return all creatures to their owners' hands.");
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('ReturnToHand');
      if (result.effects[0].kind !== 'ReturnToHand') return;
      expect(result.effects[0].target).toEqual({ kind: 'AllOfType', filter: { types: ['creature'] } });
      expect(result.targets).toHaveLength(0);
    });

    it('parses "Return all nonland permanents to their owners\' hands."', () => {
      const result = parseOracleText("Return all nonland permanents to their owners' hands.");
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('ReturnToHand');
      if (result.effects[0].kind !== 'ReturnToHand') return;
      expect(result.effects[0].target.kind).toBe('AllOfType');
    });

    it('parses "Exile all artifacts."', () => {
      const result = parseOracleText('Exile all artifacts.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Exile');
      if (result.effects[0].kind !== 'Exile') return;
      expect(result.effects[0].target).toEqual({ kind: 'AllOfType', filter: { types: ['artifact'] } });
    });

    it('parses "Exile all enchantments."', () => {
      const result = parseOracleText('Exile all enchantments.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('Exile');
      if (result.effects[0].kind !== 'Exile') return;
      expect(result.effects[0].target).toEqual({ kind: 'AllOfType', filter: { types: ['enchantment'] } });
    });

    it('parses "Destroy all artifacts."', () => {
      const result = parseOracleText('Destroy all artifacts.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('Destroy');
      if (result.effects[0].kind !== 'Destroy') return;
      expect(result.effects[0].target).toEqual({ kind: 'AllOfType', filter: { types: ['artifact'] } });
    });

    it('parses "Destroy all enchantments."', () => {
      const result = parseOracleText('Destroy all enchantments.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('Destroy');
      if (result.effects[0].kind !== 'Destroy') return;
      expect(result.effects[0].target).toEqual({ kind: 'AllOfType', filter: { types: ['enchantment'] } });
    });

    it('still parses "Destroy all creatures." using AllCreatures target', () => {
      const result = parseOracleText('Destroy all creatures.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('Destroy');
      if (result.effects[0].kind !== 'Destroy') return;
      // Existing behavior: AllCreatures target (not AllOfType)
      expect(result.effects[0].target).toEqual({ kind: 'AllCreatures' });
    });
  });

  // Integration: ETB with new patterns
  describe('new patterns with triggers', () => {
    it('parses "When ~ enters the battlefield, exile the top three cards of your library."', () => {
      const result = parseOracleText('When ~ enters the battlefield, exile the top three cards of your library.');
      expect(result.kind).toBe('ETB');
      if (result.kind !== 'ETB') return;
      expect(result.ability.effects[0].kind).toBe('ExileFromLibrary');
    });

    it('parses "When ~ enters the battlefield, gain control of target creature."', () => {
      const result = parseOracleText('When ~ enters the battlefield, gain control of target creature.');
      expect(result.kind).toBe('ETB');
      if (result.kind !== 'ETB') return;
      expect(result.ability.effects[0].kind).toBe('GainControl');
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].type).toBe('Creature');
    });

    it('parses "When ~ enters the battlefield, each opponent sacrifices a creature."', () => {
      const result = parseOracleText('When ~ enters the battlefield, each opponent sacrifices a creature.');
      expect(result.kind).toBe('ETB');
      if (result.kind !== 'ETB') return;
      expect(result.ability.effects[0].kind).toBe('Sacrifice');
      if (result.ability.effects[0].kind !== 'Sacrifice') return;
      expect(result.ability.effects[0].player).toEqual({ kind: 'EachOpponent' });
    });

    it('parses "When ~ enters the battlefield, draw a card for each creature you control."', () => {
      const result = parseOracleText('When ~ enters the battlefield, draw a card for each creature you control.');
      expect(result.kind).toBe('ETB');
      if (result.kind !== 'ETB') return;
      expect(result.ability.effects[0].kind).toBe('Draw');
      if (result.ability.effects[0].kind !== 'Draw') return;
      expect(result.ability.effects[0].count).toEqual({
        kind: 'ForEach',
        zone: 'battlefield',
        filter: { types: ['creature'] },
        controller: 'you',
      });
    });
  });
