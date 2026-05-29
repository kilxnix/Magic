/**
 * HandBadge
 *
 * Shows number of cards in hand. Tap or swipe up to view hand.
 */

import React from 'react';
import { Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface HandBadgeProps {
  cardCount: number;
  onPress: () => void;
}

export function HandBadge({ cardCount, onPress }: HandBadgeProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const showHint = width >= 390;

  return (
    <Pressable style={[styles.container, { bottom: insets.bottom + 8 }]} onPress={onPress}>
      <Text style={styles.label}>Hand</Text>
      <Text style={styles.count}>{cardCount}</Text>
      {showHint && <Text style={styles.hint}>Tap</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#27272a',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#3f3f46',
    gap: 8,
  },
  label: {
    color: '#a1a1aa',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  count: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  hint: {
    color: '#71717a',
    fontSize: 12,
  },
});
