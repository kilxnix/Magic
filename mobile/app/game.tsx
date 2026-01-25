import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GameProvider } from '@/contexts/GameContext';
import { GameScreen } from '@/screens/GameScreen';

type PlayerConfig = {
  id: string;
  name: string;
  isAI: boolean;
  difficulty: number;
};

type GameConfig = {
  players: PlayerConfig[];
};

// API base URL - configure for your environment
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

async function fetchGameFromServer(gameId: string): Promise<GameConfig | null> {
  try {
    // Note: This endpoint would need to be implemented on the server
    // to return the full game state for the given ID
    const response = await fetch(`${API_BASE_URL}/api/game/${gameId}`);
    if (!response.ok) {
      console.error('Failed to fetch game:', response.status);
      return null;
    }
    const data = await response.json();
    return data.config;
  } catch (error) {
    console.error('Error fetching game:', error);
    return null;
  }
}

export default function GameRoute() {
  const { config, gameId } = useLocalSearchParams<{ config?: string; gameId?: string }>();
  const [gameConfig, setGameConfig] = useState<GameConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Priority 1: Parse config JSON if provided (from setup screen)
    if (config) {
      try {
        setGameConfig(JSON.parse(config));
        return;
      } catch (e) {
        console.error('Failed to parse game config:', e);
      }
    }

    // Priority 2: Fetch from server using gameId (from deep link)
    if (gameId) {
      fetchGameFromServer(gameId)
        .then(fetchedConfig => {
          if (fetchedConfig) {
            setGameConfig(fetchedConfig);
          } else {
            setError('Failed to load game from server');
          }
        });
      return;
    }

    // No config or gameId provided
    setError('No game configuration provided');
  }, [config, gameId]);

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loading}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!gameConfig) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Loading game...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <GameProvider config={gameConfig}>
      <GameScreen />
    </GameProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  loading: {
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
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});
