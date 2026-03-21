/**
 * HandOverlay
 *
 * Swipe-up overlay showing cards in hand. Tap a card to cast/play it.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Dimensions,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  withSpring,
  useSharedValue,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useGame } from '@/contexts/GameContext';
import { CardImage } from '@/components/cards/CardImage';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const OVERLAY_HEIGHT = SCREEN_HEIGHT * 0.45;

interface HandOverlayProps {
  visible: boolean;
  onDismiss: () => void;
}

export function HandOverlay({ visible, onDismiss }: HandOverlayProps) {
  const {
    hand,
    getDefinition,
    canPlayLand,
    canCastSpell,
    playLand,
    castSpell,
    setOverlay,
    getSpellTargetSpecs,
    startTargeting,
    targeting,
  } = useGame();

  const translateY = useSharedValue(visible ? 0 : OVERLAY_HEIGHT);

  React.useEffect(() => {
    translateY.value = withSpring(visible ? 0 : OVERLAY_HEIGHT, {
      damping: 20,
      stiffness: 200,
    });
  }, [visible, translateY]);

  const handleCardTap = (cardInstanceId: string) => {
    const card = hand.find(c => c.instanceId === cardInstanceId);
    if (!card) return;

    const def = getDefinition(card);
    if (!def) return;

    // If it's a land and we can play it, play it
    if (def.card_types.includes('land') && canPlayLand(cardInstanceId)) {
      playLand(cardInstanceId);
      onDismiss();
      return;
    }

    // If we can cast it, check if it needs targets
    if (canCastSpell(cardInstanceId)) {
      const targetSpecs = getSpellTargetSpecs(cardInstanceId);

      if (targetSpecs.length > 0) {
        // Spell needs targets - enter targeting mode
        startTargeting(cardInstanceId);
        onDismiss();
        return;
      }

      // No targets needed - cast immediately
      castSpell(cardInstanceId, []);
      onDismiss();
      return;
    }
  };

  const handleCardLongPress = (cardInstanceId: string) => {
    setOverlay('cardZoom', cardInstanceId);
  };

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      if (event.translationY > 0) {
        translateY.value = event.translationY;
      }
    })
    .onEnd((event) => {
      if (event.translationY > OVERLAY_HEIGHT * 0.3) {
        translateY.value = withSpring(OVERLAY_HEIGHT, {
          damping: 20,
          stiffness: 200,
        });
        runOnJS(onDismiss)();
      } else {
        translateY.value = withSpring(0, {
          damping: 20,
          stiffness: 200,
        });
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!visible && translateY.value >= OVERLAY_HEIGHT) {
    return null;
  }

  return (
    <View style={styles.wrapper}>
      {/* Backdrop */}
      <Pressable style={styles.backdrop} onPress={onDismiss} />

      {/* Overlay */}
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.container, animatedStyle]}>
          {/* Handle */}
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Your Hand</Text>
            <Text style={styles.count}>{hand.length} cards</Text>
          </View>

          {/* Cards */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.cardsContainer}
          >
            {hand.map(card => {
              const def = getDefinition(card);
              if (!def) return null;

              const isPlayable = def.card_types.includes('land')
                ? canPlayLand(card.instanceId)
                : canCastSpell(card.instanceId);

              return (
                <Pressable
                  key={card.instanceId}
                  style={[styles.cardWrapper, isPlayable && styles.cardPlayable]}
                  onPress={() => handleCardTap(card.instanceId)}
                  onLongPress={() => handleCardLongPress(card.instanceId)}
                >
                  <CardImage name={def.name} size="medium" />
                  {isPlayable && (
                    <View style={styles.playableIndicator}>
                      <Text style={styles.playableText}>
                        {def.card_types.includes('land') ? 'Play' : 'Cast'}
                      </Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: OVERLAY_HEIGHT,
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: '#27272a',
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#3f3f46',
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  title: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  count: {
    color: '#71717a',
    fontSize: 14,
  },
  cardsContainer: {
    paddingHorizontal: 16,
    gap: 12,
    paddingBottom: 20,
  },
  cardWrapper: {
    borderRadius: 8,
    overflow: 'hidden',
    opacity: 0.6,
  },
  cardPlayable: {
    opacity: 1,
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },
  playableIndicator: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    backgroundColor: '#7c3aed',
    paddingVertical: 6,
    borderRadius: 4,
    alignItems: 'center',
  },
  playableText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
});
