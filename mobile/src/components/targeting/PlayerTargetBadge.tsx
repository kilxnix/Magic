/**
 * PlayerTargetBadge
 *
 * Displays a targetable indicator on player life totals when they
 * are valid targets for "any target" spells.
 */

import React, { useEffect } from 'react';
import { StyleSheet, Pressable, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { COLORS } from '@/constants/colors';

interface PlayerTargetBadgeProps {
  playerId: string;
  playerName: string;
  isSelected: boolean;
  onPress: () => void;
}

export function PlayerTargetBadge({
  playerId,
  playerName,
  isSelected,
  onPress,
}: PlayerTargetBadgeProps) {
  const pulseOpacity = useSharedValue(0.6);

  useEffect(() => {
    if (!isSelected) {
      pulseOpacity.value = withRepeat(
        withTiming(1, {
          duration: 600,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true
      );
    } else {
      pulseOpacity.value = 1;
    }
  }, [isSelected, pulseOpacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  return (
    <Pressable onPress={onPress}>
      <Animated.View
        style={[
          styles.container,
          isSelected && styles.containerSelected,
          animatedStyle,
        ]}
      >
        <Text style={styles.icon}>🎯</Text>
        <Text style={styles.text}>
          {isSelected ? 'Selected' : 'Target'}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.success,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
    shadowColor: COLORS.success,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },
  containerSelected: {
    backgroundColor: COLORS.warning,
    shadowColor: COLORS.warning,
  },
  icon: {
    fontSize: 12,
  },
  text: {
    color: COLORS.background,
    fontSize: 12,
    fontWeight: '700',
  },
});
