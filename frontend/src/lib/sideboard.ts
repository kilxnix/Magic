const BASIC_LANDS = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes']);

export const CONSTRUCTED_MIN_MAIN_DECK_SIZE = 60;
export const CONSTRUCTED_MAX_SIDEBOARD_SIZE = 15;
export const CONSTRUCTED_MAX_NON_BASIC_COPIES = 4;

export interface SideboardValidation {
  valid: boolean;
  errors: string[];
  mainCount: number;
  sideboardCount: number;
}

export interface SideboardMoveResult {
  mainDeck: string[];
  sideboard: string[];
}

export function countCardsByName(cards: string[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const card of cards) {
    counts.set(card, (counts.get(card) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function validateConstructedSideboardConfiguration(
  mainDeck: string[],
  sideboard: string[],
): SideboardValidation {
  const errors: string[] = [];

  if (mainDeck.length < CONSTRUCTED_MIN_MAIN_DECK_SIZE) {
    errors.push(`Main deck has ${mainDeck.length} cards (minimum is ${CONSTRUCTED_MIN_MAIN_DECK_SIZE})`);
  }

  if (sideboard.length > CONSTRUCTED_MAX_SIDEBOARD_SIZE) {
    errors.push(`Sideboard has ${sideboard.length} cards (maximum is ${CONSTRUCTED_MAX_SIDEBOARD_SIZE})`);
  }

  const combinedCounts = new Map<string, number>();
  for (const card of [...mainDeck, ...sideboard]) {
    if (BASIC_LANDS.has(card)) continue;
    combinedCounts.set(card, (combinedCounts.get(card) || 0) + 1);
  }

  for (const [name, count] of combinedCounts.entries()) {
    if (count > CONSTRUCTED_MAX_NON_BASIC_COPIES) {
      errors.push(`${name} has ${count} copies across main deck and sideboard (maximum is ${CONSTRUCTED_MAX_NON_BASIC_COPIES})`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    mainCount: mainDeck.length,
    sideboardCount: sideboard.length,
  };
}

export function moveCardBetweenDeckAndSideboard(
  mainDeck: string[],
  sideboard: string[],
  cardName: string,
  direction: 'to-sideboard' | 'to-main',
): SideboardMoveResult {
  const source = direction === 'to-sideboard' ? mainDeck : sideboard;
  const target = direction === 'to-sideboard' ? sideboard : mainDeck;
  const sourceIndex = source.findIndex(card => card === cardName);

  if (sourceIndex < 0) {
    return { mainDeck, sideboard };
  }

  const nextSource = [...source];
  const [movedCard] = nextSource.splice(sourceIndex, 1);
  const nextTarget = [...target, movedCard];

  return direction === 'to-sideboard'
    ? { mainDeck: nextSource, sideboard: nextTarget }
    : { mainDeck: nextTarget, sideboard: nextSource };
}

export function oracleTextCanAccessSideboard(oracleText: string): boolean {
  return /\boutside the game\b/i.test(oracleText);
}
