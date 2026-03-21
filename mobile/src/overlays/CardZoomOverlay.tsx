/**
 * CardZoomOverlay
 *
 * Full-screen card detail view. Shown on long-press.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useGame } from '@/contexts/GameContext';
import { CardImage } from '@/components/cards/CardImage';

interface CardZoomOverlayProps {
  cardInstanceId: string | null;
  onDismiss: () => void;
}

export function CardZoomOverlay({ cardInstanceId, onDismiss }: CardZoomOverlayProps) {
  const { gameState, getDefinition } = useGame();

  if (!cardInstanceId || !gameState) return null;

  const card = gameState.cards.get(cardInstanceId);
  if (!card) return null;

  const def = getDefinition(card);
  if (!def) return null;

  return (
    <Pressable style={styles.container} onPress={onDismiss}>
      <Pressable style={styles.content} onPress={e => e.stopPropagation()}>
        {/* Card image */}
        <CardImage name={def.name} size="large" />

        {/* Card details */}
        <View style={styles.details}>
          <Text style={styles.name}>{def.name}</Text>
          <Text style={styles.typeLine}>{def.type_line}</Text>

          {def.mana_cost && (
            <Text style={styles.manaCost}>{def.mana_cost}</Text>
          )}

          {def.oracle_text && (
            <ScrollView style={styles.textScroll}>
              <Text style={styles.oracleText}>{def.oracle_text}</Text>
            </ScrollView>
          )}

          {def.power !== undefined && def.toughness !== undefined && (
            <Text style={styles.pt}>
              {def.power}/{def.toughness}
            </Text>
          )}

          {/* Card state info */}
          <View style={styles.stateInfo}>
            <Text style={styles.stateText}>Zone: {card.zone}</Text>
            {card.tapped && <Text style={styles.stateText}>Tapped</Text>}
            {card.summoningSick && <Text style={styles.stateText}>Summoning sick</Text>}
            {Object.entries(card.counters).map(([type, count]) => (
              <Text key={type} style={styles.stateText}>
                {type}: {count}
              </Text>
            ))}
          </View>
        </View>

        <Pressable style={styles.closeButton} onPress={onDismiss}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 200,
  },
  content: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    maxWidth: '90%',
    maxHeight: '90%',
  },
  details: {
    marginTop: 16,
    alignItems: 'center',
    gap: 8,
    maxWidth: 280,
  },
  name: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  typeLine: {
    color: '#a1a1aa',
    fontSize: 14,
    textAlign: 'center',
  },
  manaCost: {
    color: '#e4e4e7',
    fontSize: 16,
    fontWeight: '500',
  },
  textScroll: {
    maxHeight: 100,
  },
  oracleText: {
    color: '#e4e4e7',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  pt: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  stateInfo: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginTop: 8,
  },
  stateText: {
    color: '#71717a',
    fontSize: 12,
    backgroundColor: '#27272a',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  closeButton: {
    marginTop: 16,
    backgroundColor: '#7c3aed',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
  },
  closeText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
