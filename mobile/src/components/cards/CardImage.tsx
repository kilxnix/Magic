/**
 * CardImage
 *
 * Displays a card image from Scryfall. Falls back to a placeholder.
 */

import React, { useState } from 'react';
import { View, Image, Text, StyleSheet, ActivityIndicator } from 'react-native';

interface CardImageProps {
  name: string;
  size?: 'small' | 'medium' | 'large';
}

const SIZES = {
  small: { width: 60, height: 84 },
  medium: { width: 120, height: 168 },
  large: { width: 240, height: 336 },
};

// Scryfall image URL builder
function getScryfallUrl(name: string, size: 'small' | 'medium' | 'large'): string {
  const encodedName = encodeURIComponent(name);
  const version = size === 'small' ? 'small' : size === 'medium' ? 'normal' : 'large';
  return `https://api.scryfall.com/cards/named?exact=${encodedName}&format=image&version=${version}`;
}

export function CardImage({ name, size = 'medium' }: CardImageProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const dimensions = SIZES[size];
  const uri = getScryfallUrl(name, size);

  if (error) {
    // Fallback placeholder
    return (
      <View style={[styles.placeholder, dimensions]}>
        <Text style={styles.placeholderText} numberOfLines={2}>
          {name}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, dimensions]}>
      {loading && (
        <View style={[styles.loadingContainer, dimensions]}>
          <ActivityIndicator size="small" color="#7c3aed" />
        </View>
      )}
      <Image
        source={{ uri }}
        style={[styles.image, dimensions]}
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
        resizeMode="cover"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#27272a',
  },
  image: {
    borderRadius: 4,
  },
  loadingContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#27272a',
    borderRadius: 4,
  },
  placeholder: {
    backgroundColor: '#27272a',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#3f3f46',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 4,
  },
  placeholderText: {
    color: '#a1a1aa',
    fontSize: 10,
    textAlign: 'center',
  },
});
