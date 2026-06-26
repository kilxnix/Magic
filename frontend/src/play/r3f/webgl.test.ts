import { describe, expect, it } from 'vitest';
import { supportsWebGL } from './webgl';

function fakeDoc(ctx: unknown): Document {
  return {
    createElement: () => ({ getContext: () => ctx }),
  } as unknown as Document;
}

describe('supportsWebGL', () => {
  it('is true when a webgl context is returned', () => {
    expect(supportsWebGL(fakeDoc({}))).toBe(true);
  });
  it('is false when no context is available', () => {
    expect(supportsWebGL(fakeDoc(null))).toBe(false);
  });
  it('is false when createElement throws', () => {
    const doc = { createElement: () => { throw new Error('no'); } } as unknown as Document;
    expect(supportsWebGL(doc)).toBe(false);
  });
});
