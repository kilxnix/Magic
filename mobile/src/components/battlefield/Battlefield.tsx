/**
 * Battlefield
 *
 * Displays your permanents organized by type (lands, creatures, other).
 */

import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import type { CardInstance, CardDefinition } from '@/types';
import { PermanentRow } from './PermanentRow';

interface BattlefieldProps {
  lands: CardInstance[];
  creatures: CardInstance[];
  otherPermanents: CardInstance[];
  getDefinition: (card: CardInstance) => CardDefinition | undefined;
}

export function Battlefield({
  lands,
  creatures,
  otherPermanents,
  getDefinition,
}: BattlefieldProps) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Other permanents (artifacts, enchantments, planeswalkers) */}
      {otherPermanents.length > 0 && (
        <PermanentRow
          cards={otherPermanents}
          getDefinition={getDefinition}
          rowType="other"
        />
      )}

      {/* Creatures */}
      {creatures.length > 0 && (
        <PermanentRow
          cards={creatures}
          getDefinition={getDefinition}
          rowType="creatures"
        />
      )}

      {/* Lands at the bottom */}
      {lands.length > 0 && (
        <PermanentRow
          cards={lands}
          getDefinition={getDefinition}
          rowType="lands"
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    gap: 8,
  },
});
