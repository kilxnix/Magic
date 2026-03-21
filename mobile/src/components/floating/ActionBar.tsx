/**
 * ActionBar
 *
 * Bottom bar showing available actions, current phase prompts, and Pass button.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useGame } from '@/contexts/GameContext';
import { COLORS } from '@/constants/colors';

export function ActionBar() {
  const {
    hasYourPriority,
    isYourTurn,
    targeting,
    combat,
    isAIThinking,
    currentPhase,
    currentStep,
    getLegalActions,
    passPriority,
    priorityPlayer,
  } = useGame();

  // Get available actions
  const actions = useMemo(() => {
    if (!hasYourPriority) return [];
    return getLegalActions();
  }, [hasYourPriority, getLegalActions]);

  // Count available action types
  const actionCounts = useMemo(() => {
    const counts = {
      lands: 0,
      spells: 0,
      mana: 0,
    };

    for (const action of actions) {
      if (action.kind === 'PlayLand') counts.lands++;
      else if (action.kind === 'CastSpell') counts.spells++;
      else if (action.kind === 'ActivateManaAbility') counts.mana++;
    }

    return counts;
  }, [actions]);

  // Don't show when targeting or in combat (other overlays handle those)
  if (targeting.isTargeting || combat.isDeclaringAttackers || combat.isDeclaringBlockers) {
    return null;
  }

  // Determine message based on state
  let statusMessage: string;
  let showActions = false;

  if (isAIThinking) {
    statusMessage = 'AI is thinking...';
  } else if (!hasYourPriority) {
    statusMessage = priorityPlayer
      ? `Waiting for ${priorityPlayer.name}...`
      : 'Waiting...';
  } else {
    // We have priority
    showActions = true;
    if (currentPhase === 'beginning') {
      statusMessage = isYourTurn ? 'Beginning phase' : 'Beginning phase';
    } else if (currentPhase === 'precombat_main') {
      statusMessage = isYourTurn ? 'Main phase - Play spells and lands' : 'Main phase';
    } else if (currentPhase === 'combat') {
      statusMessage = currentStep === 'begin_combat'
        ? 'Beginning of combat'
        : 'Combat phase';
    } else if (currentPhase === 'postcombat_main') {
      statusMessage = isYourTurn ? 'Second main phase' : 'Main phase';
    } else if (currentPhase === 'ending') {
      statusMessage = currentStep === 'end' ? 'End step' : 'Cleanup';
    } else {
      statusMessage = 'Your priority';
    }
  }

  return (
    <Animated.View
      style={styles.container}
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(150)}
    >
      <View style={styles.content}>
        {/* Status message */}
        <Text style={styles.statusText}>{statusMessage}</Text>

        {/* Action badges */}
        {showActions && (
          <View style={styles.actionBadges}>
            {actionCounts.lands > 0 && (
              <View style={[styles.badge, styles.landBadge]}>
                <Text style={styles.badgeText}>Land</Text>
              </View>
            )}
            {actionCounts.spells > 0 && (
              <View style={[styles.badge, styles.spellBadge]}>
                <Text style={styles.badgeText}>{actionCounts.spells} Spell{actionCounts.spells > 1 ? 's' : ''}</Text>
              </View>
            )}
          </View>
        )}

        {/* Pass button */}
        {hasYourPriority && (
          <Pressable style={styles.passButton} onPress={passPriority}>
            <Text style={styles.passText}>Pass</Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 60,
    left: 12,
    right: 12,
    zIndex: 40,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statusText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  actionBadges: {
    flexDirection: 'row',
    gap: 6,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  landBadge: {
    backgroundColor: '#2d4a2d',
  },
  spellBadge: {
    backgroundColor: '#2d2d4a',
  },
  badgeText: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  passButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  passText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
});
