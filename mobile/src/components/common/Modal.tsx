/**
 * Modal
 *
 * Base modal component with backdrop.
 */

import React from 'react';
import { View, StyleSheet, Pressable, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withTiming,
  useSharedValue,
} from 'react-native-reanimated';

interface ModalProps {
  visible: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
  contentStyle?: ViewStyle;
}

export function Modal({ visible, onDismiss, children, contentStyle }: ModalProps) {
  const opacity = useSharedValue(visible ? 1 : 0);

  React.useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, { duration: 200 });
  }, [visible, opacity]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  if (!visible) return null;

  return (
    <Animated.View style={[styles.container, backdropStyle]}>
      <Pressable style={styles.backdrop} onPress={onDismiss} />
      <View style={[styles.content, contentStyle]}>
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  content: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 20,
    maxWidth: '90%',
    maxHeight: '85%',
  },
});
