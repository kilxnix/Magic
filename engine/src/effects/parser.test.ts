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

    it('parses "destroy target nonblack creature" with an excluded color constraint', () => {
      const result = parseOracleText('When this creature enters, destroy target nonblack creature.');

      expect(result.kind).toBe('ETB');
      if (result.kind !== 'ETB') return;

      expect(result.ability.effects).toHaveLength(1);
      expect(result.ability.effects[0].kind).toBe('Destroy');
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0]).toMatchObject({
        type: 'Creature',
        constraints: { notColors: ['B'] },
      });
    });

    it('parses "Destroy target land."', () => {
      const result = parseOracleText('Destroy target land.');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects[0].kind).toBe('Destroy');
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].type).toBe('Land');
    });

    it('parses mana value limits on targeted removal and bounce', () => {
      const destroy = parseOracleText('Destroy target creature with mana value 3 or less.');
      expect(destroy.kind).toBe('Spell');
      if (destroy.kind !== 'Spell') return;
      expect(destroy.targets[0]).toMatchObject({
        type: 'Creature',
        constraints: { cmc: { op: 'lte', value: 3 } },
      });

      const exile = parseOracleText('Exile target nonland permanent with mana value less than 4.');
      expect(exile.kind).toBe('Spell');
      if (exile.kind !== 'Spell') return;
      expect(exile.targets[0]).toMatchObject({
        type: 'NonlandPermanent',
        constraints: { cmc: { op: 'lte', value: 3 } },
      });

      const bounce = parseOracleText("Return target creature with mana value greater than or equal to 4 to its owner's hand.");
      expect(bounce.kind).toBe('Spell');
      if (bounce.kind !== 'Spell') return;
      expect(bounce.targets[0]).toMatchObject({
        type: 'Creature',
        constraints: { cmc: { op: 'gte', value: 4 } },
      });
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

    it('parses turn-scoped life-loss and game-outcome prevention', () => {
      const life = parseOracleText("Players can't lose life this turn.");
      expect(life.kind).toBe('Spell');
      if (life.kind !== 'Spell') return;
      expect(life.effects).toEqual([
        {
          kind: 'PreventGameOutcome',
          player: { kind: 'EachPlayer' },
          preventsLoss: false,
          preventsWin: false,
          preventsLifeLoss: true,
          duration: 'turn',
        },
      ]);

      const outcome = parseOracleText("Players can't lose the game or win the game this turn.");
      expect(outcome.kind).toBe('Spell');
      if (outcome.kind !== 'Spell') return;
      expect(outcome.effects).toEqual([
        {
          kind: 'PreventGameOutcome',
          player: { kind: 'EachPlayer' },
          preventsLoss: true,
          preventsWin: true,
          preventsLifeLoss: false,
          duration: 'turn',
        },
      ]);
    });

    it('parses Everybody Lives-style full prevention text', () => {
      const result = parseOracleText(
        "Creatures you control gain indestructible until end of turn. Players can't lose life this turn. Players can't lose the game or win the game this turn.",
      );
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toEqual([
        {
          kind: 'GrantKeyword',
          target: { kind: 'AllCreaturesYouControl' },
          keyword: 'Indestructible',
          untilEndOfTurn: true,
        },
        {
          kind: 'PreventGameOutcome',
          player: { kind: 'EachPlayer' },
          preventsLoss: false,
          preventsWin: false,
          preventsLifeLoss: true,
          duration: 'turn',
        },
        {
          kind: 'PreventGameOutcome',
          player: { kind: 'EachPlayer' },
          preventsLoss: true,
          preventsWin: true,
          preventsLifeLoss: false,
          duration: 'turn',
        },
      ]);
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

    it('parses ETB triggers after leading keyword or enchant preamble text', () => {
      const aura = parseOracleText("Enchant creature When this Aura enters, tap enchanted creature. Enchanted creature doesn't untap during its controller's untap step.");
      expect(aura.kind).toBe('ETB');
      if (aura.kind !== 'ETB') return;
      expect(aura.ability.effects[0]).toMatchObject({
        kind: 'Tap',
        target: { kind: 'SourceAttachedTo' },
      });

      const keyword = parseOracleText('Menace (This creature can\'t be blocked except by two or more creatures.) When ~ enters, look at the top five cards of your library. You may reveal an Elf, Warrior, or Tyvar card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.');
      expect(keyword.kind).toBe('ETB');
      if (keyword.kind !== 'ETB') return;
      expect(keyword.ability.effects[0]).toMatchObject({
        kind: 'SearchLibrary',
        topCount: 5,
      });
    });

    it('parses opponent-graveyard reanimation ETB with haste grant', () => {
      const result = parseOracleText("Flying When this creature enters, put target creature card from an opponent's graveyard onto the battlefield under your control. It gains haste.");
      expect(result.kind).toBe('ETB');
      if (result.kind !== 'ETB') return;
      expect(result.ability.effects).toHaveLength(3);
      expect(result.ability.effects[0]).toMatchObject({
        kind: 'ReturnFromGraveyard',
        destination: 'battlefield',
      });
      expect(result.ability.effects[1]).toMatchObject({ kind: 'GainControl' });
      expect(result.ability.effects[2]).toMatchObject({
        kind: 'GrantKeyword',
        keyword: 'Haste',
      });
      expect(result.targets[0].type).toBe('CreatureCardInGraveyard');
      expect(result.targets[0].constraints).toEqual({ opponentControls: true });
    });

    it('parses bounce-land ETBs that return a land you control', () => {
      const result = parseOracleText("This land enters tapped. When this land enters, return a land you control to its owner's hand. {T}: Add {G}{W}.");
      expect(result.kind).toBe('ETB');
      if (result.kind !== 'ETB') return;
      expect(result.ability.effects[0]).toMatchObject({ kind: 'ReturnToHand' });
      expect(result.targets[0].type).toBe('Land');
    });

    it('parses enchanted-creature dies triggers after enchant preamble text', () => {
      const result = parseOracleText("Enchant creature Enchanted creature gets +1/+1. When enchanted creature dies, return that card to its owner's hand.");
      expect(result.kind).toBe('Dies');
      if (result.kind !== 'Dies') return;
      expect(result.ability.trigger).toEqual({ kind: 'AttachedCreatureDies' });
      expect(result.ability.effects[0]).toMatchObject({
        kind: 'ReturnToHand',
        target: { kind: 'EventSpell' },
      });
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

    it('parses energy counter gain', () => {
      const result = parseOracleText('You get {E}{E} (two energy counters).');

      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;

      expect(result.effects[0].kind).toBe('AddCounters');
      if (result.effects[0].kind !== 'AddCounters') return;
      expect(result.effects[0].target).toEqual({ kind: 'Controller' });
      expect(result.effects[0].counterType).toBe('energy');
      expect(result.effects[0].count).toBe(2);
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

    it('parses land tap and untap targeting', () => {
      const tap = parseOracleText('Tap target land.');
      expect(tap.kind).toBe('Spell');
      if (tap.kind !== 'Spell') return;
      expect(tap.effects[0].kind).toBe('Tap');
      expect(tap.targets[0].type).toBe('Land');

      const untap = parseOracleText('Untap target land.');
      expect(untap.kind).toBe('Spell');
      if (untap.kind !== 'Spell') return;
      expect(untap.effects[0].kind).toBe('Untap');
      expect(untap.targets[0].type).toBe('Land');
    });

    it('parses "Untap up to seven lands."', () => {
      const result = parseOracleText('Untap up to seven lands.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('Untap');
      if (result.effects[0].kind !== 'Untap') return;
      expect(result.effects[0].target).toEqual({ kind: 'AllOfType', filter: { types: ['land'] } });
      expect(result.effects[0].maxCount).toBe(7);
      expect(result.targets).toHaveLength(0);
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

  describe('d20 roll patterns', () => {
    it('parses Goblin Morningstar-style roll tables as one d20 effect', () => {
      const result = parseOracleText(
        'When Goblin Morningstar enters the battlefield, roll a d20. 1-9 | Create a 1/1 red Goblin creature token. 10-20 | Create a 1/1 red Goblin creature token, then attach Goblin Morningstar to it. Equipped creature gets +1/+0 and has trample.',
      );

      expect(result.kind).toBe('ETB');
      if (result.kind !== 'ETB') return;

      expect(result.ability.effects).toHaveLength(1);
      const roll = result.ability.effects[0];
      expect(roll.kind).toBe('RollD20');
      if (roll.kind !== 'RollD20') return;

      expect(roll.outcomes).toHaveLength(2);
      expect(roll.outcomes[0].effects[0].kind).toBe('CreateToken');
      const highRollCreate = roll.outcomes[1].effects[0];
      expect(highRollCreate.kind).toBe('CreateToken');
      if (highRollCreate.kind !== 'CreateToken') return;
      expect(highRollCreate.attachSourceToCreated).toBe(true);
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
      expect(result.modal.choices[0].label).toBe('Draw a card');
      expect(result.modal.choices[1].label).toBe('Gain 3 life');
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

  describe('fight patterns', () => {
    it("parses target creature fight spells with opposing target constraints", () => {
      const result = parseOracleText("Target creature you control fights target creature you don't control.");
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0]).toMatchObject({ kind: 'Fight' });
      expect(result.targets[0]).toMatchObject({
        type: 'Creature',
        constraints: { controllerControls: true },
      });
      expect(result.targets[1]).toMatchObject({
        type: 'Creature',
        constraints: { opponentControls: true },
      });
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

    it('parses "Counter target creature spell."', () => {
      const result = parseOracleText('Counter target creature spell.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('CounterSpell');
      if (result.effects[0].kind !== 'CounterSpell') return;
      expect(result.effects[0].filter).toBe('creature');
      expect(result.targets[0].type).toBe('CreatureSpell');
    });

    it('parses counter-and-exile riders for creature or enchantment spells', () => {
      const result = parseOracleText("Counter target creature or enchantment spell. If that spell is countered this way, exile it instead of putting it into its owner's graveyard.");
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('CounterSpell');
      if (result.effects[0].kind !== 'CounterSpell') return;
      expect(result.effects[0].filter).toBe('creatureOrEnchantment');
      expect(result.effects[0].exileInstead).toBe(true);
      expect(result.targets[0].type).toBe('CreatureOrEnchantmentSpell');
    });
  });

  describe('graveyard recursion patterns', () => {
    it('parses up-to-one graveyard reanimation with a keyword counter', () => {
      const result = parseOracleText('Lifelink When this creature enters, return up to one target creature card from your graveyard to the battlefield with a lifelink counter on it.');
      expect(result.kind).toBe('ETB');
      if (result.kind !== 'ETB') return;
      expect(result.ability.effects[0]).toMatchObject({
        kind: 'ReturnFromGraveyard',
        destination: 'battlefield',
        counters: ['lifelink'],
      });
      expect(result.targets[0].type).toBe('CreatureCardInGraveyard');
    });

    it('parses ETB graveyard exile triggers like Disposal Mummy', () => {
      const result = parseOracleText("When this creature enters, exile target card from an opponent's graveyard.");
      expect(result.kind).toBe('ETB');
      if (result.kind !== 'ETB') return;
      expect(result.ability.effects[0].kind).toBe('Exile');
      expect(result.targets[0].type).toBe('CardInGraveyard');
      expect(result.targets[0].constraints?.opponentControls).toBe(true);
    });

    it("parses \"Exile target card from an opponent's graveyard.\"", () => {
      const result = parseOracleText("Exile target card from an opponent's graveyard.");
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('Exile');
      expect(result.targets[0].type).toBe('CardInGraveyard');
      expect(result.targets[0].constraints?.opponentControls).toBe(true);
    });

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

    it('parses "Return target creature or enchantment card from your graveyard to your hand."', () => {
      const result = parseOracleText('Return target creature or enchantment card from your graveyard to your hand.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('ReturnFromGraveyard');
      if (result.effects[0].kind !== 'ReturnFromGraveyard') return;
      expect(result.effects[0].destination).toBe('hand');
      expect(result.targets[0].type).toBe('CreatureOrEnchantmentCardInGraveyard');
    });
  });

  describe('P/T modification patterns', () => {
    it('parses attack triggers where "it gets" modifies the source creature', () => {
      const result = parseOracleText('Whenever this creature attacks, it gets +0/+2 until end of turn.');
      expect(result.kind).toBe('Triggered');
      if (result.kind !== 'Triggered') return;
      expect(result.ability.trigger.kind).toBe('Attacks');
      expect(result.ability.effects[0].kind).toBe('ModifyPT');
      if (result.ability.effects[0].kind !== 'ModifyPT') return;
      expect(result.ability.effects[0].target.kind).toBe('Source');
      expect(result.ability.effects[0].power).toBe(0);
      expect(result.ability.effects[0].toughness).toBe(2);
      expect(result.ability.effects[0].untilEndOfTurn).toBe(true);
    });

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

    it('parses colored controlled creature pump targets', () => {
      const result = parseOracleText('Target green creature you control gets +2/+2 until end of turn.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('ModifyPT');
      expect(result.targets[0]).toMatchObject({
        type: 'Creature',
        constraints: { colors: ['G'], controllerControls: true },
      });
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

    it('parses green pump into fight sequences with constrained fight targets', () => {
      const result = parseOracleText('Target green creature you control gets +2/+2 until end of turn. It fights target green creature an opponent controls.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(2);
      expect(result.effects[0].kind).toBe('ModifyPT');
      expect(result.effects[1].kind).toBe('Fight');
      expect(result.targets[0]).toMatchObject({ type: 'Creature', constraints: { colors: ['G'], controllerControls: true } });
      expect(result.targets[1]).toMatchObject({ type: 'Creature', constraints: { colors: ['G'], opponentControls: true } });
    });

    it('parses temporary power loss plus keyword loss on an attacking trigger', () => {
      const result = parseOracleText('Whenever this creature attacks, target creature defending player controls gets -2/-0 and loses flying until your next turn.');
      expect(result.kind).toBe('Triggered');
      if (result.kind !== 'Triggered') return;
      expect(result.ability.trigger).toEqual({ kind: 'Attacks', who: 'self' });
      expect(result.ability.effects).toHaveLength(2);
      expect(result.ability.effects[0]).toMatchObject({
        kind: 'ModifyPT',
        power: -2,
        toughness: -0,
      });
      expect(result.ability.effects[1]).toMatchObject({
        kind: 'LoseKeyword',
        keyword: 'Flying',
      });
      expect(result.targets[0].type).toBe('Creature');
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

    it('parses team pump plus keyword grant in one clause', () => {
      const result = parseOracleText('When ~ enters, creatures you control get +1/+1 and gain vigilance until end of turn.');
      expect(result.kind).toBe('ETB');
      if (result.kind !== 'ETB') return;
      expect(result.ability.effects).toHaveLength(2);
      expect(result.ability.effects[0]).toMatchObject({
        kind: 'ModifyPT',
        target: { kind: 'AllCreaturesYouControl' },
        power: 1,
        toughness: 1,
      });
      expect(result.ability.effects[1]).toMatchObject({
        kind: 'GrantKeyword',
        target: { kind: 'AllCreaturesYouControl' },
        keyword: 'Vigilance',
      });
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

    it('parses unblocked attack triggers', () => {
      const result = parseOracleText("Whenever this creature attacks and isn't blocked, it gets +2/+0 until end of combat.");
      expect(result.kind).toBe('Triggered');
      if (result.kind !== 'Triggered') return;
      expect(result.ability.trigger).toEqual({ kind: 'Unblocked', who: 'self' });
      expect(result.ability.effects[0]).toMatchObject({
        kind: 'ModifyPT',
        target: { kind: 'Source' },
        power: 2,
        toughness: 0,
      });
    });

    it('parses "Whenever this creature becomes tapped" as a self tapped trigger', () => {
      const result = parseOracleText('Whenever this creature becomes tapped, create a 1/1 red Goblin creature token.');
      expect(result.kind).toBe('Triggered');
      if (result.kind !== 'Triggered') return;
      expect(result.ability.trigger).toEqual({ kind: 'BecomesTapped', who: 'self' });
      expect(result.ability.effects[0].kind).toBe('CreateToken');
    });

    it('parses named artifact-token creation from becomes-tapped trigger text', () => {
      const result = parseOracleText('Whenever this creature becomes tapped, create a Lander token. (It\'s an artifact with "{2}, {T}, Sacrifice this token: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.")');
      expect(result.kind).toBe('Triggered');
      if (result.kind !== 'Triggered') return;
      expect(result.ability.trigger).toEqual({ kind: 'BecomesTapped', who: 'self' });
      expect(result.ability.effects[0]).toMatchObject({
        kind: 'CreateToken',
        token: {
          name: 'Lander',
          types: ['artifact'],
          subtypes: ['Lander'],
        },
      });
    });

    it('parses "At the beginning of your upkeep, draw a card."', () => {
      const result = parseOracleText('At the beginning of your upkeep, draw a card.');
      expect(result.kind).toBe('Triggered');
      if (result.kind !== 'Triggered') return;
      expect(result.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'yours' });
      expect(result.ability.effects[0].kind).toBe('Draw');
    });

    it('parses beginning-combat target boost triggers with dynamic target power', () => {
      const result = parseOracleText("At the beginning of combat on your turn, another target creature you control gains haste until end of turn and gets +X/+X until end of turn, where X is that creature's power.");
      expect(result.kind).toBe('Triggered');
      if (result.kind !== 'Triggered') return;
      expect(result.ability.trigger).toEqual({ kind: 'BeginningCombat', whose: 'yours' });
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0]).toMatchObject({
        type: 'Creature',
        constraints: { controllerControls: true, notSource: true },
      });
      expect(result.ability.effects[0].kind).toBe('GrantKeyword');
      expect(result.ability.effects[1].kind).toBe('ModifyPT');
      if (result.ability.effects[1].kind !== 'ModifyPT') return;
      expect(result.ability.effects[1].power).toEqual({
        kind: 'TargetPower',
        target: { kind: 'Chosen', targetId: result.targets[0].id },
      });
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

    it('parses targeted opponent hand-count mana', () => {
      const result = parseOracleText("Add {R} for each card in target opponent's hand.");
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0]).toMatchObject({ type: 'Player', constraints: { opponentControls: true } });
      expect(result.effects[0].kind).toBe('AddMana');
      if (result.effects[0].kind !== 'AddMana') return;
      expect(result.effects[0].mana.R).toEqual({
        kind: 'ForEach',
        zone: 'hand',
        controller: 'target',
        target: { kind: 'Chosen', targetId: result.targets[0].id },
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

    it('parses named-source damage equal to greatest mana value among permanents you control', () => {
      const result = parseOracleText('Torrent of Fire deals damage to any target equal to the greatest mana value among permanents you control.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('DealDamage');
      if (result.effects[0].kind !== 'DealDamage') return;
      expect(result.effects[0].amount).toEqual({
        kind: 'GreatestManaValue',
        zone: 'battlefield',
        filter: { permanent: true },
        controller: 'you',
      });
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
    it('parses look-at-top reveal filters into a top-library search prompt effect', () => {
      const result = parseOracleText('Look at the top four cards of your library. You may reveal a Human card from among them and put it into your hand. Put the rest on the bottom of your library in any order.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0]).toMatchObject({
        kind: 'SearchLibrary',
        filter: {
          anyOf: [
            { subtypes: ['Human'] },
            { nameIncludes: ['Human'] },
          ],
        },
        destination: 'hand',
        topCount: 4,
        putUnselectedTopCardsOnBottom: true,
        selectedCardChoiceId: 'lookTopCardId',
      });
    });

    it('parses multiple reveal filters from top-library selection effects', () => {
      const result = parseOracleText('Look at the top five cards of your library. You may reveal an Elf, Warrior, or Tyvar card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0]).toMatchObject({
        kind: 'SearchLibrary',
        filter: {
          anyOf: expect.arrayContaining([
            { subtypes: ['Elf'] },
            { nameIncludes: ['Tyvar'] },
          ]),
        },
        topCount: 5,
      });
    });

    it('parses up-to-N named-card library searches with prompt selection limits', () => {
      const result = parseOracleText('Search your library for up to three cards named Squadron Hawk, reveal them, put them into your hand, then shuffle.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0]).toMatchObject({
        kind: 'SearchLibrary',
        filter: { names: ['Squadron Hawk'] },
        destination: 'hand',
        minSelections: 0,
        maxSelections: 3,
        shuffle: true,
      });
    });

    it('parses "Search your library for a card, put it into your hand, then shuffle."', () => {
      const result = parseOracleText('Search your library for a card, put it into your hand, then shuffle.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toHaveLength(2);
      expect(result.effects[0]).toMatchObject({
        kind: 'SearchLibrary',
        filter: {},
        destination: 'hand',
        namedCardChoiceId: 'tutorCard',
        selectedCardChoiceId: 'tutorCardId',
      });
      // Plus shuffle
      expect(result.effects[1].kind).toBe('ShuffleLibrary');
    });

    it('parses "Search your library for a card."', () => {
      const result = parseOracleText('Search your library for a card.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0]).toMatchObject({
        kind: 'SearchLibrary',
        filter: {},
        destination: 'hand',
      });
    });

    it('parses arbitrary subtype card searches without forcing creature type', () => {
      const result = parseOracleText('Search your library for a Shrine card, reveal it, put it into your hand, then shuffle.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0]).toMatchObject({
        kind: 'SearchLibrary',
        filter: { subtypes: ['Shrine'] },
        destination: 'hand',
      });
    });

    it('parses mana value limits on library searches', () => {
      const result = parseOracleText('Search your library for a creature card with mana value 3 or less, reveal it, put it into your hand, then shuffle.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0]).toMatchObject({
        kind: 'SearchLibrary',
        filter: {
          types: ['creature'],
          cmc: { op: 'lte', value: 3 },
        },
        destination: 'hand',
      });
    });

    it('parses strict and inclusive mana value phrases on static subjects', () => {
      const strict = parseOracleText('Creature spells with mana value less than 3 cost {1} less to cast.');
      expect(strict.kind).toBe('StaticAbility');
      if (strict.kind !== 'StaticAbility') return;
      expect(strict.ability.filter).toMatchObject({
        types: ['creature'],
        cmc: { op: 'lte', value: 2 },
      });

      const inclusive = parseOracleText('Creature spells with mana value greater than or equal to 4 cost {1} more to cast.');
      expect(inclusive.kind).toBe('StaticAbility');
      if (inclusive.kind !== 'StaticAbility') return;
      expect(inclusive.ability.filter).toMatchObject({
        types: ['creature'],
        cmc: { op: 'gte', value: 4 },
      });
    });

    it('parses known noncreature and supertype search filters', () => {
      const auraResult = parseOracleText('Search your library for an Aura card, put it into your hand, then shuffle.');
      expect(auraResult.kind).toBe('Spell');
      if (auraResult.kind !== 'Spell') return;
      expect(auraResult.effects[0]).toMatchObject({
        kind: 'SearchLibrary',
        filter: { subtypes: ['Aura'] },
      });

      const permanentResult = parseOracleText('Search your library for a permanent card, put it into your hand, then shuffle.');
      expect(permanentResult.kind).toBe('Spell');
      if (permanentResult.kind !== 'Spell') return;
      expect(permanentResult.effects[0]).toMatchObject({
        kind: 'SearchLibrary',
        filter: { permanent: true },
      });
    });
  });

  describe('unless sacrifice ETB patterns', () => {
    it('parses sacrifice-self unless target opponent sacrifices a creature', () => {
      const result = parseOracleText('When Brain Gorgers enters the battlefield, sacrifice it unless target opponent sacrifices a creature.');
      expect(result.kind).toBe('ETB');
      if (result.kind !== 'ETB') return;
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0]).toMatchObject({ type: 'Player', constraints: { opponentControls: true } });
      expect(result.ability.effects[0]).toMatchObject({
        kind: 'SacrificeSelfUnlessPlayerSacrifices',
        filter: { types: ['creature'] },
        count: 1,
      });
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

    it('parses "Exile all graveyards."', () => {
      const result = parseOracleText('Exile all graveyards.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects).toEqual([{ kind: 'ExileAllGraveyards' }]);
    });

    it('parses Farewell-style choose-one-or-more modes without collapsing to one mode', () => {
      const result = parseOracleText('Choose one or more — • Exile all artifacts. • Exile all creatures. • Exile all enchantments. • Exile all graveyards.');
      expect(result.kind).toBe('Modal');
      if (result.kind !== 'Modal') return;
      expect(result.modal.chooseCount).toBe(4);
      expect(result.modal.upTo).toBe(true);
      expect(result.modal.choices.map(choice => choice.effects[0]?.kind)).toEqual([
        'Exile',
        'Exile',
        'Exile',
        'ExileAllGraveyards',
      ]);
    });

    it('parses "Exile all multicolored permanents."', () => {
      const result = parseOracleText('Exile all multicolored permanents.');
      expect(result.kind).toBe('Spell');
      if (result.kind !== 'Spell') return;
      expect(result.effects[0].kind).toBe('Exile');
      if (result.effects[0].kind !== 'Exile') return;
      expect(result.effects[0].target).toEqual({ kind: 'AllOfType', filter: { multicolored: true } });
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

describe('regex edge cases (task 14)', () => {
  it('P/T modifier +0/+2 is parsed as power=0 toughness=2', () => {
    const match = '+0/+2'.match(/^([+-]\d+)\/([+-]\d+)$/);
    expect(match).not.toBeNull();
    expect(parseInt(match![1], 10)).toBe(0);
    expect(parseInt(match![2], 10)).toBe(2);
  });

  it('P/T modifier -1/+0 is parsed', () => {
    const match = '-1/+0'.match(/^([+-]\d+)\/([+-]\d+)$/);
    expect(match).not.toBeNull();
    expect(parseInt(match![1], 10)).toBe(-1);
    expect(parseInt(match![2], 10)).toBe(0);
  });

  it('loyalty regex accepts ASCII hyphen, em-dash, en-dash, plus, zero', () => {
    const re = /^([+\-−–]?\d+)\s*:/;
    expect(re.test('−3: Exile target permanent')).toBe(true);   // U+2212 MINUS SIGN
    expect(re.test('–1: Create a token')).toBe(true);           // U+2013 EN DASH
    expect(re.test('+2: Draw a card')).toBe(true);
    expect(re.test('-3: Destroy target')).toBe(true);            // ASCII hyphen
    expect(re.test('0: Flip a coin')).toBe(true);
  });
});

describe('counter pattern matchers (task 17)', () => {
  it('parses "put a +1/+1 counter on ~"', () => {
    const result = parseOracleText('Put a +1/+1 counter on ~.');

    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    expect(result.effects).toHaveLength(1);
    expect(result.effects[0].kind).toBe('AddCounters');

    const add = result.effects[0];
    if (add.kind !== 'AddCounters') return;
    expect(add.counterType).toBe('+1/+1');
    expect(add.count).toBe(1);
    // targets array should be empty since ~ refers to the card itself
    expect(result.targets).toHaveLength(0);
  });

  it('parses counters placed on this artifact as source-targeted', () => {
    const result = parseOracleText('Put a charge counter on this artifact.');

    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects[0]).toMatchObject({
      kind: 'AddCounters',
      target: { kind: 'Source' },
      counterType: 'charge',
      count: 1,
    });
    expect(result.targets).toHaveLength(0);
  });

  it('parses "put a flying counter on target creature"', () => {
    const result = parseOracleText('Put a flying counter on target creature.');

    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    expect(result.effects).toHaveLength(1);
    expect(result.effects[0].kind).toBe('AddCounters');

    const add = result.effects[0];
    if (add.kind !== 'AddCounters') return;
    expect(add.counterType).toBe('flying');
    expect(add.count).toBe(1);
    expect(result.targets[0].type).toBe('Creature');
  });

  it('parses "target player gets 3 poison counters"', () => {
    const result = parseOracleText('Target player gets 3 poison counters.');

    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    expect(result.effects).toHaveLength(1);
    expect(result.effects[0].kind).toBe('AddCounters');

    const add = result.effects[0];
    if (add.kind !== 'AddCounters') return;
    expect(add.counterType).toBe('poison');
    expect(add.count).toBe(3);
    expect(result.targets[0].type).toBe('Player');
  });

  it('parses "put a stun counter on target permanent"', () => {
    const result = parseOracleText('Put a stun counter on target permanent.');

    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    expect(result.effects).toHaveLength(1);
    expect(result.effects[0].kind).toBe('AddCounters');

    const add = result.effects[0];
    if (add.kind !== 'AddCounters') return;
    expect(add.counterType).toBe('stun');
    expect(add.count).toBe(1);
    expect(result.targets[0].type).toBe('Permanent');
  });

  describe('landfall (concise modern phrasing)', () => {
    it('parses "Whenever a land you control enters," as a Landfall trigger', () => {
      const result = parseOracleText(
        'Whenever a land you control enters, create a 5/5 red and green Elemental creature token.',
      );
      expect(result.kind).toBe('Triggered');
      if (result.kind !== 'Triggered') return;
      expect(result.ability.trigger.kind).toBe('Landfall');
    });

    it('still parses "Whenever a land enters the battlefield under your control," as Landfall', () => {
      const result = parseOracleText(
        'Whenever a land enters the battlefield under your control, you gain 1 life.',
      );
      expect(result.kind).toBe('Triggered');
      if (result.kind !== 'Triggered') return;
      expect(result.ability.trigger.kind).toBe('Landfall');
    });
  });
});
