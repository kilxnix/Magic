import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BrassButton, ModalShell, ZoneCounter, Panel, Pip, Badge } from './index';

describe('v2 primitives', () => {
  it('BrassButton fires onClick and respects disabled', () => {
    const onClick = vi.fn();
    const { rerender } = render(<BrassButton onClick={onClick}>Pass</BrassButton>);
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<BrassButton onClick={onClick} disabled>Pass</BrassButton>);
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('ZoneCounter shows label + count and is clickable', () => {
    const onClick = vi.fn();
    render(<ZoneCounter icon="grave" label="Graveyard" count={7} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /graveyard 7/i }));
    expect(onClick).toHaveBeenCalled();
  });

  it('ModalShell closes on backdrop click and is not position:fixed', () => {
    const onClose = vi.fn();
    const { container } = render(<ModalShell title="Graveyard" onClose={onClose}>body</ModalShell>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('absolute');
    expect(root.className).not.toContain('fixed');
    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('Panel renders children', () => {
    render(<Panel>hello</Panel>);
    expect(screen.getByText('hello')).toBeTruthy();
  });
  it('Badge renders its label', () => {
    render(<Badge tone="pt">5/5</Badge>);
    expect(screen.getByText('5/5')).toBeTruthy();
  });
  it('Pip renders a sized dot', () => {
    const { container } = render(<Pip color="G" />);
    const dot = container.querySelector('span') as HTMLElement;
    expect(dot.style.width).toBe('14px');
  });
  // CardFace is exercised by PermanentTileV2 (Task 6), which renders one.
});
