/**
 * LifeTotalOverlay
 *
 * Detailed life total view with commander damage breakdown.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useGame } from '@/contexts/GameContext';

interface LifeTotalOverlayProps {
  visible: boolean;
  playerId: string | null;
  onDismiss: () => void;
}

export function LifeTotalOverlay({
  visible,
  playerId,
  onDismiss,
}: LifeTotalOverlayProps) {
  const { gameState } = useGame();

  if (!visible || !playerId || !gameState) return null;

  const player = gameState.players.find(p => p.id === playerId);
  if (!player) return null;

  // Get commander damage details
  const commanderDamageEntries = Object.entries(player.commanderDamage);

  // Get commander names
  const getCommanderName = (commanderInstanceId: string): string => {
    const card = gameState.cards.get(commanderInstanceId);
    if (!card) return 'Unknown Commander';
    const def = gameState.cardDefinitions.get(card.definitionId);
    return def?.name ?? 'Unknown Commander';
  };

  const lifeColor = player.life > 20 ? '#22c55e' : player.life > 10 ? '#eab308' : '#ef4444';

  return (
    <Pressable style={styles.backdrop} onPress={onDismiss}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.playerName}>{player.name}</Text>
        </View>

        {/* Life total */}
        <View style={styles.lifeSection}>
          <Text style={styles.lifeLabel}>Life Total</Text>
          <Text style={[styles.lifeValue, { color: lifeColor }]}>
            {player.life}
          </Text>
        </View>

        {/* Commander damage */}
        {commanderDamageEntries.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Commander Damage</Text>
            <ScrollView style={styles.damageList}>
              {commanderDamageEntries.map(([cmdId, damage]) => (
                <View key={cmdId} style={styles.damageRow}>
                  <Text style={styles.commanderName}>
                    {getCommanderName(cmdId)}
                  </Text>
                  <Text style={[
                    styles.damageValue,
                    damage >= 21 && styles.damageLethal,
                  ]}>
                    {damage}/21
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Commander tax */}
        {player.commanderCastCount > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Commander Tax</Text>
            <Text style={styles.taxValue}>
              +{player.commanderCastCount * 2} ({player.commanderCastCount} casts)
            </Text>
          </View>
        )}

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
    padding: 20,
    width: '80%',
    maxWidth: 320,
  },
  header: {
    marginBottom: 20,
    alignItems: 'center',
  },
  playerName: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
  },
  lifeSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  lifeLabel: {
    color: '#71717a',
    fontSize: 14,
    marginBottom: 4,
  },
  lifeValue: {
    fontSize: 64,
    fontWeight: '700',
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#a1a1aa',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  damageList: {
    maxHeight: 120,
  },
  damageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#27272a',
    padding: 10,
    borderRadius: 8,
    marginBottom: 6,
  },
  commanderName: {
    color: '#e4e4e7',
    fontSize: 13,
    flex: 1,
  },
  damageValue: {
    color: '#eab308',
    fontSize: 14,
    fontWeight: '700',
  },
  damageLethal: {
    color: '#ef4444',
  },
  taxValue: {
    color: '#7c3aed',
    fontSize: 16,
    fontWeight: '600',
    backgroundColor: '#27272a',
    padding: 10,
    borderRadius: 8,
    textAlign: 'center',
  },
  closeButton: {
    marginTop: 20,
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
