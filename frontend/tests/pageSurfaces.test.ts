import { describe, expect, it } from 'vitest';
import { isInteractiveGamePath } from '../src/lib/pageSurfaces';

describe('isInteractiveGamePath', () => {
  it('keeps global bottom overlays out of live play surfaces', () => {
    expect(isInteractiveGamePath('/play')).toBe(true);
    expect(isInteractiveGamePath('/multiplayer/abc123')).toBe(true);
    expect(isInteractiveGamePath('/shelector')).toBe(true);
    expect(isInteractiveGamePath('/rooms/test')).toBe(true);
  });

  it('allows launch and legal pages to show global notices', () => {
    expect(isInteractiveGamePath('/')).toBe(false);
    expect(isInteractiveGamePath('/privacy')).toBe(false);
    expect(isInteractiveGamePath('/how-training-works')).toBe(false);
  });
});
