/**
 * TargetingOverlay
 *
 * Shows when the player is selecting targets for a spell.
 * Displays the spell being cast, target count, and Confirm/Cancel buttons.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInUp, SlideOutDown } from 'react-native-reanimated';
import { useGame } from '@/contexts/GameContext';
import { COLORS } from '@/constants/colors';

export function TargetingOverlay() {
  const {
    targeting,
    confirmTargeting,
    cancelTargeting,
  } = useGame();

  if (!targeting.isTargeting) {
    return null;
  }

  const targetCount = targeting.selectedTargets.length;
  const requiredCount = targeting.requiredCount;
  const canConfirm = targeting.hasEnoughTargets;

  return (
    <Animated.View
      style={styles.container}
      entering={SlideInUp.duration(200)}
      exiting={SlideOutDown.duration(200)}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Select Target</Text>
        <Text style={styles.spellName}>{targeting.sourceCardName}</Text>
      </View>

      {/* Target count indicator */}
      <View style={styles.countContainer}>
        <Text style={styles.countLabel}>Targets:</Text>
        <Text style={[
          styles.countValue,
          canConfirm && styles.countValueReady,
        ]}>
          {targetCount} / {requiredCount}
        </Text>
      </View>

      {/* Instructions */}
      <Text style={styles.instructions}>
        Tap a highlighted creature or player to select as target
      </Text>

      {/* Actions */}
      <View style={styles.actions}>
        <Pressable style={styles.cancelButton} onPress={cancelTargeting}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.confirmButton, !canConfirm && styles.confirmButtonDisabled]}
          onPress={confirmTargeting}
          disabled={!canConfirm}
        >
          <Text style={[styles.confirmText, !canConfirm && styles.confirmTextDisabled]}>
            Confirm
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 80,
    left: 16,
    right: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: COLORS.success,
    shadowColor: COLORS.success,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 200,
  },
  header: {
    marginBottom: 12,
  },
  title: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  spellName: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 4,
  },
  countContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  countLabel: {
    color: COLORS.textMuted,
    fontSize: 14,
  },
  countValue: {
    color: COLORS.warning,
    fontSize: 16,
    fontWeight: '700',
  },
  countValueReady: {
    color: COLORS.success,
  },
  instructions: {
    color: COLORS.textDim,
    fontSize: 13,
    marginBottom: 16,
    fontStyle: 'italic',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: COLORS.surfaceLight,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelText: {
    color: COLORS.textMuted,
    fontSize: 15,
    fontWeight: '600',
  },
  confirmButton: {
    flex: 2,
    backgroundColor: COLORS.success,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: COLORS.surfaceLight,
  },
  confirmText: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  confirmTextDisabled: {
    color: COLORS.textDim,
  },
});
