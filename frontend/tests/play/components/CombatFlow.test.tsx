// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { CombatFlow } from '../../../src/play/components/CombatFlow';
import type { CombatContext } from '../../../src/play/gameView.types';

afterEach(() => cleanup());

function makeCombat(overrides: Partial<CombatContext> = {}): CombatContext {
  return {
    step: 'declare-attackers',
    eligibleIds: ['c-1', 'c-2'],
    assignments: {},
    ...overrides,
  };
}

describe('CombatFlow', () => {
  it('shows the declare-attackers step label and confirm calls onConfirm', () => {
    const onConfirm = vi.fn();
    render(
      <CombatFlow
        combat={makeCombat({ step: 'declare-attackers' })}
        onAssign={() => {}}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByTestId('combat-step-label').textContent).toBe('Declare attackers');

    fireEvent.click(screen.getByTestId('combat-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when the step is none', () => {
    const { container } = render(
      <CombatFlow
        combat={makeCombat({ step: 'none' })}
        onAssign={() => {}}
        onConfirm={() => {}}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('combat-flow')).toBeNull();
  });
});
