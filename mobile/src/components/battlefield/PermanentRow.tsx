/**
 * PermanentRow
 *
 * A horizontal row of permanents. Scrolls if needed.
 */

import React from 'react';
import { View, ScrollView, StyleSheet, Text } from 'react-native';
import type { CardInstance, CardDefinition } from '@/types';
import { Permanent } from './Permanent';

interface PermanentRowProps {
  cards: CardInstance[];
  getDefinition: (card: CardInstance) => CardDefinition | undefined;
  rowType: 'lands' | 'creatures' | 'other';
}

const ROW_LABELS = {
  lands: 'Lands',
  creatures: 'Creatures',
  other: 'Other',
};

export function PermanentRow({ cards, getDefinition, rowType }: PermanentRowProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        {ROW_LABELS[rowType]} ({cards.length})
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {cards.map(card => {
          const def = getDefinition(card);
          if (!def) return null;

          return (
            <Permanent
              key={card.instanceId}
              card={card}
              definition={def}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  label: {
    fontSize: 11,
    color: '#71717a',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingLeft: 4,
  },
  scrollContent: {
    gap: 6,
    paddingRight: 12,
  },
});
