import { describe, expect, it } from 'vitest';
import { zonePilePlacements } from './zonePlacements';
import type { GameView, OpponentBoard, ZoneCardView } from '../gameView.types';

function zc(id: string): ZoneCardView {
  return { id, name: id, legalActions: [] };
}

function opp(name: string, over: Partial<OpponentBoard> = {}): OpponentBoard {
  return {
    glance: { playerId: name, name, life: 40, commanderDamageToYou: 0, handCount: 7, openMana: 0, creatureCount: 0, totalPower: 0, flags: [] },
    creatures: [], lands: [], other: [], graveyardCount: 0, exileCount: 0, commandZone: [], graveyard: [], exile: [],
    ...over,
  };
}

function view(opponents: OpponentBoard[]): GameView {
  return {
    you: {
      life: 40, poison: 0, maxCommanderDamageTaken: 0,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      commandZone: [], graveyardCount: 5, libraryCount: 92, handCount: 7,
      creatures: [], artifacts: [], enchantments: [], lands: [], other: [],
      hand: [], graveyard: [zc('g1'), zc('g2')], exile: [zc('e1')],
    },
    opponents,
    stack: [], priority: { hasPriority: true, isYourTurn: true, phaseLabel: 'Main', hasMeaningfulResponse: false, canPass: true, canHold: false },
    targeting: { active: false, prompt: '', minTargets: 0, maxTargets: 0, legalTargetIds: [], legalTargets: [], selectedTargetIds: [] },
    combat: { step: 'none', eligibleIds: [], eligible: [], eligibleDefenders: [], assignments: {} },
    narration: [], guided: false, isYourTurn: true, winner: null,
  };
}

describe('zonePilePlacements', () => {
  it('emits graveyard/library/exile for you and each opponent', () => {
    const piles = zonePilePlacements(view([opp('Ana'), opp('Bo')]));
    expect(piles).toHaveLength(9); // 3 seats x 3 zones
    expect(piles.filter((p) => p.zone === 'library')).toHaveLength(3);
    const ids = piles.map((p) => p.id);
    expect(ids).toContain('you:graveyard');
    expect(ids).toContain('Ana:exile');
    expect(ids).toContain('Bo:library');
  });

  it('uses your real counts (graveyardCount, libraryCount, exile length)', () => {
    const piles = zonePilePlacements(view([opp('Ana')]));
    const mine = (z: string) => piles.find((p) => p.id === `you:${z}`)!;
    expect(mine('graveyard').count).toBe(5);
    expect(mine('library').count).toBe(92);
    expect(mine('exile').count).toBe(1); // exile array length
  });

  it('maps opponent graveyard/exile counts and hides their library size', () => {
    const piles = zonePilePlacements(view([opp('Ana', { graveyardCount: 3, exileCount: 2 })]));
    expect(piles.find((p) => p.id === 'Ana:graveyard')!.count).toBe(3);
    expect(piles.find((p) => p.id === 'Ana:exile')!.count).toBe(2);
    expect(piles.find((p) => p.id === 'Ana:library')!.count).toBeNull();
  });

  it('marks your piles isOwn and opponents not', () => {
    const piles = zonePilePlacements(view([opp('Ana')]));
    expect(piles.filter((p) => p.isOwn).every((p) => p.playerId === 'you')).toBe(true);
    expect(piles.filter((p) => !p.isOwn).every((p) => p.playerId === 'Ana')).toBe(true);
  });

  it('places each pile at a distinct position on the table', () => {
    const piles = zonePilePlacements(view([opp('Ana')]));
    const keys = piles.map((p) => `${Math.round(p.position[0] * 100)},${Math.round(p.position[2] * 100)}`);
    expect(new Set(keys).size).toBe(piles.length);
    // your piles sit on the +Z (near-camera) side of the table
    expect(piles.find((p) => p.id === 'you:library')!.position[2]).toBeGreaterThan(0);
  });
});
