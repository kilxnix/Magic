/**
 * CombatOverlay
 *
 * Shows combat phase UI with attacker/blocker selection.
 * Auto-shows when in declare_attackers or declare_blockers step.
 */

import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import Animated, { SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useGame } from '@/contexts/GameContext';
import { COLORS } from '@/constants/colors';
import type { CardInstance } from '@/types';

export function CombatOverlay() {
  const {
    gameState,
    humanPlayerId,
    opponents,
    creatures,
    getDefinition,
    combat,
    toggleAttacker,
    assignBlocker,
    confirmAttackers,
    confirmBlockers,
    skipCombat,
  } = useGame();

  const [selectedOpponent, setSelectedOpponent] = useState<string>(
    opponents[0]?.id ?? ''
  );
  const [selectedBlocker, setSelectedBlocker] = useState<string | null>(null);

  // Get eligible creatures for attacking (untapped, no summoning sickness)
  const eligibleAttackers = useMemo(() => {
    return creatures.filter(c => {
      const def = getDefinition(c);
      if (!def?.card_types.includes('creature')) return false;
      if (c.tapped) return false;
      if (c.summoningSick) return false;
      return true;
    });
  }, [creatures, getDefinition]);

  // Get eligible blockers (untapped creatures)
  const eligibleBlockers = useMemo(() => {
    return creatures.filter(c => {
      const def = getDefinition(c);
      if (!def?.card_types.includes('creature')) return false;
      if (c.tapped) return false;
      return true;
    });
  }, [creatures, getDefinition]);

  // Get incoming attackers when being attacked
  const incomingAttackers = useMemo(() => {
    if (!gameState?.combat?.attackers) return [];
    return gameState.combat.attackers
      .filter(a => a.defendingPlayerId === humanPlayerId)
      .map(a => gameState.cards.get(a.cardInstanceId))
      .filter((c): c is CardInstance => c !== undefined);
  }, [gameState, humanPlayerId]);

  const { isDeclaringAttackers, isDeclaringBlockers, pendingAttackers, pendingBlockers } = combat;

  // Don't render if not in combat declaration step
  if (!isDeclaringAttackers && !isDeclaringBlockers) {
    return null;
  }

  const handleCreatureTap = (creature: CardInstance) => {
    if (isDeclaringAttackers) {
      toggleAttacker(creature.instanceId, selectedOpponent || opponents[0]?.id);
    } else if (isDeclaringBlockers && selectedBlocker) {
      // Assign blocker to the selected attacker
      assignBlocker(selectedBlocker, creature.instanceId);
      setSelectedBlocker(null);
    }
  };

  const handleBlockerSelect = (blockerId: string) => {
    // Toggle blocker selection - if already blocking, remove
    if (pendingBlockers.has(blockerId)) {
      // Already blocking, clear by re-assigning
      setSelectedBlocker(null);
    } else {
      setSelectedBlocker(blockerId);
    }
  };

  const handleAttackerTapForBlocking = (attackerId: string) => {
    if (selectedBlocker) {
      assignBlocker(selectedBlocker, attackerId);
      setSelectedBlocker(null);
    }
  };

  return (
    <Animated.View
      style={styles.container}
      entering={SlideInDown.duration(200)}
      exiting={SlideOutDown.duration(200)}
    >
      <View style={styles.header}>
        <Text style={styles.title}>
          {isDeclaringAttackers ? 'Declare Attackers' : 'Declare Blockers'}
        </Text>
        <Text style={styles.subtitle}>
          {isDeclaringAttackers
            ? 'Tap creatures to attack'
            : selectedBlocker
              ? 'Now tap an attacker to block'
              : 'Tap a blocker, then tap an attacker'}
        </Text>
      </View>

      {/* Opponent selector for attackers */}
      {isDeclaringAttackers && opponents.length > 1 && (
        <View style={styles.opponentSelector}>
          <Text style={styles.selectorLabel}>Attacking:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {opponents.map(opponent => (
              <Pressable
                key={opponent.id}
                style={[
                  styles.opponentButton,
                  selectedOpponent === opponent.id && styles.opponentButtonActive,
                ]}
                onPress={() => setSelectedOpponent(opponent.id)}
              >
                <Text
                  style={[
                    styles.opponentText,
                    selectedOpponent === opponent.id && styles.opponentTextActive,
                  ]}
                >
                  {opponent.name} ({opponent.life})
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Attacker selection - your creatures */}
      {isDeclaringAttackers && (
        <>
          <Text style={styles.sectionLabel}>Your Creatures</Text>
          <ScrollView horizontal style={styles.creatures} showsHorizontalScrollIndicator={false}>
            {eligibleAttackers.length === 0 ? (
              <Text style={styles.emptyText}>No creatures can attack</Text>
            ) : (
              eligibleAttackers.map(creature => {
                const def = getDefinition(creature);
                const isAttacking = pendingAttackers.has(creature.instanceId);

                return (
                  <Pressable
                    key={creature.instanceId}
                    style={[styles.creature, isAttacking && styles.creatureAttacking]}
                    onPress={() => handleCreatureTap(creature)}
                  >
                    <Text style={styles.creatureName} numberOfLines={1}>
                      {def?.name ?? 'Unknown'}
                    </Text>
                    <Text style={styles.creaturePT}>
                      {def?.power}/{def?.toughness}
                    </Text>
                    {isAttacking && (
                      <View style={styles.attackingBadge}>
                        <Text style={styles.attackingText}>ATK</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </>
      )}

      {/* Blocker selection - show incoming attackers and your blockers */}
      {isDeclaringBlockers && (
        <>
          {/* Incoming attackers */}
          <Text style={styles.sectionLabel}>Incoming Attackers</Text>
          <ScrollView horizontal style={styles.creatures} showsHorizontalScrollIndicator={false}>
            {incomingAttackers.length === 0 ? (
              <Text style={styles.emptyText}>No attackers targeting you</Text>
            ) : (
              incomingAttackers.map(attacker => {
                const def = getDefinition(attacker);
                // Check if any blocker is assigned to this attacker
                const blockerIds = Array.from(pendingBlockers.entries())
                  .filter(([_, attackerId]) => attackerId === attacker.instanceId)
                  .map(([blockerId]) => blockerId);
                const isBlocked = blockerIds.length > 0;

                return (
                  <Pressable
                    key={attacker.instanceId}
                    style={[
                      styles.creature,
                      styles.creatureEnemy,
                      isBlocked && styles.creatureBlocked,
                    ]}
                    onPress={() => handleAttackerTapForBlocking(attacker.instanceId)}
                  >
                    <Text style={styles.creatureName} numberOfLines={1}>
                      {def?.name ?? 'Unknown'}
                    </Text>
                    <Text style={styles.creaturePT}>
                      {def?.power}/{def?.toughness}
                    </Text>
                    {isBlocked && (
                      <View style={styles.blockedBadge}>
                        <Text style={styles.blockedText}>BLK</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          {/* Your blockers */}
          <Text style={styles.sectionLabel}>Your Blockers</Text>
          <ScrollView horizontal style={styles.creatures} showsHorizontalScrollIndicator={false}>
            {eligibleBlockers.length === 0 ? (
              <Text style={styles.emptyText}>No creatures can block</Text>
            ) : (
              eligibleBlockers.map(blocker => {
                const def = getDefinition(blocker);
                const isBlocking = pendingBlockers.has(blocker.instanceId);
                const isSelected = selectedBlocker === blocker.instanceId;

                return (
                  <Pressable
                    key={blocker.instanceId}
                    style={[
                      styles.creature,
                      isBlocking && styles.creatureBlocking,
                      isSelected && styles.creatureSelected,
                    ]}
                    onPress={() => handleBlockerSelect(blocker.instanceId)}
                  >
                    <Text style={styles.creatureName} numberOfLines={1}>
                      {def?.name ?? 'Unknown'}
                    </Text>
                    <Text style={styles.creaturePT}>
                      {def?.power}/{def?.toughness}
                    </Text>
                    {isBlocking && (
                      <View style={styles.blockingBadge}>
                        <Text style={styles.blockingText}>BLK</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <Pressable style={styles.skipButton} onPress={skipCombat}>
          <Text style={styles.skipText}>
            {isDeclaringAttackers ? 'Skip' : 'No Blocks'}
          </Text>
        </Pressable>
        <Pressable
          style={styles.confirmButton}
          onPress={isDeclaringAttackers ? confirmAttackers : confirmBlockers}
        >
          <Text style={styles.confirmText}>
            {isDeclaringAttackers
              ? pendingAttackers.size > 0
                ? `Attack (${pendingAttackers.size})`
                : 'Skip Attack'
              : pendingBlockers.size > 0
                ? `Block (${pendingBlockers.size})`
                : 'No Blocks'}
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 2,
    borderColor: COLORS.error,
    padding: 16,
    zIndex: 100,
  },
  header: {
    marginBottom: 12,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    color: COLORS.textDim,
    fontSize: 14,
    marginTop: 4,
  },
  sectionLabel: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 8,
  },
  opponentSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  selectorLabel: {
    color: COLORS.textMuted,
    fontSize: 14,
  },
  opponentButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    marginRight: 8,
  },
  opponentButtonActive: {
    backgroundColor: COLORS.primary,
  },
  opponentText: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: '500',
  },
  opponentTextActive: {
    color: COLORS.textPrimary,
  },
  creatures: {
    marginBottom: 8,
    maxHeight: 110,
  },
  emptyText: {
    color: COLORS.textDim,
    fontSize: 14,
    fontStyle: 'italic',
    paddingVertical: 20,
  },
  creature: {
    width: 80,
    height: 100,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    padding: 8,
    marginRight: 8,
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  creatureEnemy: {
    backgroundColor: '#2d1f1f',
  },
  creatureAttacking: {
    borderColor: COLORS.error,
    backgroundColor: '#3b0d0d',
  },
  creatureBlocking: {
    borderColor: COLORS.info,
    backgroundColor: '#0d2d3b',
  },
  creatureBlocked: {
    borderColor: COLORS.warning,
  },
  creatureSelected: {
    borderColor: COLORS.success,
    backgroundColor: '#0d3b1f',
  },
  creatureName: {
    color: COLORS.textPrimary,
    fontSize: 11,
    fontWeight: '500',
  },
  creaturePT: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  attackingBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: COLORS.error,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  attackingText: {
    color: COLORS.textPrimary,
    fontSize: 8,
    fontWeight: '700',
  },
  blockingBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: COLORS.info,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  blockingText: {
    color: COLORS.textPrimary,
    fontSize: 8,
    fontWeight: '700',
  },
  blockedBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: COLORS.warning,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  blockedText: {
    color: COLORS.background,
    fontSize: 8,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  skipButton: {
    flex: 1,
    backgroundColor: COLORS.surface,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  skipText: {
    color: COLORS.textMuted,
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButton: {
    flex: 2,
    backgroundColor: COLORS.error,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
});
