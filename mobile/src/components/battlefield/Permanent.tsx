/**
 * Permanent
 *
 * A single permanent on the battlefield. Handles tap gesture.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withSpring,
  useSharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import type { CardInstance, CardDefinition } from '@/types';
import { useGame } from '@/contexts/GameContext';
import { CardImage } from '@/components/cards/CardImage';
import { CounterBadge } from '@/components/common/CounterBadge';
import { TargetHighlight } from '@/components/targeting/TargetHighlight';

interface PermanentProps {
  card: CardInstance;
  definition: CardDefinition;
}

export function Permanent({ card, definition }: PermanentProps) {
  const {
    tapPermanent,
    setOverlay,
    targeting,
    isValidTarget,
    isSelectedTarget,
    selectTarget,
  } = useGame();
  const scale = useSharedValue(1);

  const isInTargetingMode = targeting.isTargeting;
  const canBeTargeted = isInTargetingMode && isValidTarget(card.instanceId);
  const isSelected = isInTargetingMode && isSelectedTarget(card.instanceId);

  const handleTap = () => {
    // If in targeting mode and this is a valid target, select it
    if (isInTargetingMode && canBeTargeted) {
      selectTarget(card.instanceId);
      return;
    }

    // Normal tap behavior
    if (!isInTargetingMode) {
      tapPermanent(card.instanceId);
    }
  };

  const handleLongPress = () => {
    setOverlay('cardZoom', card.instanceId);
  };

  const tapGesture = Gesture.Tap()
    .maxDuration(250)
    .onEnd(() => {
      runOnJS(handleTap)();
    });

  const longPressGesture = Gesture.LongPress()
    .minDuration(400)
    .onStart(() => {
      scale.value = withSpring(1.05);
      runOnJS(handleLongPress)();
    })
    .onEnd(() => {
      scale.value = withSpring(1);
    });

  const composedGesture = Gesture.Exclusive(longPressGesture, tapGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { rotate: card.tapped ? '90deg' : '0deg' },
    ],
  }));

  const hasCounters = Object.keys(card.counters).length > 0;

  // Determine highlight type
  const highlightType = isSelected ? 'selected' : canBeTargeted ? 'valid' : null;

  const content = (
    <Animated.View style={[styles.container, animatedStyle]}>
      <CardImage name={definition.name} size="small" />

      {/* Counters */}
      {hasCounters && (
        <View style={styles.countersContainer}>
          {Object.entries(card.counters).map(([type, count]) => (
            <CounterBadge key={type} type={type} count={count} />
          ))}
        </View>
      )}

      {/* Power/Toughness for creatures */}
      {definition.power !== undefined && definition.toughness !== undefined && (
        <View style={styles.ptBadge}>
          <Text style={styles.ptText}>
            {definition.power + (card.counters['+1/+1'] || 0)}/
            {definition.toughness + (card.counters['+1/+1'] || 0)}
          </Text>
        </View>
      )}

      {/* Summoning sick indicator */}
      {card.summoningSick && definition.card_types.includes('creature') && (
        <View style={styles.sickIndicator} />
      )}
    </Animated.View>
  );

  return (
    <GestureDetector gesture={composedGesture}>
      {highlightType ? (
        <TargetHighlight type={highlightType}>
          {content}
        </TargetHighlight>
      ) : (
        content
      )}
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 60,
    height: 84,
    borderRadius: 4,
    overflow: 'visible',
  },
  countersContainer: {
    position: 'absolute',
    top: -4,
    right: -4,
    flexDirection: 'row',
    gap: 2,
  },
  ptBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  ptText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  sickIndicator: {
    position: 'absolute',
    top: 2,
    left: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fbbf24',
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
});
