import { describe, expect, it } from 'vitest';
import { buildGameView } from '../../src/play/useGameView';
import {
  makeState,
  makePlayer,
  makeCreature,
  makeLand,
  makeCard,
  makeStackItem,
  makeLegalAction,
} from './fixtures/simpleState';

describe('buildGameView', () => {
  it('returns an empty view when gameState is null', () => {
    const view = buildGameView({
      gameState: null,
      legalActions: [],
      isHumanTurn: false,
      winner: null,
      guided: false,
    });
    expect(view.you.life).toBe(0);
    expect(view.opponents).toEqual([]);
    expect(view.stack).toEqual([]);
    expect(view.isYourTurn).toBe(false);
    expect(view.priority.canPass).toBe(false);
  });

  it('buckets the human board into creatures / artifacts / enchantments / lands / other', () => {
    const view = buildGameView({
      gameState: makeState({
        humanPlayer: makePlayer({ life: 37 }),
        humanBattlefield: [
          makeCreature({ instanceId: 'c1' }),
          makeLand({ instanceId: 'l1' }),
          makeCard({ instanceId: 'a1', typeLine: 'Artifact', cardTypes: ['artifact'] }),
        ],
      }),
      legalActions: [],
      isHumanTurn: true,
      winner: null,
      guided: false,
    });
    expect(view.you.life).toBe(37);
    expect(view.you.creatures.map(c => c.id)).toEqual(['c1']);
    expect(view.you.lands.map(c => c.id)).toEqual(['l1']);
    // An artifact now buckets into its own row (5-zone), not the generic "other".
    expect(view.you.artifacts.map(c => c.id)).toEqual(['a1']);
    expect(view.you.other).toEqual([]);
  });

  it('stacks identical untapped lands into one tile with a count', () => {
    const view = buildGameView({
      gameState: makeState({
        humanBattlefield: [
          makeLand({ instanceId: 'f1', name: 'Forest' }),
          makeLand({ instanceId: 'f2', name: 'Forest' }),
          makeLand({ instanceId: 'f3', name: 'Forest' }),
          makeLand({ instanceId: 'i1', name: 'Island' }),
        ],
      }),
      legalActions: [],
      isHumanTurn: true,
      winner: null,
      guided: false,
    });
    // 3 Forests collapse to one tile (×3); the Island is its own tile.
    expect(view.you.lands).toHaveLength(2);
    const forest = view.you.lands.find(l => l.name === 'Forest');
    expect(forest?.stackCount).toBe(3);
    expect(view.you.lands.find(l => l.name === 'Island')?.stackCount).toBeUndefined();
  });

  it('attaches each object its own legal actions and a top-level pass', () => {
    const view = buildGameView({
      gameState: makeState({
        humanHand: [makeCard({ instanceId: 'h1', name: 'Doom Blade', manaCost: '{1}{B}' })],
        humanBattlefield: [makeLand({ instanceId: 'l1' })],
      }),
      legalActions: [
        makeLegalAction({ kind: 'CastSpell', cardInstanceId: 'h1', label: 'Cast — {1}{B}' }),
        makeLegalAction({ kind: 'ActivateManaAbility', cardInstanceId: 'l1', label: 'Tap for B' }),
        makeLegalAction({ kind: 'PassPriority', label: 'Pass' }),
      ],
      isHumanTurn: true,
      winner: null,
      guided: false,
    });
    expect(view.you.hand[0].legalActions.map(a => a.kind)).toEqual(['cast']);
    expect(view.you.lands[0].legalActions.map(a => a.kind)).toEqual(['activate']);
    expect(view.priority.canPass).toBe(true);
    expect(view.priority.hasMeaningfulResponse).toBe(true);
  });

  it('builds opponent boards with a glance and bucketed permanents', () => {
    const ai = makePlayer({ id: 'ai1', name: 'Atraxa', life: 30, handCount: 5 });
    const view = buildGameView({
      gameState: makeState({
        aiPlayers: [ai],
        aiCommanderNames: { ai1: 'Atraxa' },
        aiBattlefields: {
          ai1: [
            makecreatureFor('ai1', 'oc1', 4),
            makeLand({ instanceId: 'ol1', ownerId: 'ai1' }),
          ],
        },
        aiGraveyards: { ai1: [makeCard({ instanceId: 'g1', ownerId: 'ai1' })] },
        aiCommandZones: { ai1: [] },
      }),
      legalActions: [],
      isHumanTurn: true,
      winner: null,
      guided: false,
    });
    expect(view.opponents).toHaveLength(1);
    const board = view.opponents[0];
    expect(board.glance.playerId).toBe('ai1');
    expect(board.glance.life).toBe(30);
    expect(board.glance.handCount).toBe(5);
    expect(board.glance.creatureCount).toBe(1);
    expect(board.glance.totalPower).toBe(4);
    expect(board.creatures.map(c => c.id)).toEqual(['oc1']);
    expect(board.lands.map(c => c.id)).toEqual(['ol1']);
    expect(board.graveyardCount).toBe(1);
  });

  it('composes the stack LIFO with resolvesNext on the top', () => {
    const view = buildGameView({
      gameState: makeState({
        stack: [
          makeStackItem({ id: 's1', name: 'Cultivate', casterId: 'human' }),
          makeStackItem({ id: 's2', name: 'Counterspell', casterId: 'ai1' }),
        ],
      }),
      legalActions: [],
      isHumanTurn: true,
      winner: null,
      guided: false,
    });
    expect(view.stack.map(s => s.id)).toEqual(['s2', 's1']);
    expect(view.stack[0].resolvesNext).toBe(true);
    expect(view.stack[0].controllerName).toBe('AI One');
  });

  it('passes through guided / isYourTurn / winner', () => {
    const view = buildGameView({
      gameState: makeState({ winnerId: 'human' }),
      legalActions: [],
      isHumanTurn: true,
      winner: 'human',
      guided: true,
    });
    expect(view.guided).toBe(true);
    expect(view.isYourTurn).toBe(true);
    expect(view.winner).toBe('human');
  });

  it('marks human attackers as isAttacking from committed combat assignments', () => {
    const view = buildGameView({
      gameState: makeState({
        step: 'declare_attackers',
        humanBattlefield: [makeCreature({ instanceId: 'atk1' })],
      }),
      legalActions: [
        makeLegalAction({
          kind: 'DeclareAttackers',
          label: 'Attack',
          _engineAction: {
            kind: 'DeclareAttackers',
            attacks: [{ cardInstanceId: 'atk1', defendingPlayerId: 'ai1' }],
          } as never,
        }),
      ],
      isHumanTurn: true,
      winner: null,
      guided: false,
    });
    expect(view.combat.step).toBe('declare-attackers');
    expect(view.combat.eligibleIds).toEqual(['atk1']);
  });
});

// Helper local to this test: an opponent creature with a known power.
function makecreatureFor(ownerId: string, instanceId: string, power: number) {
  return makeCreature({ instanceId, ownerId, power, toughness: power });
}
