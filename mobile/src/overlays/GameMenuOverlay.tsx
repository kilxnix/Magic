/**
 * GameMenuOverlay
 *
 * Game menu with Quick Save, Quick Load, and saved games list.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInUp, SlideOutDown } from 'react-native-reanimated';
import { useGame } from '@/contexts/GameContext';
import { useSaveManager } from '@/hooks/useSaveManager';
import { COLORS } from '@/constants/colors';
import type { SaveMetadata } from '@engine/persistence/schema';

interface GameMenuOverlayProps {
  visible: boolean;
  onDismiss: () => void;
  onLoadGame: (slotId: string) => void;
}

export function GameMenuOverlay({ visible, onDismiss, onLoadGame }: GameMenuOverlayProps) {
  const { gameState, turnNumber } = useGame();
  const {
    isLoading,
    savedGames,
    hasQuickSave,
    quickSave,
    quickLoad,
    saveGame,
    loadGame,
    deleteSave,
  } = useSaveManager();

  const [showNewSave, setShowNewSave] = useState(false);
  const [newSaveName, setNewSaveName] = useState('');

  if (!visible) {
    return null;
  }

  const handleQuickSave = async () => {
    if (!gameState) return;
    const success = await quickSave(gameState);
    if (success) {
      Alert.alert('Saved', 'Game saved to quick save slot.');
    }
  };

  const handleQuickLoad = async () => {
    const state = await quickLoad();
    if (state) {
      onLoadGame('quicksave');
      onDismiss();
    }
  };

  const handleNewSave = async () => {
    if (!gameState || !newSaveName.trim()) return;
    const success = await saveGame(gameState, newSaveName.trim());
    if (success) {
      setShowNewSave(false);
      setNewSaveName('');
      Alert.alert('Saved', `Game saved as "${newSaveName.trim()}".`);
    }
  };

  const handleLoadSave = async (save: SaveMetadata) => {
    Alert.alert(
      'Load Game',
      `Load "${save.name}"? Current progress will be lost.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Load',
          onPress: async () => {
            const state = await loadGame(save.id);
            if (state) {
              onLoadGame(save.id);
              onDismiss();
            }
          },
        },
      ]
    );
  };

  const handleDeleteSave = async (save: SaveMetadata) => {
    Alert.alert(
      'Delete Save',
      `Delete "${save.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteSave(save.id),
        },
      ]
    );
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <Animated.View
      style={styles.overlay}
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(150)}
    >
      <Pressable style={styles.backdrop} onPress={onDismiss} />

      <Animated.View
        style={styles.container}
        entering={SlideInUp.duration(200)}
        exiting={SlideOutDown.duration(200)}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Game Menu</Text>
          <Text style={styles.subtitle}>Turn {turnNumber}</Text>
        </View>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <Pressable
            style={[styles.actionButton, styles.saveButton]}
            onPress={handleQuickSave}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={COLORS.textPrimary} />
            ) : (
              <Text style={styles.actionText}>Quick Save</Text>
            )}
          </Pressable>

          <Pressable
            style={[
              styles.actionButton,
              styles.loadButton,
              !hasQuickSave && styles.actionButtonDisabled,
            ]}
            onPress={handleQuickLoad}
            disabled={isLoading || !hasQuickSave}
          >
            <Text style={[
              styles.actionText,
              !hasQuickSave && styles.actionTextDisabled,
            ]}>
              Quick Load
            </Text>
          </Pressable>
        </View>

        {/* New Save */}
        {showNewSave ? (
          <View style={styles.newSaveForm}>
            <TextInput
              style={styles.input}
              placeholder="Save name..."
              placeholderTextColor={COLORS.textDim}
              value={newSaveName}
              onChangeText={setNewSaveName}
              autoFocus
            />
            <View style={styles.newSaveActions}>
              <Pressable
                style={styles.cancelFormButton}
                onPress={() => {
                  setShowNewSave(false);
                  setNewSaveName('');
                }}
              >
                <Text style={styles.cancelFormText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.confirmFormButton,
                  !newSaveName.trim() && styles.actionButtonDisabled,
                ]}
                onPress={handleNewSave}
                disabled={!newSaveName.trim() || isLoading}
              >
                <Text style={styles.confirmFormText}>Save</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            style={styles.newSaveButton}
            onPress={() => setShowNewSave(true)}
          >
            <Text style={styles.newSaveText}>+ New Save</Text>
          </Pressable>
        )}

        {/* Saved Games List */}
        <Text style={styles.sectionTitle}>Saved Games</Text>
        <ScrollView style={styles.savesList}>
          {savedGames.length === 0 ? (
            <Text style={styles.emptyText}>No saved games</Text>
          ) : (
            savedGames.map(save => (
              <View key={save.id} style={styles.saveItem}>
                <Pressable
                  style={styles.saveInfo}
                  onPress={() => handleLoadSave(save)}
                >
                  <Text style={styles.saveName}>{save.name}</Text>
                  <Text style={styles.saveDetails}>
                    Turn {save.turnNumber} - {formatDate(save.updatedAt)}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.deleteButton}
                  onPress={() => handleDeleteSave(save)}
                >
                  <Text style={styles.deleteText}>X</Text>
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>

        {/* Close */}
        <Pressable style={styles.closeButton} onPress={onDismiss}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 300,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  container: {
    position: 'absolute',
    top: 80,
    left: 16,
    right: 16,
    bottom: 80,
    backgroundColor: COLORS.background,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: 14,
    marginTop: 4,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveButton: {
    backgroundColor: COLORS.success,
  },
  loadButton: {
    backgroundColor: COLORS.info,
  },
  actionButtonDisabled: {
    backgroundColor: COLORS.surfaceLight,
  },
  actionText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  actionTextDisabled: {
    color: COLORS.textDim,
  },
  newSaveButton: {
    backgroundColor: COLORS.surface,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  newSaveText: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  newSaveForm: {
    marginBottom: 20,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: COLORS.textPrimary,
    fontSize: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  newSaveActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  cancelFormButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
  },
  cancelFormText: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  confirmFormButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: COLORS.primary,
  },
  confirmFormText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  sectionTitle: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  savesList: {
    flex: 1,
  },
  emptyText: {
    color: COLORS.textDim,
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 20,
  },
  saveItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
  },
  saveInfo: {
    flex: 1,
    padding: 12,
  },
  saveName: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  saveDetails: {
    color: COLORS.textDim,
    fontSize: 12,
    marginTop: 4,
  },
  deleteButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.error,
  },
  deleteText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  closeButton: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
  },
  closeText: {
    color: COLORS.textMuted,
    fontSize: 16,
    fontWeight: '600',
  },
});
