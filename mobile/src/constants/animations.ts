/**
 * Animation constants
 */

export const ANIMATION = {
  // Durations (ms)
  DURATION_FAST: 150,
  DURATION_NORMAL: 250,
  DURATION_SLOW: 400,

  // Spring configs for Reanimated
  SPRING_SNAPPY: {
    damping: 20,
    stiffness: 200,
  },
  SPRING_BOUNCY: {
    damping: 15,
    stiffness: 150,
  },
  SPRING_GENTLE: {
    damping: 25,
    stiffness: 100,
  },

  // Card movement
  CARD_MOVE_DURATION: 300,
  TAP_DURATION: 200,

  // Overlays
  OVERLAY_SLIDE_DURATION: 250,

  // Effects
  GLOW_PULSE_DURATION: 1000,

  // AI delay
  AI_DECISION_DELAY: 500,
};
