import { describe, expect, it } from 'vitest';
import { buildObjectIndex, toCardView } from './interaction';
import type { GameView, PermanentView, LegalAction } from '../gameView.types';

const act: LegalAction = { source: {} as never, kind: 'cast', label: 'Cast' };
function perm(id: string, name: string, extra: Partial<PermanentView> = {}): PermanentView {
  return { id, name, tapped: false, isLand: false, isCreature: false, legalActions: [act], ...extra };
}

function view(): GameView {
  return {
    you: {
      life: 40, poison: 0, maxCommanderDamageTaken: 0,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      commandZone: [perm('cmd', 'Commander')], graveyardCount: 0, libraryCount: 0, handCount: 1,
      creatures: [perm('c1', 'Bear', { isCreature: true, power: 2, toughness: 2, tapped: true })],
      artifacts: [], enchantments: [], lands: [perm('l1', 'Forest', { isLand: true })], other: [],
      hand: [{ id: 'h1', name: 'Giant Growth', legalActions: [act] }], graveyard: [], exile: [],
    },
    opponents: [{
      glance: { playerId: 'o', name: 'R', life: 40, commanderDamageToYou: 0, handCount: 0, openMana: 0, creatureCount: 1, totalPower: 1, flags: [] },
      creatures: [perm('oc1', 'Wolf', { isCreature: true })], lands: [], other: [], graveyardCount: 0, exileCount: 0,
      commandZone: [], graveyard: [], exile: [],
    }],
    stack: [], priority: { hasPriority: true, isYourTurn: true, phaseLabel: 'M', hasMeaningfulResponse: false, canPass: true, canHold: false },
    targeting: { active: false, prompt: '', minTargets: 0, maxTargets: 0, legalTargetIds: [], legalTargets: [], selectedTargetIds: [] },
    combat: { step: 'none', eligibleIds: [], eligible: [], eligibleDefenders: [], assignments: {} },
    narration: [], guided: false, isYourTurn: true, winner: null,
  };
}

describe('buildObjectIndex', () => {
  it('indexes your board, hand, command zone, and opponent board', () => {
    const idx = buildObjectIndex(view());
    expect(idx.get('c1')!.name).toBe('Bear');
    expect(idx.get('h1')!.zone).toBe('hand');
    expect(idx.get('cmd')!.zone).toBe('command');
    expect(idx.get('oc1')!.name).toBe('Wolf');
  });

  it('carries legalActions and combat-relevant fields', () => {
    const idx = buildObjectIndex(view());
    expect(idx.get('c1')!.legalActions).toHaveLength(1);
    expect(idx.get('c1')!.tapped).toBe(true);
    expect(idx.get('c1')!.power).toBe(2);
  });
});

describe('toCardView', () => {
  it('produces a CardView the viewer can consume', () => {
    const idx = buildObjectIndex(view());
    const cv = toCardView(idx.get('c1')!);
    expect(cv.id).toBe('c1');
    expect(cv.zone).toBe('battlefield');
    expect(cv.legalActions).toHaveLength(1);
    expect(Array.isArray(cv.statuses)).toBe(true);
  });
});
