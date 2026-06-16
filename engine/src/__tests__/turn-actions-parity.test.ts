/**
 * Turn-action parity test.
 *
 * Guards that the canonical `advanceStepWithTurnActions` (the single source of
 * step-advance + turn-based-action logic shared by the 1v1 single-player path
 * and the 1v1v1v1 room path) stays correct AND equivalent to the loop logic the
 * single-player hook uses. If the two ever drift again (as they did when the
 * room path silently lacked the draw step / state-based actions), this fails.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { initGameFromDecks, GameInitConfig, resetInstanceCounter } from '../game-init';
import type { GeneratedDeck, ScryfallCard } from '../cards/deck-loader';
import { createCardLookup } from '../cards/deck-loader';
import { getCardsInZone } from '../game-state';
import { advanceStep, performUntapStep } from '../turn-manager';
import { drawCards } from '../actions';
import { checkStateBasedActions } from '../state-based';
import { advanceStepWithTurnActions } from '../turn-actions';
import type { GameState } from '../types';

function forest(id: string, name: string): ScryfallCard {
  return { id, name, type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [] };
}
function commander(id: string, name: string): ScryfallCard {
  return { id, name, type_line: 'Legendary Creature — Treefolk', oracle_text: '', mana_cost: '{4}{G}{G}', cmc: 6, colors: ['G'], color_identity: ['G'], keywords: [], power: '4', toughness: '4' };
}
function forestDeck(commanderName: string, prefix: string): GeneratedDeck {
  const list: string[] = [];
  for (let i = 0; i < 99; i++) list.push(`${prefix} Forest ${i}`);
  return { id: `deck-${prefix}`, commander: commanderName, list, colors: ['G'], bracket: 1, theme: 'Forests' };
}
function cardDb(prefixes: string[], commanders: [string, string][]): ScryfallCard[] {
  const cards: ScryfallCard[] = [];
  for (const [id, name] of commanders) cards.push(commander(id, name));
  for (const p of prefixes) for (let i = 0; i < 99; i++) cards.push(forest(`${p}-forest-${i}`, `${p} Forest ${i}`));
  return cards;
}

function makeGame(playerCount: number): GameState {
  resetInstanceCounter();
  const prefixes = Array.from({ length: playerCount }, (_, i) => `P${i + 1}`);
  const cmds: [string, string][] = prefixes.map((p, i) => [`cmd-${p}`, `Commander ${i + 1}`]);
  const lookup = createCardLookup(cardDb(prefixes, cmds));
  const config: GameInitConfig = {
    humanDeck: forestDeck(cmds[0][1], 'P1'),
    aiDecks: prefixes.slice(1).map((p, i) => forestDeck(cmds[i + 1][1], p)),
    aiDifficulty: 1,
    cardLookup: lookup,
    humanGoesFirst: true,
    startingLife: 40,
    startingHandSize: 7,
  };
  return initGameFromDecks(config) as unknown as GameState;
}

/** Replicates the single-player hook's beginning-phase loop (useShelectorGame
 *  advanceToPrecombatMain) using the RAW engine primitives. */
function singlePlayerAdvanceToMain(state: GameState, skipDraw = false): GameState {
  let cur = state;
  let safety = 20;
  while (cur.phase === 'beginning' && safety-- > 0) {
    if (cur.step === 'untap') cur = performUntapStep(cur);
    if (cur.step === 'draw' && !skipDraw) {
      cur = drawCards(cur, cur.players[cur.activePlayerIndex].id, 1);
    }
    cur = advanceStep(cur);
  }
  return checkStateBasedActions(cur);
}

/** Drives the canonical function until the beginning phase is left. */
function canonicalAdvanceToMain(state: GameState): GameState {
  let cur = state;
  let safety = 20;
  while (cur.phase === 'beginning' && safety-- > 0) cur = advanceStepWithTurnActions(cur);
  return cur;
}

describe('turn-action parity (1v1 vs 1v1v1v1 share one engine)', () => {
  it('4-player turn 1: the starting player DRAWS (CR 103.8a only skips in 2-player)', () => {
    const game = makeGame(4); // starts at turn 1, beginning/upkeep
    const handBefore = getCardsInZone(game, game.players[game.activePlayerIndex].id, 'hand').length;
    const after = canonicalAdvanceToMain(game);
    const handAfter = getCardsInZone(after, after.players[0].id, 'hand').length;
    expect(handAfter).toBe(handBefore + 1);
  });

  it('2-player turn 1: the starting player SKIPS the first draw', () => {
    const game = makeGame(2);
    const handBefore = getCardsInZone(game, game.players[game.activePlayerIndex].id, 'hand').length;
    // canonical handles the 2-player turn-1 skip internally via player count.
    const after = canonicalAdvanceToMain(game);
    const handAfter = getCardsInZone(after, after.players[0].id, 'hand').length;
    expect(handAfter).toBe(handBefore);
  });

  it('canonical advance == single-player loop (4-player, full beginning phase)', () => {
    const a = canonicalAdvanceToMain(makeGame(4));
    const b = singlePlayerAdvanceToMain(makeGame(4), /* skipDraw */ false);
    expect(a.phase).toBe(b.phase);
    expect(a.step).toBe(b.step);
    expect(a.turnNumber).toBe(b.turnNumber);
    for (let i = 0; i < a.players.length; i++) {
      expect(getCardsInZone(a, a.players[i].id, 'hand').length)
        .toBe(getCardsInZone(b, b.players[i].id, 'hand').length);
      expect(getCardsInZone(a, a.players[i].id, 'library').length)
        .toBe(getCardsInZone(b, b.players[i].id, 'library').length);
    }
  });

  it('canonical advance == single-player loop (2-player, turn-1 skip)', () => {
    const a = canonicalAdvanceToMain(makeGame(2));
    const b = singlePlayerAdvanceToMain(makeGame(2), /* skipDraw */ true);
    expect(a.step).toBe(b.step);
    expect(getCardsInZone(a, a.players[0].id, 'hand').length)
      .toBe(getCardsInZone(b, b.players[0].id, 'hand').length);
  });
});
