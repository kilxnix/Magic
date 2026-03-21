/**
 * HandBadge
 *
 * Shows number of cards in hand. Tap or swipe up to view hand.
 */

import React from 'react';
import { Text, StyleSheet, Pressable } from 'react-native';

interface HandBadgeProps {
  cardCount: number;
  onPress: () => void;
}

export function HandBadge({ cardCount, onPress }: HandBadgeProps) {
  return (
    <Pressable style={styles.container} onPress={onPress}>
      <Text style={styles.icon}>🃏</Text>
      <Text style={styles.count}>{cardCount}</Text>
      <Text style={styles.hint}>Tap to view</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 20,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#27272a',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#3f3f46',
    gap: 8,
  },
  icon: {
    fontSize: 18,
  },
  count: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  hint: {
    color: '#71717a',
    fontSize: 12,
    marginLeft: 4,
  },
});
