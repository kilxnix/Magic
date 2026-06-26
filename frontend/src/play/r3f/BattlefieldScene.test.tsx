import { describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { BattlefieldScene } from './BattlefieldScene';
import { buildPlacements } from './placements';
import type { GameView, PermanentView } from '../gameView.types';

function perm(id: string, name: string, extra: Partial<PermanentView> = {}): PermanentView {
  return { id, name, tapped: false, isLand: false, isCreature: false, legalActions: [], ...extra };
}
function view(): GameView {
  return {
    you: {
      life: 40, poison: 0, maxCommanderDamageTaken: 0,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      commandZone: [], graveyardCount: 0, libraryCount: 0, handCount: 0,
      creatures: [perm('c1', 'Bear', { isCreature: true })],
      artifacts: [], enchantments: [], lands: [perm('l1', 'Forest', { isLand: true })], other: [],
      hand: [], graveyard: [], exile: [],
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

describe('BattlefieldScene', () => {
  it('renders one card group per placement', async () => {
    const v = view();
    const expected = buildPlacements(v).length; // 3
    const r = await ReactThreeTestRenderer.create(<BattlefieldScene view={v} onSelect={() => {}} />);
    const ids = r.scene
      .findAll((n) => n.type === 'Mesh')
      .map((m) => (m.instance.userData as { id?: string }).id)
      .filter(Boolean);
    expect(new Set(ids).size).toBe(expected);
  });
});
