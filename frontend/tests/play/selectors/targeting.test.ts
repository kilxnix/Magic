import { describe, expect, it } from 'vitest';
import { targeting } from '../../../src/play/selectors/targeting';

describe('targeting', () => {
  it('is inactive when there is no targeting prompt', () => {
    const ctx = targeting(null);
    expect(ctx.active).toBe(false);
    expect(ctx.legalTargetIds).toEqual([]);
    expect(ctx.selectedTargetIds).toEqual([]);
  });

  it('is inactive when the prompt is undefined', () => {
    expect(targeting(undefined).active).toBe(false);
  });

  it('activates with the prompt label and legal target ids', () => {
    const ctx = targeting({
      label: 'Choose a target for Lightning Bolt',
      sourceName: 'Lightning Bolt',
      choices: [
        { targetId: 't1', label: 'Bear', action: {} as never },
        { targetId: 't2', label: 'Elf', action: {} as never },
      ],
    });
    expect(ctx.active).toBe(true);
    expect(ctx.prompt).toBe('Choose a target for Lightning Bolt');
    expect(ctx.legalTargetIds).toEqual(['t1', 't2']);
    // Regression: the overlay must show human names, not raw instance ids.
    expect(ctx.legalTargets).toEqual([
      { id: 't1', name: 'Bear' },
      { id: 't2', name: 'Elf' },
    ]);
  });

  it('falls back to the target id as the name when a choice has no label', () => {
    const ctx = targeting({
      label: 'Pick',
      sourceName: 'X',
      choices: [{ targetId: 't9', label: '', action: {} as never }],
    });
    expect(ctx.legalTargets).toEqual([{ id: 't9', name: 't9' }]);
  });

  it('approximates min/max as 1 (single-tap-per-target flow) with no selection', () => {
    const ctx = targeting({
      label: 'Pick a target',
      sourceName: 'Doom Blade',
      choices: [{ targetId: 't1', label: 'Bear', action: {} as never }],
    });
    expect(ctx.minTargets).toBe(1);
    expect(ctx.maxTargets).toBe(1);
    expect(ctx.selectedTargetIds).toEqual([]);
  });

  it('falls back to the source name when no label is present', () => {
    const ctx = targeting({
      label: '',
      sourceName: 'Swords to Plowshares',
      choices: [{ targetId: 't1', label: 'Bear', action: {} as never }],
    });
    expect(ctx.prompt).toContain('Swords to Plowshares');
  });
});
