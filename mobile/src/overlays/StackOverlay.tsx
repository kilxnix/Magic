/**
 * StackOverlay
 *
 * Shows items on the stack, from top (resolving next) to bottom.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useGame } from '@/contexts/GameContext';
import type { StackItem, SpellStackItem, TriggeredAbilityStackItem } from '@/types';

interface StackOverlayProps {
  visible: boolean;
  onDismiss: () => void;
}

function isSpellItem(item: StackItem): item is SpellStackItem {
  return item.kind === 'Spell';
}

function isTriggeredItem(item: StackItem): item is TriggeredAbilityStackItem {
  return item.kind === 'TriggeredAbility';
}

export function StackOverlay({ visible, onDismiss }: StackOverlayProps) {
  const { stackItems, gameState } = useGame();

  if (!visible) return null;

  const getItemName = (item: StackItem): string => {
    if (isSpellItem(item)) {
      const card = gameState?.cards.get(item.cardInstanceId);
      const def = card ? gameState?.cardDefinitions.get(card.definitionId) : null;
      return def?.name ?? 'Unknown Spell';
    }
    if (isTriggeredItem(item)) {
      const card = gameState?.cards.get(item.sourceInstanceId);
      const def = card ? gameState?.cardDefinitions.get(card.definitionId) : null;
      return `${def?.name ?? 'Unknown'} trigger`;
    }
    return 'Unknown';
  };

  const getControllerName = (item: StackItem): string => {
    const playerId = isSpellItem(item) ? item.casterId : item.controllerId;
    const player = gameState?.players.find(p => p.id === playerId);
    return player?.name ?? 'Unknown';
  };

  return (
    <Pressable style={styles.backdrop} onPress={onDismiss}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>The Stack</Text>
          <Text style={styles.subtitle}>Top resolves first</Text>
        </View>

        <ScrollView style={styles.scroll}>
          {stackItems.length === 0 ? (
            <Text style={styles.emptyText}>Stack is empty</Text>
          ) : (
            stackItems.map((item, index) => (
              <View
                key={item.id}
                style={[
                  styles.stackItem,
                  index === 0 && styles.stackItemTop,
                ]}
              >
                <View style={styles.itemHeader}>
                  <Text style={styles.itemIndex}>#{stackItems.length - index}</Text>
                  <Text style={styles.itemKind}>{item.kind}</Text>
                </View>
                <Text style={styles.itemName}>{getItemName(item)}</Text>
                <Text style={styles.itemController}>
                  Controller: {getControllerName(item)}
                </Text>
                {item.targets.length > 0 && (
                  <Text style={styles.itemTargets}>
                    Targets: {item.targets.length}
                  </Text>
                )}
              </View>
            ))
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
    width: '85%',
    maxHeight: '70%',
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
  scroll: {
    maxHeight: 300,
  },
  emptyText: {
    color: '#71717a',
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 24,
  },
  stackItem: {
    backgroundColor: '#27272a',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#3f3f46',
  },
  stackItemTop: {
    borderLeftColor: '#7c3aed',
    backgroundColor: '#1e1b4b',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  itemIndex: {
    color: '#71717a',
    fontSize: 12,
    fontWeight: '600',
  },
  itemKind: {
    color: '#7c3aed',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  itemName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  itemController: {
    color: '#a1a1aa',
    fontSize: 12,
    marginTop: 4,
  },
  itemTargets: {
    color: '#71717a',
    fontSize: 11,
    marginTop: 2,
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
