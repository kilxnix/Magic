// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { GameOverOverlay } from '../../../src/play/components/GameOverOverlay';

afterEach(cleanup);

describe('GameOverOverlay', () => {
  it('renders nothing while the game is in progress (no winner)', () => {
    render(
      <GameOverOverlay winnerName={null} youWon={false} onReview={vi.fn()} onPlayAgain={vi.fn()} />,
    );
    expect(screen.queryByTestId('play-game-over')).toBeNull();
  });

  it('shows Victory for the human winner and routes Play again', () => {
    const onPlayAgain = vi.fn();
    render(
      <GameOverOverlay
        winnerName="You"
        youWon
        onReview={vi.fn()}
        onPlayAgain={onPlayAgain}
      />,
    );
    expect(screen.getByTestId('play-game-over').textContent).toContain('Victory');
    fireEvent.click(screen.getByTestId('game-over-play-again'));
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
  });

  it('shows Defeat naming the winner and routes Review game', () => {
    const onReview = vi.fn();
    render(
      <GameOverOverlay
        winnerName="Ferrafor, Young Yew"
        youWon={false}
        onReview={onReview}
        onPlayAgain={vi.fn()}
      />,
    );
    const overlay = screen.getByTestId('play-game-over');
    expect(overlay.textContent).toContain('Defeat');
    expect(overlay.textContent).toContain('Ferrafor, Young Yew');
    fireEvent.click(screen.getByTestId('game-over-review'));
    expect(onReview).toHaveBeenCalledTimes(1);
  });
});
