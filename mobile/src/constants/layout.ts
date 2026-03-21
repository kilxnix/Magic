/**
 * Layout constants
 */

import { Dimensions } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export const LAYOUT = {
  SCREEN_WIDTH,
  SCREEN_HEIGHT,

  // Card sizes
  CARD_SMALL: { width: 60, height: 84 },
  CARD_MEDIUM: { width: 120, height: 168 },
  CARD_LARGE: { width: 240, height: 336 },

  // Battlefield
  OPPONENT_AREA_HEIGHT: 0.35,
  BATTLEFIELD_AREA_HEIGHT: 0.65,

  // Spacing
  PADDING_SM: 8,
  PADDING_MD: 12,
  PADDING_LG: 16,
  PADDING_XL: 24,

  // Border radius
  RADIUS_SM: 4,
  RADIUS_MD: 8,
  RADIUS_LG: 12,
  RADIUS_XL: 20,

  // Badge sizes
  BADGE_SIZE: 40,
  BADGE_RADIUS: 20,
};
