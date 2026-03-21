/**
 * useSaveManager
 *
 * Hook for save/load game functionality using AsyncStorage.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { Alert } from 'react-native';
import { SaveManager, createSaveManager } from '@engine/persistence/manager';
import type { SaveMetadata } from '@engine/persistence/schema';
import type { GameState } from '@/types';
import { getAsyncStorageAdapter } from '@/services/AsyncStorageAdapter';

export interface UseSaveManagerResult {
  // State
  isLoading: boolean;
  savedGames: SaveMetadata[];
  hasQuickSave: boolean;

  // Actions
  refreshSaves: () => Promise<void>;
  quickSave: (state: GameState) => Promise<boolean>;
  quickLoad: () => Promise<GameState | null>;
  saveGame: (state: GameState, name: string) => Promise<boolean>;
  loadGame: (slotId: string) => Promise<GameState | null>;
  deleteSave: (slotId: string) => Promise<boolean>;
}

export function useSaveManager(): UseSaveManagerResult {
  const [isLoading, setIsLoading] = useState(false);
  const [savedGames, setSavedGames] = useState<SaveMetadata[]>([]);
  const [hasQuickSave, setHasQuickSave] = useState(false);

  // Create save manager with AsyncStorage adapter
  const saveManager = useMemo(() => {
    const adapter = getAsyncStorageAdapter();
    return createSaveManager(adapter);
  }, []);

  // Refresh list of saved games
  const refreshSaves = useCallback(async () => {
    setIsLoading(true);
    try {
      const saves = await saveManager.listSaves();
      setSavedGames(saves);

      // Check if quick save exists
      const hasQS = await saveManager.hasSave('quicksave');
      setHasQuickSave(hasQS);
    } catch (error) {
      console.error('Failed to refresh saves:', error);
    } finally {
      setIsLoading(false);
    }
  }, [saveManager]);

  // Load saves on mount
  useEffect(() => {
    refreshSaves();
  }, [refreshSaves]);

  // Quick save
  const quickSave = useCallback(async (state: GameState): Promise<boolean> => {
    setIsLoading(true);
    try {
      await saveManager.quickSave(state);
      setHasQuickSave(true);
      await refreshSaves();
      return true;
    } catch (error) {
      console.error('Quick save failed:', error);
      Alert.alert('Save Failed', 'Could not save game. Please try again.');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [saveManager, refreshSaves]);

  // Quick load
  const quickLoad = useCallback(async (): Promise<GameState | null> => {
    setIsLoading(true);
    try {
      const state = await saveManager.quickLoad();
      if (!state) {
        Alert.alert('No Quick Save', 'No quick save found.');
      }
      return state;
    } catch (error) {
      console.error('Quick load failed:', error);
      Alert.alert('Load Failed', 'Could not load game. The save may be corrupted.');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [saveManager]);

  // Save game to new slot
  const saveGame = useCallback(async (state: GameState, name: string): Promise<boolean> => {
    setIsLoading(true);
    try {
      const slotId = saveManager.createSlotId();
      await saveManager.saveGame(slotId, state, name);
      await refreshSaves();
      return true;
    } catch (error) {
      console.error('Save game failed:', error);
      Alert.alert('Save Failed', 'Could not save game. Please try again.');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [saveManager, refreshSaves]);

  // Load game from slot
  const loadGame = useCallback(async (slotId: string): Promise<GameState | null> => {
    setIsLoading(true);
    try {
      const state = await saveManager.loadGame(slotId);
      if (!state) {
        Alert.alert('Load Failed', 'Could not find save data.');
      }
      return state;
    } catch (error) {
      console.error('Load game failed:', error);
      Alert.alert('Load Failed', 'Could not load game. The save may be corrupted.');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [saveManager]);

  // Delete save
  const deleteSave = useCallback(async (slotId: string): Promise<boolean> => {
    setIsLoading(true);
    try {
      const success = await saveManager.deleteSave(slotId);
      if (success) {
        await refreshSaves();
      }
      return success;
    } catch (error) {
      console.error('Delete save failed:', error);
      Alert.alert('Delete Failed', 'Could not delete save.');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [saveManager, refreshSaves]);

  return {
    isLoading,
    savedGames,
    hasQuickSave,
    refreshSaves,
    quickSave,
    quickLoad,
    saveGame,
    loadGame,
    deleteSave,
  };
}
