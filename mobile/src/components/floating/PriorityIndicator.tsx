/**
 * PriorityIndicator
 *
 * Shows when you have priority and provides a pass button.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface PriorityIndicatorProps {
  hasYourPriority: boolean;
  priorityPlayerName: string;
  onPassPress: () => void;
}

export function PriorityIndicator({
  hasYourPriority,
  onPassPress,
}: PriorityIndicatorProps) {
  const insets = useSafeAreaInsets();

  if (!hasYourPriority) return null;

  return (
    <View style={[styles.container, { bottom: insets.bottom + 96 }]}>
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
    right: 10,
    alignItems: 'flex-end',
    gap: 6,
  },
  label: {
    color: '#7c3aed',
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: '#1e1b4b',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
  },
  passButton: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 22,
  },
  passText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
