/**
 * Deep Linking Service
 *
 * Handles deep links for game launch and resume.
 * Link format: commander://game/{game_id}
 */

import { Linking } from 'react-native';
import * as ExpoLinking from 'expo-linking';

/**
 * Parsed deep link data.
 */
export interface DeepLinkData {
  type: 'game' | 'unknown';
  gameId?: string;
  params?: Record<string, string>;
}

/**
 * Parse a deep link URL into structured data.
 */
export function parseDeepLink(url: string): DeepLinkData {
  try {
    const parsed = ExpoLinking.parse(url);

    // Handle game routes: commander://game/{game_id}
    if (parsed.path?.startsWith('game/')) {
      const gameId = parsed.path.replace('game/', '');
      return {
        type: 'game',
        gameId,
        params: parsed.queryParams as Record<string, string>,
      };
    }

    // Handle game routes with different formats
    if (parsed.path === 'game' && parsed.queryParams?.id) {
      return {
        type: 'game',
        gameId: parsed.queryParams.id as string,
        params: parsed.queryParams as Record<string, string>,
      };
    }

    return { type: 'unknown' };
  } catch {
    return { type: 'unknown' };
  }
}

/**
 * Get the initial URL that launched the app (if any).
 */
export async function getInitialDeepLink(): Promise<DeepLinkData | null> {
  try {
    const url = await Linking.getInitialURL();
    if (url) {
      return parseDeepLink(url);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Subscribe to incoming deep links.
 */
export function subscribeToDeepLinks(
  callback: (data: DeepLinkData) => void,
): () => void {
  const subscription = Linking.addEventListener('url', ({ url }) => {
    const data = parseDeepLink(url);
    callback(data);
  });

  return () => subscription.remove();
}

/**
 * Create a deep link URL for a game.
 */
export function createGameDeepLink(gameId: string): string {
  return `commander://game/${gameId}`;
}

/**
 * Check if the app was launched from a deep link.
 */
export async function wasLaunchedFromDeepLink(): Promise<boolean> {
  const url = await Linking.getInitialURL();
  return url !== null;
}
