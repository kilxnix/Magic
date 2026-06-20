import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ZoneExplorerV2 } from './ZoneExplorerV2';
import type { GameView } from '../../gameView.types';

function viewWithGraveyard(): GameView {
  return {
    you: {
      life: 40, poison: 0, maxCommanderDamageTaken: 0,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, commandZone: [],
      graveyardCount: 1, libraryCount: 99, handCount: 0,
      creatures: [], artifacts: [], enchantments: [], lands: [], other: [], hand: [],
      graveyard: [{ id: 'g1', name: 'Eternal Witness', legalActions: [] }], exile: [],
    },
    opponents: [], stack: [],
    priority: { hasPriority: false, isYourTurn: true, phaseLabel: '', hasMeaningfulResponse: false, canPass: false, canHold: false },
    targeting: { active: false, prompt: '', minTargets: 0, maxTargets: 0, legalTargetIds: [], legalTargets: [], selectedTargetIds: [] },
    combat: { step: 'none', eligibleIds: [], eligible: [], eligibleDefenders: [], assignments: {} },
    narration: [], guided: false, isYourTurn: true, winner: null,
  };
}

describe('ZoneExplorerV2', () => {
  it('lists your graveyard and opens a card in the viewer', () => {
    const onView = vi.fn();
    render(<ZoneExplorerV2 view={viewWithGraveyard()} target={{ playerId: 'you', zone: 'graveyard' }} onClose={() => {}} onView={onView} />);
    fireEvent.click(screen.getByRole('button', { name: /eternal witness/i }));
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1', zone: 'graveyard' }));
  });
});
