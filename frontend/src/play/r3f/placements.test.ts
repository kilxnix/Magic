import { describe, expect, it } from 'vitest';
import { buildPlacements } from './placements';
import type { GameView, PermanentView } from '../gameView.types';

function perm(id: string, name: string, extra: Partial<PermanentView> = {}): PermanentView {
  return { id, name, tapped: false, isLand: false, isCreature: false, legalActions: [], ...extra };
}

function makeView(): GameView {
  return {
    you: {
      life: 40, poison: 0, maxCommanderDamageTaken: 0,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      commandZone: [], graveyardCount: 0, libraryCount: 0, handCount: 0,
      creatures: [perm('c1', 'Bear', { isCreature: true, power: 2, toughness: 2, manaCost: '{1}{G}', colorIdentity: ['G'] })],
      artifacts: [], enchantments: [],
      lands: [perm('l1', 'Forest', { isLand: true, tapped: true }), perm('l2', 'Forest', { isLand: true })],
      other: [], hand: [], graveyard: [], exile: [],
    },
    opponents: [{
      glance: {
        playerId: 'opp', name: 'Rival', life: 40, commanderDamageToYou: 0, handCount: 7,
        openMana: 0, creatureCount: 1, totalPower: 3, flags: [],
      },
      creatures: [perm('oc1', 'Wolf', { isCreature: true, power: 3, toughness: 3 })],
      lands: [], other: [], graveyardCount: 0, exileCount: 0,
      commandZone: [], graveyard: [], exile: [],
    }],
    stack: [], priority: { hasPriority: true, isYourTurn: true, phaseLabel: 'Main', hasMeaningfulResponse: false, canPass: true, canHold: false },
    targeting: { active: false, prompt: '', minTargets: 0, maxTargets: 0, legalTargetIds: [], legalTargets: [], selectedTargetIds: [] },
    combat: { step: 'none', eligibleIds: [], eligible: [], eligibleDefenders: [], assignments: {} },
    narration: [], guided: false, isYourTurn: true, winner: null,
  };
}

describe('buildPlacements', () => {
  it('places your creatures and lands at seat 0', () => {
    const ps = buildPlacements(makeView());
    const bear = ps.find((p) => p.id === 'c1')!;
    expect(bear.seatIndex).toBe(0);
    expect(bear.isOwn).toBe(true);
    expect(bear.row).toBe('creatures');
    expect(bear.power).toBe(2);
  });

  it('carries the tapped flag', () => {
    const ps = buildPlacements(makeView());
    expect(ps.find((p) => p.id === 'l1')!.tapped).toBe(true);
    expect(ps.find((p) => p.id === 'l2')!.tapped).toBe(false);
  });

  it('places opponent permanents at seat 1', () => {
    const ps = buildPlacements(makeView());
    const wolf = ps.find((p) => p.id === 'oc1')!;
    expect(wolf.seatIndex).toBe(1);
    expect(wolf.isOwn).toBe(false);
  });

  it('gives every placement a distinct world position', () => {
    const ps = buildPlacements(makeView());
    const keys = ps.map((p) => p.position.map((n) => n.toFixed(2)).join(','));
    expect(new Set(keys).size).toBe(ps.length);
  });

  it('threads manaCost, colorIdentity and typeKind onto creature placements', () => {
    const bear = buildPlacements(makeView()).find((p) => p.id === 'c1')!;
    expect(bear.manaCost).toBe('{1}{G}');
    expect(bear.colorIdentity).toEqual(['G']);
    expect(bear.typeKind).toBe('creature');
    expect(buildPlacements(makeView()).find((p) => p.id === 'l1')!.typeKind).toBe('land');
  });

  it('renders YOUR `other` permanents (planeswalkers/battles) so they are visible and clickable', () => {
    const view = makeView();
    view.you.other = [perm('pw1', 'Teferi', { isCreature: false, isLand: false })];
    const ps = buildPlacements(view);
    const pw = ps.find((p) => p.id === 'pw1');
    expect(pw).toBeDefined();
    expect(pw!.seatIndex).toBe(0);
    expect(pw!.isOwn).toBe(true);
    expect(pw!.selectId).toBe('pw1'); // a real object to click → opens its action viewer
    expect(pw!.typeKind).toBe('other');
  });

  it('forwards isAttacking / isBlocking so the board can ring combatants', () => {
    const view = makeView();
    view.you.creatures = [perm('a1', 'Attacker', { isCreature: true, isAttacking: true })];
    view.opponents[0].creatures = [perm('b1', 'Blocker', { isCreature: true, isBlocking: true })];
    const ps = buildPlacements(view);
    expect(ps.find((p) => p.id === 'a1')!.isAttacking).toBe(true);
    expect(ps.find((p) => p.id === 'b1')!.isBlocking).toBe(true);
  });
});
