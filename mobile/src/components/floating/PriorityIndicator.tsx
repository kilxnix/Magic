/**
 * PriorityIndicator
 *
 * Shows when you have priority and provides a pass button.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';

interface PriorityIndicatorProps {
  hasYourPriority: boolean;
  priorityPlayerName: string;
  onPassPress: () => void;
}

export function PriorityIndicator({
  hasYourPriority,
  onPassPress,
}: PriorityIndicatorProps) {
  if (!hasYourPriority) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Your Priority</Text>
      <Pressable style={styles.passButton} onPress={onPassPress}>
        <Text style={styles.passText}>Pass</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 100,
    right: 12,
    alignItems: 'flex-end',
    gap: 8,
  },
  label: {
    color: '#7c3aed',
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: '#1e1b4b',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  passButton: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  passText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
