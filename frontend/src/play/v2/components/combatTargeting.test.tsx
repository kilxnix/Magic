import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TargetingLayerV2 } from './TargetingLayerV2';
import type { TargetingContext } from '../../gameView.types';

const targeting: TargetingContext = {
  active: true, prompt: 'Choose target creature', minTargets: 1, maxTargets: 1,
  legalTargetIds: ['t1'], legalTargets: [{ id: 't1', name: 'Llanowar Elves' }], selectedTargetIds: [],
};

describe('TargetingLayerV2', () => {
  it('toggles a target and disables Confirm until min is met', () => {
    const onToggle = vi.fn();
    render(<TargetingLayerV2 targeting={targeting} onToggleTarget={onToggle} onConfirm={() => {}} onCancel={() => {}} />);
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /llanowar elves/i }));
    expect(onToggle).toHaveBeenCalledWith('t1');
  });
});
