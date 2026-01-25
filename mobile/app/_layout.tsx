import { useEffect, useCallback } from 'react';
import { Stack, useRouter } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import {
  getInitialDeepLink,
  subscribeToDeepLinks,
  DeepLinkData,
} from '../src/services/linking';

export default function RootLayout() {
  const router = useRouter();

  const handleDeepLink = useCallback((data: DeepLinkData) => {
    if (data.type === 'game' && data.gameId) {
      // Navigate to game screen with the game ID
      router.push({
        pathname: '/game',
        params: { gameId: data.gameId },
      });
    }
  }, [router]);

  useEffect(() => {
    // Check for initial deep link (app was launched from link)
    getInitialDeepLink().then(data => {
      if (data) {
        handleDeepLink(data);
      }
    });

    // Subscribe to incoming deep links (app is already open)
    const unsubscribe = subscribeToDeepLinks(handleDeepLink);

    return () => unsubscribe();
  }, [handleDeepLink]);

  return (
    <GestureHandlerRootView style={styles.container}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#1a1a1a' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="setup" />
        <Stack.Screen name="game" />
      </Stack>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
});
