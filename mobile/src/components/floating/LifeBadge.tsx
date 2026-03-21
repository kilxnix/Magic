/**
 * LifeBadge
 *
 * Displays a player's life total. Tap to expand for commander damage details.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';

interface LifeBadgeProps {
  playerId: string;
  name: string;
  life: number;
  isYou: boolean;
  isActive: boolean;
  onPress: () => void;
}

export function LifeBadge({
  name,
  life,
  isYou,
  isActive,
  onPress,
}: LifeBadgeProps) {
  const lifeColor = life > 20 ? '#22c55e' : life > 10 ? '#eab308' : '#ef4444';

  return (
    <Pressable
      style={[
        styles.container,
        isYou && styles.containerYou,
        isActive && styles.containerActive,
      ]}
      onPress={onPress}
    >
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      <Text style={[styles.life, { color: lifeColor }]}>
        {life}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#27272a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  containerYou: {
    backgroundColor: '#1e1b4b',
    borderColor: '#4c1d95',
  },
  containerActive: {
    borderColor: '#7c3aed',
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },
  name: {
    color: '#e4e4e7',
    fontSize: 14,
    fontWeight: '500',
    maxWidth: 80,
  },
  life: {
    fontSize: 20,
    fontWeight: '700',
  },
});
