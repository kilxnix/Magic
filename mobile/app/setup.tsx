import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

type PlayerConfig = {
  id: string;
  name: string;
  isAI: boolean;
  difficulty: number;
};

const DIFFICULTIES = [
  { level: 1, label: 'Casual', description: 'Plays on curve, random attacks' },
  { level: 2, label: 'Beginner', description: 'Basic threat assessment' },
  { level: 3, label: 'Intermediate', description: 'Holds removal, targets threats' },
  { level: 4, label: 'Advanced', description: 'Reads open mana, sandbagging' },
  { level: 5, label: 'Expert', description: 'Optimal sequencing, politics' },
];

export default function GameSetupScreen() {
  const router = useRouter();
  const [playerCount, setPlayerCount] = useState(2);
  const [players, setPlayers] = useState<PlayerConfig[]>([
    { id: 'player-1', name: 'You', isAI: false, difficulty: 3 },
    { id: 'player-2', name: 'AI 1', isAI: true, difficulty: 3 },
  ]);

  const updatePlayerCount = (count: number) => {
    setPlayerCount(count);
    const newPlayers: PlayerConfig[] = [
      { id: 'player-1', name: 'You', isAI: false, difficulty: 3 },
    ];
    for (let i = 1; i < count; i++) {
      newPlayers.push({
        id: `player-${i + 1}`,
        name: `AI ${i}`,
        isAI: true,
        difficulty: 3,
      });
    }
    setPlayers(newPlayers);
  };

  const updateDifficulty = (playerId: string, difficulty: number) => {
    setPlayers(prev =>
      prev.map(p => (p.id === playerId ? { ...p, difficulty } : p))
    );
  };

  const startGame = () => {
    router.push({
      pathname: '/game',
      params: { config: JSON.stringify({ players }) },
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Game Setup</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Players</Text>
          <View style={styles.playerCountRow}>
            {[2, 3, 4].map(count => (
              <Pressable
                key={count}
                style={[
                  styles.countButton,
                  playerCount === count && styles.countButtonActive,
                ]}
                onPress={() => updatePlayerCount(count)}
              >
                <Text
                  style={[
                    styles.countButtonText,
                    playerCount === count && styles.countButtonTextActive,
                  ]}
                >
                  {count}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AI Difficulty</Text>
          {players.filter(p => p.isAI).map(player => (
            <View key={player.id} style={styles.playerConfig}>
              <Text style={styles.playerName}>{player.name}</Text>
              <View style={styles.difficultyRow}>
                {DIFFICULTIES.map(d => (
                  <Pressable
                    key={d.level}
                    style={[
                      styles.difficultyButton,
                      player.difficulty === d.level && styles.difficultyButtonActive,
                    ]}
                    onPress={() => updateDifficulty(player.id, d.level)}
                  >
                    <Text
                      style={[
                        styles.difficultyText,
                        player.difficulty === d.level && styles.difficultyTextActive,
                      ]}
                    >
                      {d.level}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.difficultyDescription}>
                {DIFFICULTIES.find(d => d.level === player.difficulty)?.description}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.deckNote}>
          Using sample decks for testing. Deck selection coming in Phase 13.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
        <Pressable style={styles.startButton} onPress={startGame}>
          <Text style={styles.startButtonText}>Start Game</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 32,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#e4e4e7',
    marginBottom: 16,
  },
  playerCountRow: {
    flexDirection: 'row',
    gap: 12,
  },
  countButton: {
    width: 56,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3f3f46',
    justifyContent: 'center',
    alignItems: 'center',
  },
  countButtonActive: {
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
  },
  countButtonText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#a1a1aa',
  },
  countButtonTextActive: {
    color: '#ffffff',
  },
  playerConfig: {
    backgroundColor: '#27272a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  playerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 12,
  },
  difficultyRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  difficultyButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3f3f46',
    justifyContent: 'center',
    alignItems: 'center',
  },
  difficultyButtonActive: {
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
  },
  difficultyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#a1a1aa',
  },
  difficultyTextActive: {
    color: '#ffffff',
  },
  difficultyDescription: {
    fontSize: 14,
    color: '#71717a',
  },
  deckNote: {
    fontSize: 14,
    color: '#52525b',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    padding: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#27272a',
  },
  backButton: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#3f3f46',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  backButtonText: {
    color: '#a1a1aa',
    fontSize: 16,
    fontWeight: '600',
  },
  startButton: {
    flex: 2,
    backgroundColor: '#7c3aed',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  startButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
