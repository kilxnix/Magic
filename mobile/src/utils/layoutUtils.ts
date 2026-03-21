/**
 * Layout utility functions
 */

import { Dimensions } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * Calculate card size based on available width and count.
 */
export function calculateCardSize(
  containerWidth: number,
  cardCount: number,
  gap: number = 6,
  maxCardWidth: number = 80
): { width: number; height: number } {
  const availableWidth = containerWidth - (gap * (cardCount - 1));
  const calculatedWidth = Math.min(availableWidth / cardCount, maxCardWidth);
  const width = Math.max(calculatedWidth, 40); // Minimum card width

  // Standard MTG card ratio is 63mm x 88mm ≈ 1:1.4
  const height = width * 1.4;

  return { width, height };
}

/**
 * Calculate grid layout for a zone browser.
 */
export function calculateGridLayout(
  containerWidth: number,
  containerHeight: number,
  itemCount: number,
  aspectRatio: number = 1.4
): { columns: number; itemWidth: number; itemHeight: number } {
  // Try different column counts and pick the one that uses space best
  let bestColumns = 1;
  let bestItemWidth = 0;

  for (let cols = 1; cols <= Math.min(itemCount, 6); cols++) {
    const rows = Math.ceil(itemCount / cols);
    const itemWidth = (containerWidth - (cols - 1) * 8) / cols;
    const itemHeight = itemWidth * aspectRatio;
    const totalHeight = rows * itemHeight + (rows - 1) * 8;

    if (totalHeight <= containerHeight && itemWidth > bestItemWidth) {
      bestColumns = cols;
      bestItemWidth = itemWidth;
    }
  }

  return {
    columns: bestColumns,
    itemWidth: bestItemWidth,
    itemHeight: bestItemWidth * aspectRatio,
  };
}

/**
 * Get safe area dimensions.
 */
export function getScreenDimensions(): {
  width: number;
  height: number;
  isSmallScreen: boolean;
} {
  return {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    isSmallScreen: SCREEN_HEIGHT < 700,
  };
}

/**
 * Calculate positions for floating badges.
 */
export function getBadgePositions(screenWidth: number, screenHeight: number) {
  return {
    phaseIndicator: { top: 60, left: 12 },
    stackBadge: { top: 60, right: 12 },
    yourLife: { bottom: 100, left: 12 },
    handBadge: { bottom: 20, left: (screenWidth - 120) / 2 },
    priorityIndicator: { bottom: 100, right: 12 },
  };
}
