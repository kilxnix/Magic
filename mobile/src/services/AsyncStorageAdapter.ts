/**
 * AsyncStorageAdapter
 *
 * Implements StorageAdapter interface using React Native AsyncStorage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StorageAdapter } from '@engine/persistence/manager';

export class AsyncStorageAdapter implements StorageAdapter {
  async get(key: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(key);
    } catch (error) {
      console.error('AsyncStorageAdapter.get error:', error);
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      await AsyncStorage.setItem(key, value);
    } catch (error) {
      console.error('AsyncStorageAdapter.set error:', error);
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      console.error('AsyncStorageAdapter.remove error:', error);
      throw error;
    }
  }

  async keys(prefix: string): Promise<string[]> {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      return allKeys.filter(k => k.startsWith(prefix));
    } catch (error) {
      console.error('AsyncStorageAdapter.keys error:', error);
      return [];
    }
  }
}

// Singleton instance
let adapterInstance: AsyncStorageAdapter | null = null;

export function getAsyncStorageAdapter(): AsyncStorageAdapter {
  if (!adapterInstance) {
    adapterInstance = new AsyncStorageAdapter();
  }
  return adapterInstance;
}
