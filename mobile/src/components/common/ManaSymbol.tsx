/**
 * ManaSymbol
 *
 * Displays a mana symbol (W, U, B, R, G, C, or generic).
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ManaColor } from '@/types';

interface ManaSymbolProps {
  symbol: ManaColor | string;
  size?: 'small' | 'medium' | 'large';
}

const MANA_COLORS: Record<string, { bg: string; text: string }> = {
  W: { bg: '#F9FAF4', text: '#1a1a1a' },
  U: { bg: '#0E68AB', text: '#ffffff' },
  B: { bg: '#3d3d3d', text: '#ffffff' },
  R: { bg: '#D3202A', text: '#ffffff' },
  G: { bg: '#00733E', text: '#ffffff' },
  C: { bg: '#a1a1aa', text: '#1a1a1a' },
};

const SIZES = {
  small: { container: 16, text: 10 },
  medium: { container: 24, text: 14 },
  large: { container: 32, text: 18 },
};

export function ManaSymbol({ symbol, size = 'medium' }: ManaSymbolProps) {
  const isGeneric = /^\d+$/.test(symbol);
  const colors = isGeneric
    ? { bg: '#71717a', text: '#ffffff' }
    : MANA_COLORS[symbol] ?? { bg: '#71717a', text: '#ffffff' };

  const dimensions = SIZES[size];

  return (
    <View
      style={[
        styles.container,
        {
          width: dimensions.container,
          height: dimensions.container,
          borderRadius: dimensions.container / 2,
          backgroundColor: colors.bg,
        },
      ]}
    >
      <Text
        style={[
          styles.text,
          {
            fontSize: dimensions.text,
            color: colors.text,
          },
        ]}
      >
        {symbol}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.2)',
  },
  text: {
    fontWeight: '700',
  },
});
