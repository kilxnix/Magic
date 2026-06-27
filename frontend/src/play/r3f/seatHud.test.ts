import { describe, expect, it } from 'vitest';
import { seatHuds, seatAnchor } from './seatHud';
import type { GameView, OpponentBoard, PermanentView } from '../gameView.types';

function perm(id: string, over: Partial<PermanentView> = {}): PermanentView {
  return { id, name: id, tapped: false, isLand: false, isCreature: true, legalActions: [], ...over };
}

function opp(name: string, over: Partial<OpponentBoard['glance']> = {}): OpponentBoard {
  return {
    glance: {
      playerId: name, name, life: 40, commanderDamageToYou: 0, handCount: 7,
      openMana: 0, creatureCount: 0, totalPower: 0, flags: [], ...over,
    },
    creatures: [], lands: [], other: [], graveyardCount: 0, exileCount: 0,
    commandZone: [], graveyard: [], exile: [],
  };
}

function view(opponents: OpponentBoard[]): GameView {
  return {
    you: {
      life: 33, poison: 0, maxCommanderDamageTaken: 0,
      manaPool: { W: 0, U: 1, B: 0, R: 2, G: 0, C: 0 },
      commandZone: [], graveyardCount: 0, libraryCount: 0, handCount: 4,
      creatures: [perm('a', { power: 3 }), perm('b', { power: 5 })],
      artifacts: [], enchantments: [], lands: [], other: [], hand: [], graveyard: [], exile: [],
    },
    opponents,
    stack: [], priority: { hasPriority: true, isYourTurn: true, phaseLabel: 'Main', hasMeaningfulResponse: false, canPass: true, canHold: false },
    targeting: { active: false, prompt: '', minTargets: 0, maxTargets: 0, legalTargetIds: [], legalTargets: [], selectedTargetIds: [] },
    combat: { step: 'none', eligibleIds: [], eligible: [], eligibleDefenders: [], assignments: {} },
    narration: [], guided: false, isYourTurn: true, winner: null,
  };
}

describe('seatHuds', () => {
  it('emits one HUD per seat with you first', () => {
    const huds = seatHuds(view([opp('Ana'), opp('Bo')]));
    expect(huds.map((h) => h.name)).toEqual(['You', 'Ana', 'Bo']);
    expect(huds.map((h) => h.seatIndex)).toEqual([0, 1, 2]);
    expect(huds[0].isOwn).toBe(true);
    expect(huds[1].isOwn).toBe(false);
  });

  it('derives your life, hand, threat (total power) and floating mana', () => {
    const you = seatHuds(view([opp('Ana')]))[0];
    expect(you.life).toBe(33);
    expect(you.handCount).toBe(4);
    expect(you.threat).toBe(8); // 3 + 5
    expect(you.openMana).toBe(3); // 1 U + 2 R
  });

  it('maps each opponent glance to its HUD', () => {
    const huds = seatHuds(view([opp('Ana', { life: 21, handCount: 2, totalPower: 9, openMana: 4, commanderDamageToYou: 12, flags: ['table-threat'] })]));
    const ana = huds[1];
    expect(ana.life).toBe(21);
    expect(ana.handCount).toBe(2);
    expect(ana.threat).toBe(9);
    expect(ana.openMana).toBe(4);
    expect(ana.commanderDamageToYou).toBe(12);
    expect(ana.flags).toEqual(['table-threat']);
  });

  it('anchors each seat at a distinct lifted position', () => {
    const huds = seatHuds(view([opp('Ana'), opp('Bo'), opp('Cy')]));
    for (const h of huds) expect(h.position[1]).toBeGreaterThan(0); // lifted above table
    const xs = huds.map((h) => Math.round(h.position[0] * 100) / 100);
    const zs = huds.map((h) => Math.round(h.position[2] * 100) / 100);
    // 4 seats around a circle: no two share both x and z.
    const keys = huds.map((_, i) => `${xs[i]},${zs[i]}`);
    expect(new Set(keys).size).toBe(4);
  });

  it('seatAnchor places seat 0 on the +Z axis (x≈0)', () => {
    const [x, y, z] = seatAnchor(0, 4);
    expect(x).toBeCloseTo(0);
    expect(y).toBeGreaterThan(0);
    expect(z).toBeGreaterThan(0); // your seat is on the +Z (near-camera) side
  });
});
