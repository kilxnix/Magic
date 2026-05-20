import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  deferShelectorBrainDownload,
  getShelectorBrainStatus,
  ShelectorBrainStatus,
  startShelectorBrainDownload,
} from '@/shelector/brainDownload';

function formatBytes(bytes: number) {
  if (!bytes) return 'Preparing';
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function OracleArtwork() {
  return (
    <View style={styles.artFrame}>
      <View style={styles.moonGlow} />
      <View style={styles.cardFan}>
        <View style={[styles.artCard, styles.artCardLeft]}>
          <Text style={styles.cardRune}>✦</Text>
        </View>
        <View style={[styles.artCard, styles.artCardCenter]}>
          <Text style={styles.cardRune}>☽</Text>
        </View>
        <View style={[styles.artCard, styles.artCardRight]}>
          <Text style={styles.cardRune}>✧</Text>
        </View>
      </View>
      <View style={styles.orb}>
        <Text style={styles.orbText}>S</Text>
      </View>
      <View style={styles.sparkleOne} />
      <View style={styles.sparkleTwo} />
    </View>
  );
}

export default function BrainDownloadScreen() {
  const router = useRouter();
  const [allowBackground, setAllowBackground] = useState(true);
  const [status, setStatus] = useState<ShelectorBrainStatus | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    getShelectorBrainStatus().then(nextStatus => {
      setStatus(nextStatus);
      setAllowBackground(nextStatus.allowBackground);
    });
  }, []);

  const progressPercent = Math.round((status?.progress ?? 0) * 100);
  const phaseCopy = useMemo(() => {
    if (status?.phase === 'ready') {
      return {
        title: 'The Shelector lives here now',
        body: 'The brain package is on this device. Offline duels can use the local model once runtime wiring is enabled.',
      };
    }
    if (status?.phase === 'downloading') {
      return {
        title: 'Downloading The Shelector',
        body: 'You can keep watching, start a fallback game, or leave the app while the device keeps working.',
      };
    }
    if (status?.phase === 'error') {
      return {
        title: 'Brain package not ready',
        body: status.error || 'The model download could not start yet. You can still play with local fallback Shelector.',
      };
    }
    return {
      title: 'Bring The Shelector onto this device',
      body: 'One first-run download gives the game its private local brain. No match decisions need to leave the phone.',
    };
  }, [status]);

  const startDownload = async () => {
    setIsStarting(true);
    const nextStatus = await startShelectorBrainDownload({
      allowBackground,
      onProgress: setStatus,
    });
    setStatus(nextStatus);
    setIsStarting(false);
  };

  const deferDownload = async () => {
    await deferShelectorBrainDownload(allowBackground);
    router.replace('/game');
  };

  const continueToGame = () => {
    router.replace('/game');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <OracleArtwork />

        <View style={styles.panel}>
          <Text style={styles.eyebrow}>Offline Brain</Text>
          <Text style={styles.title}>{phaseCopy.title}</Text>
          <Text style={styles.body}>{phaseCopy.body}</Text>

          <View style={styles.downloadCard}>
            <View style={styles.downloadHeader}>
              <View>
                <Text style={styles.downloadTitle}>Shelector Brain</Text>
                <Text style={styles.downloadMeta}>
                  {status?.phase === 'ready'
                    ? 'Stored locally'
                    : status?.phase === 'downloading'
                      ? `${progressPercent}% · ${formatBytes(status.bytesWritten)}`
                      : 'One-time GGUF model package'}
                </Text>
              </View>
              {status?.phase === 'downloading' && <ActivityIndicator color="#c4b5fd" />}
            </View>

            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
            </View>
          </View>

          <View style={styles.optionRow}>
            <View style={styles.optionCopy}>
              <Text style={styles.optionTitle}>Allow background download</Text>
              <Text style={styles.optionBody}>
                Let the device keep fetching the brain while you admire the portal, check another app, or start a fallback duel.
              </Text>
            </View>
            <Switch
              value={allowBackground}
              onValueChange={setAllowBackground}
              trackColor={{ false: '#3f3f46', true: '#6d28d9' }}
              thumbColor={allowBackground ? '#f5f3ff' : '#a1a1aa'}
              disabled={status?.phase === 'downloading'}
            />
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        {status?.phase === 'ready' ? (
          <Pressable style={styles.primaryButton} onPress={continueToGame}>
            <Text style={styles.primaryButtonText}>Enter the Game</Text>
          </Pressable>
        ) : (
          <>
            <Pressable
              style={[styles.primaryButton, isStarting && styles.disabledButton]}
              onPress={startDownload}
              disabled={isStarting || status?.phase === 'downloading'}
            >
              <Text style={styles.primaryButtonText}>
                {status?.phase === 'downloading' ? 'Download Running' : 'Download Brain'}
              </Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={deferDownload}>
              <Text style={styles.secondaryButtonText}>Play with Fallback</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#120b1f',
  },
  content: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 18,
    justifyContent: 'center',
    gap: 22,
  },
  artFrame: {
    height: 254,
    borderRadius: 32,
    overflow: 'hidden',
    backgroundColor: '#251044',
    borderWidth: 1,
    borderColor: '#6d28d9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moonGlow: {
    position: 'absolute',
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: '#7c3aed',
    opacity: 0.28,
  },
  cardFan: {
    width: 210,
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artCard: {
    position: 'absolute',
    width: 82,
    height: 122,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#c4b5fd',
    backgroundColor: '#1e1b4b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  artCardLeft: {
    transform: [{ translateX: -52 }, { rotate: '-15deg' }],
    backgroundColor: '#312e81',
  },
  artCardCenter: {
    transform: [{ translateY: -10 }],
    backgroundColor: '#4c1d95',
  },
  artCardRight: {
    transform: [{ translateX: 52 }, { rotate: '15deg' }],
    backgroundColor: '#3b0764',
  },
  cardRune: {
    color: '#f5d0fe',
    fontSize: 32,
    fontWeight: '700',
  },
  orb: {
    position: 'absolute',
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: '#f5f3ff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#c084fc',
    shadowOpacity: 0.75,
    shadowRadius: 22,
  },
  orbText: {
    color: '#581c87',
    fontSize: 36,
    fontWeight: '900',
  },
  sparkleOne: {
    position: 'absolute',
    top: 42,
    right: 54,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#f0abfc',
  },
  sparkleTwo: {
    position: 'absolute',
    bottom: 48,
    left: 46,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#c4b5fd',
  },
  panel: {
    backgroundColor: 'rgba(39, 39, 42, 0.92)',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#4c1d95',
  },
  eyebrow: {
    color: '#c4b5fd',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 32,
    marginBottom: 10,
  },
  body: {
    color: '#d4d4d8',
    fontSize: 15,
    lineHeight: 21,
  },
  downloadCard: {
    marginTop: 18,
    backgroundColor: '#18181b',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  downloadHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  downloadTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  downloadMeta: {
    color: '#a1a1aa',
    fontSize: 13,
    marginTop: 3,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#27272a',
    marginTop: 14,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: '#a78bfa',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 18,
  },
  optionCopy: {
    flex: 1,
  },
  optionTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  optionBody: {
    color: '#a1a1aa',
    fontSize: 13,
    lineHeight: 18,
  },
  footer: {
    padding: 22,
    gap: 12,
  },
  primaryButton: {
    backgroundColor: '#7c3aed',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  disabledButton: {
    opacity: 0.65,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButton: {
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  secondaryButtonText: {
    color: '#d4d4d8',
    fontSize: 16,
    fontWeight: '700',
  },
});
