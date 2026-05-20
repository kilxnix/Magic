/**
 * StackBadge
 *
 * Shows number of items on the stack. Tap to view stack.
 */

import React from 'react';
import { Text, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface StackBadgeProps {
  itemCount: number;
  onPress: () => void;
}

export function StackBadge({ itemCount, onPress }: StackBadgeProps) {
  const insets = useSafeAreaInsets();

  return (
    <Pressable style={[styles.container, { top: insets.top + 48 }]} onPress={onPress}>
      <Text style={styles.icon}>📚</Text>
      <Text style={styles.count}>{itemCount}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 18,
    gap: 6,
  },
  icon: {
    fontSize: 14,
  },
  count: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
