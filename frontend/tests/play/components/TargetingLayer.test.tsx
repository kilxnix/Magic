// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TargetingLayer } from '../../../src/play/components/TargetingLayer';
import type { TargetingContext } from '../../../src/play/gameView.types';

function makeTargeting(overrides: Partial<TargetingContext> = {}): TargetingContext {
  return {
    active: true,
    prompt: 'Choose a creature to destroy',
    minTargets: 1,
    maxTargets: 1,
    legalTargetIds: ['t-1', 't-2'],
    selectedTargetIds: [],
    ...overrides,
  };
}

afterEach(() => cleanup());

describe('TargetingLayer', () => {
  it('disables Confirm when selected count is below minTargets, enables it within range, and Cancel calls onCancel', () => {
    const onCancel = vi.fn();

    // Below min: 0 selected, minTargets = 1 → Confirm disabled.
    const { rerender } = render(
      <TargetingLayer
        targeting={makeTargeting({ selectedTargetIds: [] })}
        onToggleTarget={() => {}}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );

    const confirm = screen.getByTestId('targeting-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    // Within range: 1 selected, [min,max] = [1,1] → Confirm enabled.
    rerender(
      <TargetingLayer
        targeting={makeTargeting({ selectedTargetIds: ['t-1'] })}
        onToggleTarget={() => {}}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    expect((screen.getByTestId('targeting-confirm') as HTMLButtonElement).disabled).toBe(false);

    // Cancel is always available and invokes the callback.
    fireEvent.click(screen.getByTestId('targeting-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
