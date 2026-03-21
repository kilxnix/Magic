/**
 * CounterBadge
 *
 * Displays a counter on a permanent (+1/+1, loyalty, etc.)
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface CounterBadgeProps {
  type: string;
  count: number;
}

const COUNTER_COLORS: Record<string, string> = {
  '+1/+1': '#22c55e',
  '-1/-1': '#ef4444',
  'loyalty': '#3b82f6',
  'charge': '#eab308',
};

export function CounterBadge({ type, count }: CounterBadgeProps) {
  if (count <= 0) return null;

  const backgroundColor = COUNTER_COLORS[type] || '#71717a';

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <Text style={styles.count}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  count: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
});
