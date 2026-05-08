import { describe, expect, it } from 'vitest';
import { CARD_TILE_LAYOUT, FLOATING_TABLE_LAYOUT } from '../src/lib/gameBoardLayout';

describe('FLOATING_TABLE_LAYOUT', () => {
  it('keeps permanent game chrome floating instead of reserving side rails', () => {
    expect(FLOATING_TABLE_LAYOUT.shell).toContain('overflow-hidden');
    expect(FLOATING_TABLE_LAYOUT.reviewButton).toContain('fixed');
    expect(FLOATING_TABLE_LAYOUT.reviewRail).toContain('hidden');
    expect(FLOATING_TABLE_LAYOUT.board).toContain('flex-1');
    expect(FLOATING_TABLE_LAYOUT.table).toContain('pb-32');
    expect(FLOATING_TABLE_LAYOUT.opponentStrip).toContain('shrink-0');
    expect(FLOATING_TABLE_LAYOUT.actionsDock).toContain('bottom-[7.75rem]');
    expect(FLOATING_TABLE_LAYOUT.handDock).toContain('bottom-3');
  });
});

describe('CARD_TILE_LAYOUT', () => {
  it('lets compact card names wrap instead of truncating immediately', () => {
    expect(CARD_TILE_LAYOUT.compactSize).toContain('md:w-[5.4rem]');
    expect(CARD_TILE_LAYOUT.compactTitle).toContain('line-clamp-2');
    expect(CARD_TILE_LAYOUT.compactTitle).toContain('break-words');
    expect(CARD_TILE_LAYOUT.compactTitle).not.toContain('truncate');
  });
});
