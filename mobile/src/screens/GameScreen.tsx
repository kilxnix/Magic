/**
 * GameScreen
 *
 * Main game screen with battlefield-first layout.
 * Shows your board on the bottom, opponents on top, with floating badges.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGame } from '@/contexts/GameContext';
import { Battlefield } from '@/components/battlefield/Battlefield';
import { LifeBadge } from '@/components/floating/LifeBadge';
import { PhaseIndicator } from '@/components/floating/PhaseIndicator';
import { StackBadge } from '@/components/floating/StackBadge';
import { HandBadge } from '@/components/floating/HandBadge';
import { PriorityIndicator } from '@/components/floating/PriorityIndicator';
import { ActionBar } from '@/components/floating/ActionBar';
import { HandOverlay } from '@/overlays/HandOverlay';
import { TargetingOverlay } from '@/overlays/TargetingOverlay';
import { CombatOverlay } from '@/components/combat/CombatOverlay';
import { PlayerTargetBadge } from '@/components/targeting/PlayerTargetBadge';
import { GameMenuOverlay } from '@/overlays/GameMenuOverlay';
import { useSaveManager } from '@/hooks/useSaveManager';

export function GameScreen() {
  const {
    gameState,
    isLoading,
    error,
    humanPlayer,
    opponents,
    activePlayer,
    priorityPlayer,
    hand,
    battlefield,
    lands,
    creatures,
    otherPermanents,
    isYourTurn,
    hasYourPriority,
    currentPhase,
    currentStep,
    turnNumber,
    stackItems,
    hasStackItems,
    isAIThinking,
    overlays,
    toggleOverlay,
    setOverlay,
    passPriority,
    getDefinition,
    targeting,
    isValidTarget,
    isSelectedTarget,
    selectTarget,
    setGameState,
  } = useGame();

  const { loadGame } = useSaveManager();
  const [showMenu, setShowMenu] = React.useState(false);

  const handleLoadGame = async (slotId: string) => {
    const state = await loadGame(slotId);
    if (state) {
      setGameState(state);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.loadingText}>Loading game...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.errorText}>Error: {error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!gameState || !humanPlayer) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.loadingText}>Initializing...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Opponent area (top 40%) */}
      <View style={styles.opponentArea}>
        {opponents.map((opponent, index) => {
          const isTargetable = targeting.isTargeting && isValidTarget(opponent.id);
          const isSelected = targeting.isTargeting && isSelectedTarget(opponent.id);

          return (
            <View key={opponent.id} style={styles.opponentRow}>
              <LifeBadge
                playerId={opponent.id}
                name={opponent.name}
                life={opponent.life}
                isYou={false}
                isActive={activePlayer?.id === opponent.id}
                onPress={() => {
                  if (isTargetable) {
                    selectTarget(opponent.id);
                  } else {
                    setOverlay('opponent', opponent.id);
                  }
                }}
              />
              {isTargetable && (
                <View style={styles.targetBadgeContainer}>
                  <PlayerTargetBadge
                    playerId={opponent.id}
                    playerName={opponent.name}
                    isSelected={isSelected}
                    onPress={() => selectTarget(opponent.id)}
                  />
                </View>
              )}
            </View>
          );
        })}
        {isAIThinking && (
          <View style={styles.aiThinkingBadge}>
            <Text style={styles.aiThinkingText}>AI thinking...</Text>
          </View>
        )}
      </View>

      {/* Your battlefield (bottom 60%) */}
      <View style={styles.battlefieldArea}>
        <Battlefield
          lands={lands}
          creatures={creatures}
          otherPermanents={otherPermanents}
          getDefinition={getDefinition}
        />
      </View>

      {/* Floating badges */}
      <View style={styles.floatingBadges}>
        {/* Phase indicator - top left */}
        <PhaseIndicator
          phase={currentPhase}
          step={currentStep}
          turnNumber={turnNumber}
          activePlayerName={activePlayer?.name ?? ''}
          isYourTurn={isYourTurn}
        />

        {/* Menu button - top right corner */}
        <View style={styles.menuButtonContainer}>
          <Pressable style={styles.menuButton} onPress={() => setShowMenu(true)}>
            <Text style={styles.menuButtonText}>Menu</Text>
          </Pressable>
        </View>

        {/* Stack badge - top right (below menu) */}
        {hasStackItems && (
          <StackBadge
            itemCount={stackItems.length}
            onPress={() => toggleOverlay('stack')}
          />
        )}

        {/* Your life - bottom left */}
        <View style={styles.yourLifeContainer}>
          <LifeBadge
            playerId={humanPlayer.id}
            name="You"
            life={humanPlayer.life}
            isYou={true}
            isActive={isYourTurn}
            onPress={() => setOverlay('lifeTotal', humanPlayer.id)}
          />
        </View>

        {/* Hand badge - bottom center */}
        <HandBadge
          cardCount={hand.length}
          onPress={() => toggleOverlay('hand')}
        />

        {/* Priority indicator - bottom right */}
        {hasYourPriority && (
          <PriorityIndicator
            hasYourPriority={hasYourPriority}
            priorityPlayerName={priorityPlayer?.name ?? ''}
            onPassPress={passPriority}
          />
        )}
      </View>

      {/* Action bar */}
      <ActionBar />

      {/* Hand overlay */}
      <HandOverlay
        visible={overlays.hand}
        onDismiss={() => setOverlay('hand', false)}
      />

      {/* Targeting overlay */}
      <TargetingOverlay />

      {/* Combat overlay */}
      <CombatOverlay />

      {/* Game menu overlay */}
      <GameMenuOverlay
        visible={showMenu}
        onDismiss={() => setShowMenu(false)}
        onLoadGame={handleLoadGame}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#a1a1aa',
    fontSize: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 16,
  },
  opponentArea: {
    height: '35%',
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
    padding: 12,
    gap: 8,
  },
  opponentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  targetBadgeContainer: {
    marginLeft: 8,
  },
  aiThinkingBadge: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -50 }, { translateY: -12 }],
    backgroundColor: '#7c3aed',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  aiThinkingText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  battlefieldArea: {
    flex: 1,
    padding: 12,
  },
  floatingBadges: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'box-none',
  },
  yourLifeContainer: {
    position: 'absolute',
    bottom: 100,
    left: 12,
  },
  menuButtonContainer: {
    position: 'absolute',
    top: 50,
    right: 12,
  },
  menuButton: {
    backgroundColor: '#27272a',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  menuButtonText: {
    color: '#a1a1aa',
    fontSize: 14,
    fontWeight: '600',
  },
});
