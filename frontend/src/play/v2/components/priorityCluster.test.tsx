import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PriorityControlsV2 } from './PriorityControlsV2';
import { StackViewV2 } from './StackViewV2';
import type { PriorityContext, StackItemView } from '../../gameView.types';

const priority: PriorityContext = {
  hasPriority: true, isYourTurn: true, phaseLabel: 'Combat',
  hasMeaningfulResponse: true, canPass: true, canHold: true,
};

describe('priority cluster', () => {
  it('Pass fires onPass', () => {
    const onPass = vi.fn();
    render(<PriorityControlsV2 priority={priority} alwaysStop={false} onPass={onPass} onHold={() => {}} onToggleAlwaysStop={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    expect(onPass).toHaveBeenCalled();
  });
  it('stack item opens the viewer', () => {
    const onView = vi.fn();
    const stack: StackItemView[] = [{ id: 's1', controllerName: 'You', title: 'Cultivate', description: 'Search for two basics', resolvesNext: true }];
    render(<StackViewV2 stack={stack} onView={onView} />);
    fireEvent.click(screen.getByRole('button', { name: /cultivate/i }));
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', zone: 'stack' }));
  });
});
