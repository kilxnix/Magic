// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { DecisionModal } from '../../../src/play/components/DecisionModal';

afterEach(cleanup);

describe('DecisionModal', () => {
  it('renders title/body/labels and routes confirm + decline', () => {
    const onConfirm = vi.fn();
    const onDecline = vi.fn();
    render(
      <DecisionModal
        title="Optional trigger"
        body={<span>Soul Warden — etb. Use this triggered ability?</span>}
        confirmLabel="Use"
        declineLabel="Decline"
        onConfirm={onConfirm}
        onDecline={onDecline}
      />,
    );

    expect(screen.getByTestId('decision-modal').textContent).toContain('Soul Warden');

    fireEvent.click(screen.getByTestId('decision-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('decision-decline'));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('disables confirm when confirmDisabled (e.g. tax/ward you cannot pay)', () => {
    const onConfirm = vi.fn();
    render(
      <DecisionModal
        title="Tax — Rhystic Study"
        body={<span>You may pay {'{1}'}.</span>}
        confirmLabel="Pay {1}"
        declineLabel="Decline"
        confirmDisabled
        accent="sky"
        onConfirm={onConfirm}
        onDecline={vi.fn()}
      />,
    );

    const confirm = screen.getByTestId('decision-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
