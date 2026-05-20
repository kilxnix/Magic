/**
 * PhaseIndicator
 *
 * Shows current phase, step, and turn number.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Phase, Step } from '@/types';

interface PhaseIndicatorProps {
  phase: Phase;
  step: Step;
  turnNumber: number;
  activePlayerName: string;
  isYourTurn: boolean;
}

const PHASE_LABELS: Record<Phase, string> = {
  beginning: 'Beginning',
  precombat_main: 'Main 1',
  combat: 'Combat',
  postcombat_main: 'Main 2',
  ending: 'End',
};

const STEP_LABELS: Record<Step, string> = {
  untap: 'Untap',
  upkeep: 'Upkeep',
  draw: 'Draw',
  begin_combat: 'Begin',
  declare_attackers: 'Attackers',
  declare_blockers: 'Blockers',
  first_strike_damage: 'First Strike',
  combat_damage: 'Damage',
  end_of_combat: 'End Combat',
  end: 'End Step',
  cleanup: 'Cleanup',
};

export function PhaseIndicator({
  phase,
  step,
  turnNumber,
  activePlayerName,
  isYourTurn,
}: PhaseIndicatorProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { top: insets.top + 8 }, isYourTurn && styles.containerYourTurn]}>
      <Text style={styles.turn}>T{turnNumber}</Text>
      <View style={styles.phaseGroup}>
        <Text style={styles.phase}>{PHASE_LABELS[phase]}</Text>
        <Text style={styles.step}>{STEP_LABELS[step]}</Text>
      </View>
      <Text style={styles.player} numberOfLines={1}>
        {isYourTurn ? 'Your turn' : activePlayerName}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#27272a',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3f3f46',
    gap: 8,
  },
  containerYourTurn: {
    borderColor: '#7c3aed',
  },
  turn: {
    color: '#71717a',
    fontSize: 12,
    fontWeight: '700',
  },
  phaseGroup: {
    gap: 1,
  },
  phase: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  step: {
    color: '#a1a1aa',
    fontSize: 10,
  },
  player: {
    color: '#7c3aed',
    fontSize: 10,
    fontWeight: '600',
    maxWidth: 64,
  },
});
