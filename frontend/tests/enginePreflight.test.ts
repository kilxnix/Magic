import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ENGINE_UNSUPPORTED_CARD_REASONS,
  findUnsupportedEngineCards,
  formatUnsupportedEngineCards,
} from '../src/lib/enginePreflight';

const MANIFEST_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../mtg_data/card_support.json',
);

describe('engine preflight', () => {
  it('reports hard unsupported cards with deck labels and reasons', () => {
    const unsupported = findUnsupportedEngineCards([
      {
        label: 'Your deck',
        commander: 'Talrand, Sky Summoner',
        cards: ['1x Chaos Orb (2ED)', 'Island'],
      },
      {
        label: 'Shelector AI 1',
        cards: ['Shahrazad'],
      },
    ]);

    expect(unsupported).toEqual([
      {
        deckLabel: 'Your deck',
        name: 'Chaos Orb',
        reason: 'Manual dexterity / subgame not automated',
      },
      {
        deckLabel: 'Shelector AI 1',
        name: 'Shahrazad',
        reason: 'Manual dexterity / subgame not automated',
      },
    ]);
    expect(formatUnsupportedEngineCards(unsupported)).toContain('Engine preflight failed');
  });

  // Drift guard: the client's narrow hard-block list must stay a subset of the
  // backend manifest's known-manual set, with matching reason wording, so the
  // client gate and the /api/card-support endpoints never disagree.
  it('stays consistent with the backend card-support manifest', () => {
    if (!existsSync(MANIFEST_PATH)) {
      throw new Error(
        `card_support.json not found at ${MANIFEST_PATH}. Build it with ` +
          '`node engine/scripts/build-support-manifest.cjs` before running this test.',
      );
    }
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as Record<
      string,
      { playable?: boolean; supported?: boolean; knownManual?: string | null }
    >;
    for (const [name, reason] of Object.entries(ENGINE_UNSUPPORTED_CARD_REASONS)) {
      const entry = manifest[name];
      expect(entry, `${name} should exist in card_support.json`).toBeTruthy();
      // Every client-blocked card must be not-playable and flagged known-manual
      // by the server (i.e. a subset of the manifest's known-manual set).
      expect(entry.playable, `${name} should be playable:false in the manifest`).toBe(false);
      expect(entry.knownManual, `${name} should have a knownManual reason`).toBeTruthy();
      // ...and the client must use the server's exact wording.
      expect(reason, `${name} reason should match the manifest`).toBe(entry.knownManual);
    }
  });

  it('deduplicates repeated unsupported card names per deck', () => {
    const unsupported = findUnsupportedEngineCards([
      {
        label: 'Your deck',
        cards: ['Chaos Orb', '1x Chaos Orb (2ED) 233 *F* *CMDR*', 'Falling Star'],
      },
    ]);

    expect(unsupported.map(card => card.name)).toEqual(['Chaos Orb', 'Falling Star']);
  });
});
