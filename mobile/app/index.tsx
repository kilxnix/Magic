import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Commander</Text>
        <Text style={styles.subtitle}>Game Engine</Text>

        <View style={styles.buttonContainer}>
          <Pressable
            style={styles.primaryButton}
            onPress={() => router.push('/setup')}
          >
            <Text style={styles.primaryButtonText}>New Game</Text>
          </Pressable>

          <Pressable
            style={styles.secondaryButton}
            onPress={() => {
              // TODO: Navigate to saved games
            }}
          >
            <Text style={styles.secondaryButtonText}>Continue Game</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.version}>Phase 9 - Mobile UI</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 48,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#a1a1aa',
    marginBottom: 64,
  },
  buttonContainer: {
    width: '100%',
    maxWidth: 300,
    gap: 16,
  },
  primaryButton: {
    backgroundColor: '#7c3aed',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#3f3f46',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#a1a1aa',
    fontSize: 18,
    fontWeight: '600',
  },
  version: {
    color: '#52525b',
    fontSize: 12,
    textAlign: 'center',
    paddingBottom: 16,
  },
});
