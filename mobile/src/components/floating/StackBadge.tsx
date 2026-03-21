/**
 * StackBadge
 *
 * Shows number of items on the stack. Tap to view stack.
 */

import React from 'react';
import { Text, StyleSheet, Pressable } from 'react-native';

interface StackBadgeProps {
  itemCount: number;
  onPress: () => void;
}

export function StackBadge({ itemCount, onPress }: StackBadgeProps) {
  return (
    <Pressable style={styles.container} onPress={onPress}>
      <Text style={styles.icon}>📚</Text>
      <Text style={styles.count}>{itemCount}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  icon: {
    fontSize: 16,
  },
  count: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
