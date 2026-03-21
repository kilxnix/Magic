/**
 * PhaseIndicator
 *
 * Shows current phase, step, and turn number.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
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
  return (
    <View style={[styles.container, isYourTurn && styles.containerYourTurn]}>
      <Text style={styles.turn}>Turn {turnNumber}</Text>
      <Text style={styles.phase}>{PHASE_LABELS[phase]}</Text>
      <Text style={styles.step}>{STEP_LABELS[step]}</Text>
      <Text style={styles.player} numberOfLines={1}>
        {isYourTurn ? 'Your turn' : activePlayerName}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: 12,
    backgroundColor: '#27272a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3f3f46',
    gap: 2,
  },
  containerYourTurn: {
    borderColor: '#7c3aed',
  },
  turn: {
    color: '#71717a',
    fontSize: 11,
    fontWeight: '600',
  },
  phase: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  step: {
    color: '#a1a1aa',
    fontSize: 12,
  },
  player: {
    color: '#7c3aed',
    fontSize: 11,
    fontWeight: '500',
    maxWidth: 80,
  },
});
