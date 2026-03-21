/**
 * TargetHighlight
 *
 * Adds a glow effect around valid or selected targets.
 */

import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

interface TargetHighlightProps {
  type: 'valid' | 'selected' | 'invalid';
  children: React.ReactNode;
}

const COLORS = {
  valid: '#22c55e',
  selected: '#fbbf24',
  invalid: '#ef4444',
};

export function TargetHighlight({ type, children }: TargetHighlightProps) {
  const glowOpacity = useSharedValue(type === 'selected' ? 1 : 0.4);

  useEffect(() => {
    if (type === 'valid') {
      glowOpacity.value = withRepeat(
        withTiming(0.9, {
          duration: 500,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true
      );
    } else if (type === 'selected') {
      glowOpacity.value = 1;
    } else {
      glowOpacity.value = 0.4;
    }
  }, [type, glowOpacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    shadowColor: COLORS[type],
    shadowOpacity: glowOpacity.value,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  }));

  return (
    <Animated.View style={[styles.container, animatedStyle]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
  },
});
