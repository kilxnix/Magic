/**
 * ZoneBrowserOverlay
 *
 * Browse cards in a specific zone (graveyard, exile, library top N).
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useGame } from '@/contexts/GameContext';
import { CardImage } from '@/components/cards/CardImage';
import type { Zone } from '@/types';

interface ZoneBrowserOverlayProps {
  visible: boolean;
  zone: Zone;
  playerId: string;
  onDismiss: () => void;
}

const ZONE_TITLES: Record<Zone, string> = {
  library: 'Library',
  hand: 'Hand',
  battlefield: 'Battlefield',
  graveyard: 'Graveyard',
  exile: 'Exile',
  stack: 'Stack',
  command: 'Command Zone',
};

export function ZoneBrowserOverlay({
  visible,
  zone,
  playerId,
  onDismiss,
}: ZoneBrowserOverlayProps) {
  const { gameState, getCardsInZone, getDefinition, setOverlay } = useGame();

  if (!visible || !gameState) return null;

  const cards = getCardsInZone(playerId, zone);
  const player = gameState.players.find(p => p.id === playerId);

  const handleCardPress = (cardInstanceId: string) => {
    setOverlay('cardZoom', cardInstanceId);
  };

  return (
    <Pressable style={styles.backdrop} onPress={onDismiss}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{ZONE_TITLES[zone]}</Text>
          <Text style={styles.subtitle}>
            {player?.name} - {cards.length} cards
          </Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cardsContainer}
        >
          {cards.length === 0 ? (
            <Text style={styles.emptyText}>No cards in this zone</Text>
          ) : (
            cards.map(card => {
              const def = getDefinition(card);
              if (!def) return null;

              return (
                <Pressable
                  key={card.instanceId}
                  style={styles.cardWrapper}
                  onPress={() => handleCardPress(card.instanceId)}
                >
                  <CardImage name={def.name} size="medium" />
                </Pressable>
              );
            })
          )}
        </ScrollView>

        <Pressable style={styles.closeButton} onPress={onDismiss}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 150,
  },
  container: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 16,
    width: '90%',
    maxHeight: '60%',
  },
  header: {
    marginBottom: 16,
  },
  title: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    color: '#71717a',
    fontSize: 12,
    marginTop: 4,
  },
  cardsContainer: {
    gap: 12,
    paddingBottom: 8,
  },
  cardWrapper: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  emptyText: {
    color: '#71717a',
    fontSize: 14,
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  closeButton: {
    marginTop: 16,
    backgroundColor: '#7c3aed',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  closeText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
